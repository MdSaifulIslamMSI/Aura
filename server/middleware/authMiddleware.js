const firebaseAdmin = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getRedisClient, flags: redisFlags } = require('../config/redis');
const {
    TRUSTED_DEVICE_SESSION_HEADER,
    extractTrustedDeviceContext,
    verifyTrustedDeviceSession,
} = require('../services/trustedDeviceChallengeService');

// Redis-backed token cache.
// Replaces the in-process Map which broke horizontal scaling:
// token invalidation on one instance was invisible to all others,
// meaning revoked/suspended tokens could be served indefinitely.
//
// When Redis is unavailable the functions degrade gracefully to a
// no-cache path (every request hits Mongo) — correct behavior in
// all cases, just slower. No silent security regression on fallback.

const CACHE_BUFFER_SECONDS = 60;
const AUTH_CACHE_PREFIX = `${redisFlags.redisPrefix}:auth:cache:`;

const getCachedUser = async (uid) => {
    try {
        const client = getRedisClient();
        if (!client) return null;
        const raw = await client.get(`${AUTH_CACHE_PREFIX}${uid}`);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (err) {
        logger.warn('auth.cache_read_failed', { uid, error: err?.message });
        return null;
    }
};

const setCachedUser = async (uid, user, tokenExp) => {
    try {
        const client = getRedisClient();
        if (!client) return;
        const ttlSeconds = Math.max((tokenExp - CACHE_BUFFER_SECONDS) - Math.floor(Date.now() / 1000), 1);
        await client.setEx(`${AUTH_CACHE_PREFIX}${uid}`, ttlSeconds, JSON.stringify(user));
    } catch (err) {
        logger.warn('auth.cache_write_failed', { uid, error: err?.message });
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
    authAssurance: 1,
    authAssuranceAt: 1,
    authAssuranceAuthTime: 1,
    loginOtpAssuranceExpiresAt: 1,
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

const AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED = parseBooleanEnv(process.env.AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED, false);
const ADMIN_STRICT_ACCESS_ENABLED = parseBooleanEnv(process.env.ADMIN_STRICT_ACCESS_ENABLED, true);
const ADMIN_REQUIRE_EMAIL_VERIFIED = parseBooleanEnv(process.env.ADMIN_REQUIRE_EMAIL_VERIFIED, true);
const ADMIN_REQUIRE_2FA = parseBooleanEnv(process.env.ADMIN_REQUIRE_2FA, false);
const ADMIN_REQUIRE_ALLOWLIST = parseBooleanEnv(process.env.ADMIN_REQUIRE_ALLOWLIST, false);
const ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = parsePositiveIntEnv(process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES, 30);
const normalizeTrustedDeviceMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['always', 'admin', 'seller', 'privileged', 'off'].includes(normalized)) {
        return normalized;
    }
    return 'off';
};
const AUTH_DEVICE_CHALLENGE_MODE = normalizeTrustedDeviceMode(
    process.env.AUTH_DEVICE_CHALLENGE_MODE || process.env.AUTH_LATTICE_CHALLENGE_MODE
);
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
    
    // As per new strict chat policy: Suspended users CAN log in to negotiate
    // via Appeals Chat. They are only blocked at the commercial API level
    // using the new requireActiveAccount middleware below.
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
            isVerified: Boolean(decodedToken?.email_verified),
            authAssurance: 'none',
            ...(includePhone ? { phone: safePhone } : {}),
        },
    });

    try {
        return await User.findOneAndUpdate(
            { email: safeEmail },
            buildUpdate(true),
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, projection: AUTH_PROJECTION, lean: true }
        );
    } catch (error) {
        if (!isDuplicatePhoneError(error)) throw error;
        return User.findOneAndUpdate(
            { email: safeEmail },
            buildUpdate(false),
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, projection: AUTH_PROJECTION, lean: true }
        );
    }
};


const resolveAuthTimeSeconds = (authToken = null) => {
    const authTime = Number(authToken?.auth_time || 0);
    return Number.isFinite(authTime) && authTime > 0 ? authTime : 0;
};

const resolveOtpAssuranceExpiryMillis = (user = null) => {
    if (!user?.loginOtpAssuranceExpiresAt) return 0;
    const expiresAt = new Date(user.loginOtpAssuranceExpiresAt).getTime();
    return Number.isFinite(expiresAt) ? expiresAt : 0;
};

const hasOtpAssurance = (req) => {
    if (String(req.user?.authAssurance || '').trim() !== 'password+otp') {
        return false;
    }

    const requiredAuthTime = Number(req.user?.authAssuranceAuthTime || 0);
    const currentAuthTime = resolveAuthTimeSeconds(req.authToken);
    const expiresAt = resolveOtpAssuranceExpiryMillis(req.user);

    return requiredAuthTime > 0
        && currentAuthTime > 0
        && requiredAuthTime === currentAuthTime
        && expiresAt > Date.now();
};

const enforceOtpAssurance = (req) => {
    if (!hasOtpAssurance(req)) {
        throw new AppError('OTP verification required for this action', 403);
    }
};

const shouldRequireTrustedDeviceForUser = (user = null) => {
    switch (AUTH_DEVICE_CHALLENGE_MODE) {
    case 'always':
        return true;
    case 'admin':
        return Boolean(user?.isAdmin);
    case 'seller':
        return Boolean(user?.isSeller);
    case 'privileged':
        return Boolean(user?.isAdmin || user?.isSeller);
    case 'off':
    default:
        return false;
    }
};

const isTrustedDeviceBypassPath = (req = {}) => {
    const path = String(req.originalUrl || '').toLowerCase();
    return path.startsWith('/api/auth/session')
        || path.startsWith('/api/auth/sync')
        || path.startsWith('/api/auth/verify-device')
        || path.startsWith('/api/auth/verify-lattice')
        || path.startsWith('/api/auth/verify-quantum');
};

const enforceTrustedDevice = (req) => {
    if (!shouldRequireTrustedDeviceForUser(req.user) || isTrustedDeviceBypassPath(req)) {
        return;
    }

    const { deviceId } = extractTrustedDeviceContext(req);
    const deviceSessionToken = String(
        req.get?.(TRUSTED_DEVICE_SESSION_HEADER)
        || req.headers?.[TRUSTED_DEVICE_SESSION_HEADER]
        || ''
    ).trim();

    if (!deviceId || !deviceSessionToken) {
        throw new AppError('Trusted device verification required for this account', 403);
    }

    const verification = verifyTrustedDeviceSession({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceId,
        deviceSessionToken,
    });

    if (!verification.success) {
        throw new AppError('Trusted device verification required for this account', 403);
    }
};

const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // ── Step 1: Verify Firebase token ──────────────────────
            const decodedToken = await firebaseAdmin.auth().verifyIdToken(token, true);
            const { uid, email, exp } = decodedToken;
            req.authUid = uid;
            req.authToken = decodedToken;
            const normalizedEmail = normalizeEmail(email);
            if (!normalizedEmail) {
                throw new AppError('Authenticated account is missing email', 401);
            }

                        // ── Step 2: Check Redis cache first ─────────────────────────────────────
             const cachedUser = await getCachedUser(uid);
            if (cachedUser) {
                enforceUserAccountAccess(cachedUser);
                req.user = cachedUser;
                if (AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED) {
                    enforceOtpAssurance(req);
                }
                if (AUTH_DEVICE_CHALLENGE_MODE === 'always') {
                    enforceTrustedDevice(req);
                }
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
                await setCachedUser(uid, bootstrappedUser, exp);
                req.user = bootstrappedUser;
                if (AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED) {
                    enforceOtpAssurance(req);
                }
                if (AUTH_DEVICE_CHALLENGE_MODE === 'always') {
                    enforceTrustedDevice(req);
                }
                return next();
            }

            // ── Step 4: Write to Redis cache for subsequent requests ──────
             enforceUserAccountAccess(user);
            await setCachedUser(uid, user, exp);

            req.user = user;
            if (AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED) {
                enforceOtpAssurance(req);
            }
            if (AUTH_DEVICE_CHALLENGE_MODE === 'always') {
                enforceTrustedDevice(req);
            }
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

const requireOtpAssurance = (req, res, next) => {
    enforceOtpAssurance(req);
    return next();
};

const protectPhoneFactorProof = asyncHandler(async (req, res, next) => {
    if (!req.headers.authorization?.startsWith('Bearer')) {
        throw new AppError('Not authorized, no token', 401);
    }

    try {
        const token = req.headers.authorization.split(' ')[1];
        const decodedToken = await firebaseAdmin.auth().verifyIdToken(token, true);
        const verifiedPhone = normalizePhone(decodedToken?.phone_number || '');

        req.authUid = decodedToken?.uid || '';
        req.authToken = decodedToken;

        if (!verifiedPhone || !PHONE_REGEX.test(verifiedPhone)) {
            throw new AppError('Firebase phone verification is required before continuing.', 403);
        }

        return next();
    } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error('auth.phone_factor_verify_failed', { error: error?.message || 'unknown' });
        throw new AppError('Not authorized, token failed', 401);
    }
});

const requireActiveAccount = asyncHandler(async (req, res, next) => {
    if (!req.user) {
        return next(new AppError('Not authorized', 401));
    }
    
    const suspendedUntil = getSuspendedUntilDate(req.user);
    const isSuspended = req.user.accountState === 'suspended'
        && Boolean(suspendedUntil)
        && suspendedUntil.getTime() > Date.now();
        
    if (isSuspended) {
        return next(new AppError(
            `Your account is temporarily suspended until ${suspendedUntil.toISOString()}. Contact support for urgent review.`,
            423
        ));
    }
    return next();
});

const protectOptional = asyncHandler(async (req, res, next) => {
    if (!req.headers.authorization?.startsWith('Bearer')) {
        return next();
    }

    return protect(req, res, next);
});

// Invalidate a user from Redis cache (call on profile update, logout, suspension, etc.)
const invalidateUserCache = async (uid) => {
    if (!uid) return;
    try {
        const client = getRedisClient();
        if (!client) return;
        await client.del(`${AUTH_CACHE_PREFIX}${uid}`);
    } catch (err) {
        logger.warn('auth.cache_invalidate_failed', { uid, error: err?.message });
    }
};

const invalidateUserCacheByEmail = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;

    try {
        const client = getRedisClient();
        if (!client) return;
        // SCAN for all auth cache keys and check email field
        let cursor = 0;
        do {
            const scanResult = await client.scan(cursor, { MATCH: `${AUTH_CACHE_PREFIX}*`, COUNT: 100 });
            cursor = scanResult.cursor;
            for (const key of scanResult.keys) {
                try {
                    const raw = await client.get(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    if (normalizeEmail(parsed?.email) === normalizedEmail) {
                        await client.del(key);
                    }
                } catch { /* skip malformed entries */ }
            }
        } while (cursor !== 0);
    } catch (err) {
        logger.warn('auth.cache_invalidate_by_email_failed', { email: normalizedEmail, error: err?.message });
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
            await setCachedUser(req.authUid, freshUser, tokenExp);
        } else {
            await invalidateUserCache(req.authUid);
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

    enforceTrustedDevice(req);

    return next();
});

const seller = (req, res, next) => {
    if (req.user?.isSeller) {
        enforceTrustedDevice(req);
        return next();
    }
    throw new AppError('Seller account required. Activate seller mode to continue.', 403);
};

module.exports = {
    protect,
    protectPhoneFactorProof,
    protectOptional,
    requireOtpAssurance,
    requireActiveAccount,
    admin,
    seller,
    invalidateUserCache,
    invalidateUserCacheByEmail,
};
