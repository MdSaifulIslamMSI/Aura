const firebaseAdmin = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getRedisClient, flags: redisFlags } = require('../config/redis');
const {
    normalizeEmail,
    normalizeUid,
    normalizeText: normalizeIdentityText,
    buildInternalAuthEmail,
    buildIdentityQuery,
    resolveEmailVerifiedState,
} = require('../utils/authIdentity');
const {
    TRUSTED_DEVICE_SESSION_HEADER,
    extractTrustedDeviceContext,
    verifyTrustedDeviceSession,
} = require('../services/trustedDeviceChallengeService');
const {
    getBrowserSessionFromRequest,
    resolveSessionIdFromRequest,
    revokeBrowserSession,
    touchBrowserSession,
} = require('../services/browserSessionService');
const {
    flags: trustedDeviceFlags,
    shouldRequireTrustedDevice,
} = require('../config/authTrustedDeviceFlags');
const { getCachedAdaptiveSecuritySignal } = require('../services/healthService');
const { findPreferredIdentityUserLean } = require('../services/authIdentityResolutionService');

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
    authUid: 1,
    phone: 1,
    trustedDevices: 1,
    recoveryCodeState: 1,
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

const normalizePhone = (value) => (
    typeof value === 'string'
        ? value.trim().replace(/[\s\-()]/g, '')
        : ''
);
const normalizeText = (value) => (
    typeof value === 'string'
        ? value.trim()
        : ''
);
const normalizeName = (value, fallbackEmail = '') => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw) return raw;
    const emailPrefix = (fallbackEmail || '').split('@')[0] || '';
    return emailPrefix || 'Aura User';
};
const resolveFirebaseUserRecordEmail = (userRecord = null) => {
    const directEmail = normalizeEmail(userRecord?.email || '');
    if (directEmail) return directEmail;

    if (!Array.isArray(userRecord?.providerData)) {
        return '';
    }

    for (const providerEntry of userRecord.providerData) {
        const providerEmail = normalizeEmail(providerEntry?.email || '');
        if (providerEmail) {
            return providerEmail;
        }
    }

    return '';
};
const resolveFirebaseUserRecordPhone = (userRecord = null) => {
    const rawPhone = normalizePhone(userRecord?.phoneNumber || '');
    return PHONE_REGEX.test(rawPhone) ? rawPhone : '';
};
const resolveDecodedTokenIdentity = async (decodedToken = null) => {
    const uid = normalizeText(decodedToken?.uid || '');
    const identity = {
        uid,
        email: normalizeEmail(decodedToken?.email || ''),
        phone: normalizePhone(decodedToken?.phone_number || ''),
        name: normalizeText(decodedToken?.name || ''),
        emailVerified: Boolean(decodedToken?.email_verified),
    };

    if (identity.phone && !PHONE_REGEX.test(identity.phone)) {
        identity.phone = '';
    }

    if (identity.email || !uid) {
        return identity;
    }

    try {
        const firebaseUserRecord = await firebaseAdmin.auth().getUser(uid);
        const fallbackEmail = resolveFirebaseUserRecordEmail(firebaseUserRecord);

        return {
            ...identity,
            email: fallbackEmail,
            phone: resolveFirebaseUserRecordPhone(firebaseUserRecord) || identity.phone,
            name: normalizeName(firebaseUserRecord?.displayName || identity.name, fallbackEmail),
            emailVerified: Boolean(firebaseUserRecord?.emailVerified ?? identity.emailVerified),
        };
    } catch (error) {
        logger.warn('auth.user_record_lookup_failed', {
            uid,
            error: error?.message || 'unknown',
        });
        return identity;
    }
};

const AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED = parseBooleanEnv(process.env.AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED, false);
const ADMIN_STRICT_ACCESS_ENABLED = parseBooleanEnv(process.env.ADMIN_STRICT_ACCESS_ENABLED, true);
const ADMIN_REQUIRE_EMAIL_VERIFIED = parseBooleanEnv(process.env.ADMIN_REQUIRE_EMAIL_VERIFIED, true);
const ADMIN_REQUIRE_2FA = parseBooleanEnv(process.env.ADMIN_REQUIRE_2FA, false);
const ADMIN_REQUIRE_ALLOWLIST = parseBooleanEnv(process.env.ADMIN_REQUIRE_ALLOWLIST, false);
const ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = parsePositiveIntEnv(process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES, 30);
const SENSITIVE_ACTION_FRESH_LOGIN_MINUTES = parsePositiveIntEnv(process.env.AUTH_SENSITIVE_FRESH_LOGIN_MINUTES, 15);
const DEGRADED_ACTION_FRESH_LOGIN_MINUTES = parsePositiveIntEnv(process.env.AUTH_DEGRADED_FRESH_LOGIN_MINUTES, 5);
const REQUIRE_CRYPTO_DEVICE_FOR_SENSITIVE_ACTIONS = parseBooleanEnv(process.env.AUTH_REQUIRE_CRYPTO_DEVICE_FOR_SENSITIVE_ACTIONS, true);
const AUTH_ADAPTIVE_SECURITY_ENABLED = parseBooleanEnv(process.env.AUTH_ADAPTIVE_SECURITY_ENABLED, true);
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

const bootstrapUserRecord = async ({ decodedToken, email, authUid = '' }) => {
    const safeUid = normalizeUid(authUid || decodedToken?.uid || '');
    const safeEmail = normalizeEmail(email) || buildInternalAuthEmail(safeUid);
    const safeName = normalizeName(decodedToken?.name, safeEmail);
    const tokenPhone = normalizePhone(decodedToken?.phone_number || '');
    const safePhone = PHONE_REGEX.test(tokenPhone) ? tokenPhone : '';
    const identityQuery = buildIdentityQuery({ email: safeEmail, authUid: safeUid });

    if (!identityQuery) {
        throw new AppError('Authenticated account is missing identity', 401);
    }

    const buildUpdate = (includePhone) => ({
        $setOnInsert: {
            email: safeEmail,
            ...(safeUid ? { authUid: safeUid } : {}),
            name: safeName,
            isVerified: safeUid
                ? Boolean(decodedToken?.email_verified ?? true)
                : Boolean(decodedToken?.email_verified),
            authAssurance: 'none',
            ...(includePhone ? { phone: safePhone } : {}),
        },
    });

    try {
        return await User.findOneAndUpdate(
            identityQuery,
            buildUpdate(true),
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, projection: AUTH_PROJECTION, lean: true }
        );
    } catch (error) {
        if (!isDuplicatePhoneError(error)) throw error;
        return User.findOneAndUpdate(
            identityQuery,
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

const isTrustedDeviceBypassPath = (req = {}) => {
    const path = String(req.originalUrl || '').toLowerCase();
    return path.startsWith('/api/auth/session')
        || path.startsWith('/api/auth/exchange')
        || path.startsWith('/api/auth/sync')
        || path.startsWith('/api/auth/verify-device')
        || path.startsWith('/api/auth/logout');
};

const getTrustedDeviceSessionToken = (req = {}) => String(
    req.get?.(TRUSTED_DEVICE_SESSION_HEADER)
    || req.headers?.[TRUSTED_DEVICE_SESSION_HEADER]
    || ''
).trim();

const getTrustedDeviceSessionVerification = (req = {}) => {
    if (req._trustedDeviceSessionVerification) {
        return req._trustedDeviceSessionVerification;
    }

    const { deviceId } = extractTrustedDeviceContext(req);
    const deviceSessionToken = getTrustedDeviceSessionToken(req);

    if (!deviceId || !deviceSessionToken) {
        req._trustedDeviceSessionVerification = { success: false, reason: 'Trusted device verification missing' };
        return req._trustedDeviceSessionVerification;
    }

    req._trustedDeviceSessionVerification = verifyTrustedDeviceSession({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceId,
        deviceSessionToken,
    });
    return req._trustedDeviceSessionVerification;
};

const hasTrustedDeviceSecondFactor = (req = {}) => {
    if (!shouldRequireTrustedDevice({ user: req.user })) {
        return false;
    }

    return getTrustedDeviceSessionVerification(req).success;
};

const hasSessionSecondFactor = (req = {}) => {
    const sessionAmr = Array.isArray(req.authSession?.amr)
        ? req.authSession.amr.map((entry) => String(entry || '').trim().toLowerCase())
        : [];

    return sessionAmr.some((entry) => (
        entry === 'firebase_mfa'
        || entry === 'webauthn'
        || entry === 'trusted_device'
    ));
};

const hasSessionTrustedDeviceBinding = (req = {}) => {
    const requestDeviceId = String(extractTrustedDeviceContext(req)?.deviceId || '').trim();
    const sessionDeviceId = String(req.authSession?.deviceId || '').trim();
    const sessionDeviceMethod = String(req.authSession?.deviceMethod || '').trim().toLowerCase();

    if (!requestDeviceId || !sessionDeviceId || requestDeviceId !== sessionDeviceId) {
        return false;
    }

    if (sessionDeviceMethod === 'webauthn' || sessionDeviceMethod === 'browser_key') {
        return true;
    }

    return hasSessionSecondFactor(req);
};

const hasActiveSessionStepUp = (req = {}) => {
    const stepUpUntilMs = req.authSession?.stepUpUntil
        ? new Date(req.authSession.stepUpUntil).getTime()
        : 0;
    if (!Number.isFinite(stepUpUntilMs) || stepUpUntilMs <= Date.now()) {
        return false;
    }

    const sessionAal = String(req.authSession?.aal || '').trim().toLowerCase();
    const sessionDeviceMethod = String(req.authSession?.deviceMethod || '').trim().toLowerCase();
    return sessionAal === 'aal2'
        || sessionDeviceMethod === 'webauthn'
        || sessionDeviceMethod === 'browser_key'
        || hasSessionSecondFactor(req);
};

const enforceTrustedDevice = (req) => {
    if (!shouldRequireTrustedDevice({ user: req.user }) || isTrustedDeviceBypassPath(req)) {
        return;
    }

    const verification = getTrustedDeviceSessionVerification(req);

    if (!verification.success && !hasSessionTrustedDeviceBinding(req)) {
        throw new AppError('Trusted device verification required for this account', 403);
    }
};

const normalizePath = (value) => String(value || '').trim().toLowerCase();

const resolveRequestSensitivity = (req = {}) => {
    const method = String(req.method || 'GET').trim().toUpperCase();
    const path = normalizePath(req.originalUrl || req.path || '');

    if (!path || path.startsWith('/health')) return 'bypass';
    if (path.startsWith('/api/auth/')) return 'bypass';
    if (path.startsWith('/api/admin/')) return 'privileged';
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return 'standard';
    if (path.startsWith('/api/payments/')) return 'sensitive';
    if (path.startsWith('/api/orders/')) return 'sensitive';
    if (path.startsWith('/api/listings/')) return 'sensitive';
    if (path.startsWith('/api/support/') && path.includes('/video/')) return 'sensitive';
    return 'standard';
};

const resolveTrustedDeviceMethod = (req = {}) => {
    const sessionMethod = String(req.authSession?.deviceMethod || '').trim().toLowerCase();
    if (sessionMethod === 'webauthn' || sessionMethod === 'browser_key') {
        return sessionMethod;
    }

    const candidateDeviceId = String(
        extractTrustedDeviceContext(req)?.deviceId
        || req.authSession?.deviceId
        || ''
    ).trim();

    if (!candidateDeviceId || !Array.isArray(req.user?.trustedDevices)) {
        return '';
    }

    const registration = req.user.trustedDevices.find((entry) => String(entry?.deviceId || '').trim() === candidateDeviceId);
    const registrationMethod = String(
        registration?.method
        || (registration?.webauthnCredentialIdBase64Url ? 'webauthn' : '')
    ).trim().toLowerCase();

    if (registrationMethod === 'webauthn' || registrationMethod === 'browser_key') {
        return registrationMethod;
    }

    return '';
};

const hasCryptographicTrustedDeviceBinding = (req = {}) => {
    const method = resolveTrustedDeviceMethod(req);
    if (method !== 'webauthn' && method !== 'browser_key') {
        return false;
    }

    return hasSessionTrustedDeviceBinding(req) || getTrustedDeviceSessionVerification(req).success;
};

const resolveAuthAgeSeconds = (req = {}) => {
    const sessionAuthTime = Number(req.authSession?.authTimeSeconds || 0);
    if (Number.isFinite(sessionAuthTime) && sessionAuthTime > 0) {
        return Math.max(Math.floor(Date.now() / 1000) - sessionAuthTime, 0);
    }

    const tokenAuthTime = resolveAuthTimeSeconds(req.authToken);
    return tokenAuthTime > 0
        ? Math.max(Math.floor(Date.now() / 1000) - tokenAuthTime, 0)
        : Number.POSITIVE_INFINITY;
};

const buildRequestPosture = (req = {}, options = {}) => {
    const freshnessMinutes = parsePositiveIntEnv(
        options?.freshnessMinutes,
        SENSITIVE_ACTION_FRESH_LOGIN_MINUTES
    );
    const authAgeSeconds = resolveAuthAgeSeconds(req);
    const trustedDeviceSessionVerified = getTrustedDeviceSessionVerification(req).success;
    const deviceBound = hasSessionTrustedDeviceBinding(req) || trustedDeviceSessionVerified;
    const cryptoBound = hasCryptographicTrustedDeviceBinding(req);
    const freshByAuthAge = Number.isFinite(authAgeSeconds) && authAgeSeconds <= (freshnessMinutes * 60);
    const freshByStepUp = hasActiveSessionStepUp(req);
    const riskState = String(
        req.authSession?.riskState
        || (req.user?.isAdmin ? 'privileged' : req.user?.isSeller ? 'heightened' : 'standard')
    ).trim().toLowerCase() || 'standard';
    const trustedDeviceRequired = shouldRequireTrustedDevice({ user: req.user });
    const elevatedAssurance = Boolean(
        hasOtpAssurance(req)
        || hasSessionSecondFactor(req)
        || trustedDeviceSessionVerified
        || req.authToken?.firebase?.sign_in_second_factor
        || (String(req.authSession?.aal || '').trim().toLowerCase() === 'aal2')
    );

    return {
        sensitivity: options?.sensitivity || resolveRequestSensitivity(req),
        fresh: freshByAuthAge || freshByStepUp,
        authAgeSeconds,
        authFreshnessWindowSeconds: freshnessMinutes * 60,
        stepUpFresh: freshByStepUp,
        deviceBound,
        cryptoBound,
        trustedDeviceRequired,
        cryptoTrustedDeviceRequired: Boolean(trustedDeviceRequired && REQUIRE_CRYPTO_DEVICE_FOR_SENSITIVE_ACTIONS),
        riskState,
        riskHigh: riskState !== 'standard',
        elevatedAssurance,
        continuousAccess: Boolean(
            (freshByAuthAge || freshByStepUp)
            && (!trustedDeviceRequired || deviceBound)
            && (riskState === 'standard' || elevatedAssurance)
        ),
    };
};

const getAdaptiveSecuritySignalForRequest = async (req = {}) => {
    if (req._adaptiveSecuritySignal) {
        return req._adaptiveSecuritySignal;
    }

    req._adaptiveSecuritySignal = AUTH_ADAPTIVE_SECURITY_ENABLED
        ? await getCachedAdaptiveSecuritySignal()
        : {
            status: 'ok',
            mode: 'standard',
            degradedSignals: [],
            restrictSensitiveActions: false,
            requireStepUpForSensitiveActions: false,
            evaluatedAt: new Date().toISOString(),
            cacheState: 'disabled',
        };

    return req._adaptiveSecuritySignal;
};

const enforceContinuousAccessPosture = async (req) => {
    const sensitivity = resolveRequestSensitivity(req);
    if (sensitivity === 'bypass' || sensitivity === 'standard') {
        req.authzPosture = buildRequestPosture(req, { sensitivity });
        return;
    }

    const adaptiveSignal = await getAdaptiveSecuritySignalForRequest(req);
    const freshnessMinutes = adaptiveSignal.requireStepUpForSensitiveActions
        ? DEGRADED_ACTION_FRESH_LOGIN_MINUTES
        : SENSITIVE_ACTION_FRESH_LOGIN_MINUTES;
    const posture = buildRequestPosture(req, { sensitivity, freshnessMinutes });
    req.authzPosture = {
        ...posture,
        adaptiveSecurity: adaptiveSignal,
    };

    if (adaptiveSignal.restrictSensitiveActions) {
        logger.warn('auth.posture.blocked_system_restricted', {
            requestId: req.requestId || '',
            path: req.originalUrl,
            sensitivity,
            degradedSignals: adaptiveSignal.degradedSignals,
        });
        throw new AppError('Sensitive actions are temporarily restricted while platform dependencies recover.', 503);
    }

    if (!posture.fresh) {
        throw new AppError(`Recent re-authentication required within ${freshnessMinutes} minutes for this action.`, 401);
    }

    if (posture.trustedDeviceRequired && !posture.deviceBound) {
        throw new AppError('Trusted device verification required for this action.', 403);
    }

    if (posture.cryptoTrustedDeviceRequired && !posture.cryptoBound) {
        throw new AppError('A cryptographically verified trusted device is required for this action.', 403);
    }

    if (posture.riskHigh && !posture.elevatedAssurance) {
        throw new AppError('A stronger verified session is required for this action.', 403);
    }

    if (adaptiveSignal.requireStepUpForSensitiveActions && !posture.elevatedAssurance) {
        throw new AppError('Sensitive actions require step-up verification while the system is degraded.', 403);
    }
};

const buildSyntheticAuthTokenFromSession = (session = {}) => {
    const providerIds = Array.isArray(session?.providerIds)
        ? session.providerIds.map((providerId) => String(providerId || '').trim()).filter(Boolean)
        : [];
    const primaryProviderId = providerIds[0] || '';
    const signInSecondFactor = hasSessionSecondFactor({ authSession: session })
        ? (String(session?.deviceMethod || '').trim() || 'trusted_device')
        : '';

    return {
        uid: String(session?.firebaseUid || '').trim(),
        email: String(session?.email || '').trim(),
        email_verified: Boolean(session?.emailVerified),
        name: String(session?.displayName || '').trim(),
        phone_number: String(session?.phoneNumber || '').trim(),
        auth_time: Number(session?.authTimeSeconds || 0) || 0,
        iat: Number(session?.issuedAtSeconds || 0) || 0,
        exp: Number(session?.firebaseExpiresAtSeconds || 0) || 0,
        firebase: {
            sign_in_provider: primaryProviderId,
            ...(signInSecondFactor ? { sign_in_second_factor: signInSecondFactor } : {}),
        },
    };
};

const buildSyntheticAuthIdentityFromSession = (session = {}) => ({
    uid: String(session?.firebaseUid || '').trim(),
    email: String(session?.email || '').trim(),
    displayName: String(session?.displayName || '').trim(),
    phoneNumber: String(session?.phoneNumber || '').trim(),
    emailVerified: Boolean(session?.emailVerified),
});

const scheduleBrowserSessionTouch = (req, res, session) => {
    if (!session?.sessionId || req._browserSessionTouchScheduled || typeof res?.once !== 'function') {
        return;
    }

    if (String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase() === 'cross-site') {
        return;
    }

    req._browserSessionTouchScheduled = true;
    res.once('finish', () => {
        if (Number(res.statusCode || 200) >= 400) {
            return;
        }

        touchBrowserSession(session)
            .then((touchedSession) => {
                if (
                    touchedSession?.sessionId
                    && req.authSession?.sessionId === touchedSession.sessionId
                ) {
                    req.authSession = touchedSession;
                }
            })
            .catch((error) => {
                logger.warn('auth.session_touch_failed', {
                    sessionId: session.sessionId,
                    error: error?.message || 'unknown',
                });
            });
    });
};

const authenticateWithBrowserSession = async (req, res) => {
    const sessionId = resolveSessionIdFromRequest(req);
    if (!sessionId) {
        return false;
    }

    const session = await getBrowserSessionFromRequest(req);
    if (!session?.sessionId) {
        throw new AppError('Not authorized, session expired', 401);
    }

    const user = await User.findById(session.userId, AUTH_PROJECTION).lean();
    if (!user) {
        await revokeBrowserSession(session.sessionId);
        throw new AppError('Not authorized, session expired', 401);
    }

    enforceUserAccountAccess(user);

    req.authSession = session;
    req.authUid = String(req.authSession?.firebaseUid || '').trim();
    req.authToken = buildSyntheticAuthTokenFromSession(req.authSession);
    req.authIdentity = buildSyntheticAuthIdentityFromSession(req.authSession);
    req.user = user;
    scheduleBrowserSessionTouch(req, res, session);

    return true;
};

const finalizeProtectedRequest = async (req, next) => {
    if (AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED) {
        enforceOtpAssurance(req);
    }
    if (trustedDeviceFlags.authDeviceChallengeMode === 'always') {
        enforceTrustedDevice(req);
    }
    await enforceContinuousAccessPosture(req);
    return next();
};

const protect = asyncHandler(async (req, res, next) => {
    let token;
    const hasBearerAuthorization = Boolean(req.headers.authorization?.startsWith('Bearer '));

    if (hasBearerAuthorization) {
        const supersededSessionId = resolveSessionIdFromRequest(req);
        if (supersededSessionId) {
            req.supersededAuthSessionId = supersededSessionId;
        }
    }

    if (!hasBearerAuthorization) {
        try {
            const authenticatedWithSession = await authenticateWithBrowserSession(req, res);
            if (authenticatedWithSession) {
                return finalizeProtectedRequest(req, next);
            }
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            logger.error('auth.session_verify_failed', { error: error?.message || 'unknown' });
            throw new AppError('Not authorized, session failed', 401);
        }
    } else {
        // Fresh Firebase proof must win over any stale browser cookie during
        // auth bootstrap, session exchange, and phone-factor completion.
        req.authSession = null;
    }

    if (req.headers.authorization?.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // ── Step 1: Verify Firebase token ──────────────────────
            const decodedToken = await firebaseAdmin.auth().verifyIdToken(token, true);
            const { uid, exp } = decodedToken;
            const resolvedIdentity = await resolveDecodedTokenIdentity(decodedToken);
            req.authUid = uid;
            req.authToken = {
                ...decodedToken,
                email: resolvedIdentity.email,
                name: resolvedIdentity.name,
                phone_number: resolvedIdentity.phone,
                email_verified: resolvedIdentity.emailVerified,
            };
            req.authIdentity = {
                uid,
                email: resolvedIdentity.email,
                displayName: resolvedIdentity.name,
                phoneNumber: resolvedIdentity.phone,
                emailVerified: resolvedIdentity.emailVerified,
            };
            const normalizedEmail = normalizeEmail(resolvedIdentity.email);
            const accountEmail = normalizedEmail || buildInternalAuthEmail(uid);
            if (!accountEmail && !uid) {
                throw new AppError('Authenticated account is missing identity', 401);
            }

                        // ── Step 2: Check Redis cache first ─────────────────────────────────────
             const cachedUser = await getCachedUser(uid);
            if (cachedUser) {
                const cachedEmail = normalizeEmail(cachedUser.email || '');
                const cacheMatchesResolvedIdentity = !normalizedEmail || cachedEmail === normalizedEmail;

                if (cacheMatchesResolvedIdentity) {
                    enforceUserAccountAccess(cachedUser);
                    req.user = cachedUser;
                    return finalizeProtectedRequest(req, next);
                }

                await invalidateUserCache(uid);
            }

            // ── Step 3: Lean MongoDB query with projection ──────────
            // .lean() returns plain JS object (no Mongoose overhead)
            // AUTH_PROJECTION excludes cart/wishlist (reduces wire transfer)
            const user = await findPreferredIdentityUserLean({
                email: accountEmail,
                authUid: uid,
                projection: AUTH_PROJECTION,
            });

            if (!user) {
                const bootstrappedUser = await bootstrapUserRecord({
                    decodedToken: req.authToken,
                    email: accountEmail,
                    authUid: uid,
                });
                enforceUserAccountAccess(bootstrappedUser);
                await setCachedUser(uid, bootstrappedUser, exp);
                req.user = bootstrappedUser;
                return finalizeProtectedRequest(req, next);
            }

            // ── Step 4: Write to Redis cache for subsequent requests ──────
             enforceUserAccountAccess(user);
            await setCachedUser(uid, user, exp);

            req.user = user;
            return finalizeProtectedRequest(req, next);
        } catch (error) {
            if (error instanceof AppError) throw error;
            logger.error('auth.verify_failed', { error: error.message });
            throw new AppError('Not authorized, token failed', 401);
        }
    } else {
        throw new AppError('Not authorized, no session', 401);
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
    if (!req.headers.authorization?.startsWith('Bearer') && !resolveSessionIdFromRequest(req)) {
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
    const emailVerified = resolveEmailVerifiedState({
        authUser: {
            uid: normalizeIdentityText(req.authIdentity?.uid || req.authUid || ''),
            email: normalizeEmail(req.authIdentity?.email || req.authToken?.email || req.user?.email || ''),
            emailVerified: req.authIdentity?.emailVerified,
            isVerified: req.user?.isVerified,
            providerIds: Array.isArray(req.authSession?.providerIds)
                ? req.authSession.providerIds
                : [],
            signInProvider: normalizeIdentityText(req.authToken?.firebase?.sign_in_provider || ''),
        },
        authToken: req.authToken || null,
        authSession: req.authSession || null,
        authUid: req.authUid || '',
        user: req.user || null,
    });
    const authTime = Number(req.authToken?.auth_time || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionAgeSeconds = authTime > 0 ? (nowSeconds - authTime) : Number.POSITIVE_INFINITY;
    const hasSecondFactor = Boolean(req.authToken?.firebase?.sign_in_second_factor)
        || hasTrustedDeviceSecondFactor(req)
        || hasSessionSecondFactor(req);

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
        throw new AppError('Admin access requires a verified second factor', 403);
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
