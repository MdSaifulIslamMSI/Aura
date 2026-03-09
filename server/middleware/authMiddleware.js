const firebaseAdmin = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// In-memory token cache: { [uid]: { user, exp } }
// Reduces Firebase network calls for repeat requests within token validity
const tokenCache = new Map();
const CACHE_BUFFER_SECONDS = 60; // Expire cache 60s before actual token expires

const getCachedUser = (uid) => {
    const entry = tokenCache.get(uid);
    if (!entry) return null;
    // If cache entry is still valid, return it
    if (Date.now() < entry.expiresAt) return entry.user;
    // Expired — remove and return null
    tokenCache.delete(uid);
    return null;
};

const setCachedUser = (uid, user, tokenExp) => {
    const expiresAt = (tokenExp - CACHE_BUFFER_SECONDS) * 1000;
    tokenCache.set(uid, { user, expiresAt });
    // Auto-evict on expiry to prevent memory leak
    const ttl = expiresAt - Date.now();
    if (ttl > 0) {
        setTimeout(() => tokenCache.delete(uid), ttl);
    }
};

// Projection for auth — excludes cart/wishlist arrays (large payloads)
// Only selects what auth middleware and admin check actually need
const AUTH_PROJECTION = {
    name: 1,
    email: 1,
    phone: 1,
    isAdmin: 1,
    isVerified: 1,
    isSeller: 1,
    accountState: 1,
    softDeleted: 1,
    'moderation.suspendedUntil': 1,
};
const PHONE_REGEX = /^\+?\d{10,15}$/;

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveIntEnv = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizePhone = (value) => (
    typeof value === 'string'
        ? value.trim().replace(/[\s\-()]/g, '')
        : ''
);
const normalizeName = (value, fallbackEmail = '') => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw) return raw;
    const emailPrefix = (fallbackEmail || '').split('@')[0] || '';
    return emailPrefix || 'Aura User';
};

const ADMIN_STRICT_ACCESS_ENABLED = parseBooleanEnv(process.env.ADMIN_STRICT_ACCESS_ENABLED, true);
const ADMIN_REQUIRE_EMAIL_VERIFIED = parseBooleanEnv(process.env.ADMIN_REQUIRE_EMAIL_VERIFIED, true);
const ADMIN_REQUIRE_2FA = parseBooleanEnv(process.env.ADMIN_REQUIRE_2FA, false);
const ADMIN_REQUIRE_ALLOWLIST = parseBooleanEnv(process.env.ADMIN_REQUIRE_ALLOWLIST, false);
const ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = parsePositiveIntEnv(process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES, 30);
const ADMIN_ALLOWLIST_EMAILS = new Set(
    String(process.env.ADMIN_ALLOWLIST_EMAILS || '')
        .split(',')
        .map((email) => normalizeEmail(email))
        .filter(Boolean)
);

const isDuplicatePhoneError = (error) => (
    Boolean(error?.code === 11000 && (error?.keyPattern?.phone || String(error?.message || '').includes('phone')))
);

const getSuspendedUntilDate = (user) => {
    const raw = user?.moderation?.suspendedUntil;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const enforceUserAccountAccess = (user) => {
    if (!user) {
        throw new AppError('User profile missing from login database. Please sign in again to recover your account.', 404);
    }

    if (user.softDeleted || user.accountState === 'deleted') {
        throw new AppError('Your account is not active. Contact support for account recovery.', 403);
    }

    const suspendedUntil = getSuspendedUntilDate(user);
    const isSuspended = user.accountState === 'suspended'
        && Boolean(suspendedUntil)
        && suspendedUntil.getTime() > Date.now();
    if (isSuspended) {
        throw new AppError(
            `Your account is temporarily suspended until ${suspendedUntil.toISOString()}. Contact support for urgent review.`,
            423
        );
    }
};

const bootstrapUserRecord = async ({ decodedToken, email }) => {
    const safeEmail = normalizeEmail(email);
    const safeName = normalizeName(decodedToken?.name, safeEmail);
    const tokenPhone = normalizePhone(decodedToken?.phone_number || '');
    const safePhone = PHONE_REGEX.test(tokenPhone) ? tokenPhone : '';

    const buildUpdate = (includePhone) => ({
        $setOnInsert: {
            email: safeEmail,
            name: safeName,
            isVerified: true,
            ...(includePhone ? { phone: safePhone } : {}),
        },
    });

    try {
        return await User.findOneAndUpdate(
            { email: safeEmail },
            buildUpdate(true),
            { new: true, upsert: true, setDefaultsOnInsert: true, projection: AUTH_PROJECTION, lean: true }
        );
    } catch (error) {
        if (!isDuplicatePhoneError(error)) throw error;
        return User.findOneAndUpdate(
            { email: safeEmail },
            buildUpdate(false),
            { new: true, upsert: true, setDefaultsOnInsert: true, projection: AUTH_PROJECTION, lean: true }
        );
    }
};

const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // ── Step 1: Verify Firebase token ──────────────────────
            const decodedToken = await firebaseAdmin.auth().verifyIdToken(token);
            const { uid, email, exp } = decodedToken;
            req.authUid = uid;
            req.authToken = decodedToken;
            const normalizedEmail = normalizeEmail(email);
            if (!normalizedEmail) {
                throw new AppError('Authenticated account is missing email', 401);
            }

            // ── Step 2: Check in-memory cache first ─────────────────
            const cachedUser = getCachedUser(uid);
            if (cachedUser) {
                enforceUserAccountAccess(cachedUser);
                req.user = cachedUser;
                return next();
            }

            // ── Step 3: Lean MongoDB query with projection ──────────
            // .lean() returns plain JS object (no Mongoose overhead)
            // AUTH_PROJECTION excludes cart/wishlist (reduces wire transfer)
            const user = await User
                .findOne({ email: normalizedEmail }, AUTH_PROJECTION)
                .lean();

            if (!user) {
                const bootstrappedUser = await bootstrapUserRecord({
                    decodedToken,
                    email: normalizedEmail,
                });
                enforceUserAccountAccess(bootstrappedUser);
                setCachedUser(uid, bootstrappedUser, exp);
                req.user = bootstrappedUser;
                return next();
            }

            // ── Step 4: Cache for subsequent requests ───────────────
            enforceUserAccountAccess(user);
            setCachedUser(uid, user, exp);

            req.user = user;
            next();
        } catch (error) {
            if (error instanceof AppError) throw error;
            logger.error('auth.verify_failed', { error: error.message });
            throw new AppError('Not authorized, token failed', 401);
        }
    } else {
        throw new AppError('Not authorized, no token', 401);
    }
});

const protectOptional = asyncHandler(async (req, res, next) => {
    if (!req.headers.authorization?.startsWith('Bearer')) {
        return next();
    }

    return protect(req, res, next);
});

// Invalidate a user from cache (call on profile update, logout etc.)
const invalidateUserCache = (uid) => {
    if (!uid) return;
    tokenCache.delete(uid);
};

const invalidateUserCacheByEmail = (email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;

    for (const [uid, entry] of tokenCache.entries()) {
        if (normalizeEmail(entry?.user?.email) === normalizedEmail) {
            tokenCache.delete(uid);
        }
    }
};

const resolveFreshAdminUser = async (req) => {
    const actorEmail = normalizeEmail(req.user?.email || req.authToken?.email || '');
    if (!actorEmail) return null;

    const freshUser = await User.findOne({ email: actorEmail }, AUTH_PROJECTION).lean();
    if (!freshUser) return null;

    req.user = freshUser;

    if (req.authUid) {
        const tokenExp = Number(req.authToken?.exp || 0);
        if (tokenExp > 0) {
            setCachedUser(req.authUid, freshUser, tokenExp);
        } else {
            invalidateUserCache(req.authUid);
        }
    }

    return freshUser;
};

const admin = asyncHandler(async (req, res, next) => {
    let effectiveUser = req.user;

    // Admin privilege can change while a session is still active. Re-check Mongo
    // before denying so a stale in-memory auth cache does not block promoted admins.
    if (!effectiveUser?.isAdmin) {
        effectiveUser = await resolveFreshAdminUser(req);
    }

    if (!effectiveUser?.isAdmin) {
        throw new AppError('Not authorized as an admin', 403);
    }

    if (!ADMIN_STRICT_ACCESS_ENABLED) {
        return next();
    }

    const actorEmail = normalizeEmail(req.user?.email || req.authToken?.email || '');
    const emailVerified = Boolean(req.authToken?.email_verified);
    const authTime = Number(req.authToken?.auth_time || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionAgeSeconds = authTime > 0 ? (nowSeconds - authTime) : Number.POSITIVE_INFINITY;
    const hasSecondFactor = Boolean(req.authToken?.firebase?.sign_in_second_factor);

    if (ADMIN_REQUIRE_EMAIL_VERIFIED && !emailVerified) {
        logger.warn('admin_access.blocked_unverified_email', {
            requestId: req.requestId || '',
            email: actorEmail,
            path: req.originalUrl,
        });
        throw new AppError('Admin access requires verified email identity', 403);
    }

    if (ADMIN_REQUIRE_ALLOWLIST) {
        if (ADMIN_ALLOWLIST_EMAILS.size === 0) {
            logger.error('admin_access.allowlist_missing', {
                requestId: req.requestId || '',
                path: req.originalUrl,
            });
            throw new AppError('Admin access is locked: allowlist is not configured', 403);
        }
        if (!ADMIN_ALLOWLIST_EMAILS.has(actorEmail)) {
            logger.warn('admin_access.blocked_allowlist', {
                requestId: req.requestId || '',
                email: actorEmail,
                path: req.originalUrl,
            });
            throw new AppError('Admin access denied for this account', 403);
        }
    } else if (ADMIN_ALLOWLIST_EMAILS.size > 0 && !ADMIN_ALLOWLIST_EMAILS.has(actorEmail)) {
        logger.warn('admin_access.blocked_optional_allowlist', {
            requestId: req.requestId || '',
            email: actorEmail,
            path: req.originalUrl,
        });
        throw new AppError('Admin access denied for this account', 403);
    }

    if (sessionAgeSeconds > (ADMIN_REQUIRE_FRESH_LOGIN_MINUTES * 60)) {
        logger.warn('admin_access.blocked_stale_session', {
            requestId: req.requestId || '',
            email: actorEmail,
            path: req.originalUrl,
            sessionAgeSeconds,
            allowedAgeSeconds: ADMIN_REQUIRE_FRESH_LOGIN_MINUTES * 60,
        });
        throw new AppError(`Admin session expired. Re-authenticate within ${ADMIN_REQUIRE_FRESH_LOGIN_MINUTES} minutes.`, 401);
    }

    if (ADMIN_REQUIRE_2FA && !hasSecondFactor) {
        logger.warn('admin_access.blocked_missing_second_factor', {
            requestId: req.requestId || '',
            email: actorEmail,
            path: req.originalUrl,
        });
        throw new AppError('Admin access requires multi-factor authentication', 403);
    }

    return next();
});

const seller = (req, res, next) => {
    if (req.user?.isSeller) {
        return next();
    }
    throw new AppError('Seller account required. Activate seller mode to continue.', 403);
};

module.exports = {
    protect,
    protectOptional,
    admin,
    seller,
    invalidateUserCache,
    invalidateUserCacheByEmail,
};
