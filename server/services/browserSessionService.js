const crypto = require('crypto');
const logger = require('../utils/logger');
const { getRedisClient, flags: redisFlags } = require('../config/redis');
const {
    normalizeEmail,
    resolveProviderIds,
    resolveEmailVerifiedState,
} = require('../utils/authIdentity');
const { extractTrustedDeviceContext } = require('./trustedDeviceChallengeService');
const { verifyDpopProof } = require('../utils/dpop');

const SESSION_COOKIE_NAME = String(process.env.AUTH_SESSION_COOKIE_NAME || 'aura_sid').trim() || 'aura_sid';
const SESSION_PREFIX = `{${redisFlags.redisPrefix}:auth}:session:`;
const GLOBAL_SESSION_REVOKED_AFTER_KEY = `{${redisFlags.redisPrefix}:auth}:session:global_revoked_after`;
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const SESSION_IDLE_TTL_MS = Math.max(Number(process.env.AUTH_SESSION_IDLE_TTL_MS || (8 * 60 * 60 * 1000)), 5 * 60 * 1000);
const SESSION_ABSOLUTE_TTL_MS = Math.max(Number(process.env.AUTH_SESSION_ABSOLUTE_TTL_MS || (7 * 24 * 60 * 60 * 1000)), SESSION_IDLE_TTL_MS);
const SESSION_TOUCH_INTERVAL_MS = Math.max(Number(process.env.AUTH_SESSION_TOUCH_INTERVAL_MS || (5 * 60 * 1000)), 30 * 1000);
const SESSION_STEP_UP_TTL_MS = Math.max(Number(process.env.AUTH_SESSION_STEP_UP_TTL_MS || (10 * 60 * 1000)), 60 * 1000);
const GLOBAL_SESSION_REVOCATION_CACHE_MS = Math.max(
    Number(process.env.AUTH_GLOBAL_SESSION_REVOCATION_CACHE_MS || 1000),
    100
);
const SESSION_DEFAULT_SAME_SITE = String(process.env.AUTH_SESSION_SAME_SITE || 'lax').trim().toLowerCase();
const SESSION_ADMIN_HOSTS = new Set(
    String(process.env.AUTH_SESSION_ADMIN_HOSTS || '')
        .split(',')
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
);

const inMemorySessionStore = new Map();
let inMemoryGlobalSessionRevokedAfter = 0;
let globalSessionRevocationCacheExpiresAt = 0;

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const isMemorySessionFallbackAllowed = () => parseBooleanEnv(
    process.env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK,
    !IS_PRODUCTION
);

const shouldSetSecureSessionCookie = () => parseBooleanEnv(
    process.env.AUTH_SESSION_COOKIE_SECURE,
    IS_PRODUCTION
);

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeUserId = (value) => String(value || '').trim();
const getUserSessionsKey = (userId) => `{${redisFlags.redisPrefix}:auth}:user_sessions:${normalizeUserId(userId)}`;

const normalizeHost = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

const LOOPBACK_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
]);

const parseOriginContext = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return {
            protocol: '',
            host: '',
        };
    }

    try {
        const url = new URL(normalized);
        return {
            protocol: String(url.protocol || '').replace(/:$/, '').trim().toLowerCase(),
            host: normalizeHost(url.host || url.hostname || ''),
        };
    } catch {
        return {
            protocol: '',
            host: normalizeHost(normalized),
        };
    }
};

const toIsoOrNull = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toEpochSeconds = (value) => {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
};

const epochSecondsToIso = (value) => {
    const epochSeconds = toEpochSeconds(value);
    if (!epochSeconds) return null;
    return new Date(epochSeconds * 1000).toISOString();
};

const getScopeForUser = (user = null) => {
    if (user?.isAdmin) return 'admin';
    if (user?.isSeller) return 'seller';
    return 'consumer';
};

const getStoredTrustedDeviceMethod = (session = null) => {
    const normalized = String(session?.deviceMethod || '').trim().toLowerCase();
    if (normalized === 'webauthn' || normalized === 'browser_key') {
        return normalized;
    }
    return '';
};

const normalizeAmr = (value = []) => {
    const normalized = Array.isArray(value)
        ? value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : [];
    return Array.from(new Set(normalized));
};

const buildProviderAmr = (providerIds = []) => {
    const [providerId = ''] = Array.isArray(providerIds) ? providerIds : [];
    const normalizedProvider = String(providerId || '').trim().toLowerCase();

    if (normalizedProvider === 'password') return 'password';
    if (normalizedProvider === 'phone') return 'phone';
    if (normalizedProvider === 'google.com') return 'social_google';
    if (normalizedProvider === 'facebook.com') return 'social_facebook';
    if (normalizedProvider === 'github.com') return 'social_github';
    if (normalizedProvider === 'twitter.com' || normalizedProvider === 'x.com') return 'social_x';
    if (normalizedProvider) return `provider_${normalizedProvider.replace(/[^a-z0-9_]/g, '_')}`;
    return 'firebase';
};

const resolveStepUpExpiry = (user = null) => {
    const expiresAt = user?.loginOtpAssuranceExpiresAt ? new Date(user.loginOtpAssuranceExpiresAt).getTime() : 0;
    return Number.isFinite(expiresAt) && expiresAt > Date.now()
        ? new Date(expiresAt).toISOString()
        : null;
};

const resolveSyntheticAssurance = ({
    user = null,
    authToken = null,
    previousSession = null,
    deviceMethod = '',
    stepUpUntil = null,
    additionalAmr = [],
} = {}) => {
    const providerIds = resolveProviderIds({ previousSession, authToken });
    const nextAmr = [
        buildProviderAmr(providerIds),
        ...normalizeAmr(previousSession?.amr),
        ...normalizeAmr(additionalAmr),
    ];

    if (Boolean(authToken?.firebase?.sign_in_second_factor)) {
        nextAmr.push('firebase_mfa');
    }
    if (String(user?.authAssurance || '').trim() === 'password+otp') {
        nextAmr.push('otp');
    }
    if (deviceMethod === 'webauthn') {
        nextAmr.push('webauthn');
    } else if (deviceMethod === 'browser_key') {
        nextAmr.push('trusted_device');
    } else if (getStoredTrustedDeviceMethod(previousSession) === 'webauthn') {
        nextAmr.push('webauthn');
    } else if (getStoredTrustedDeviceMethod(previousSession) === 'browser_key') {
        nextAmr.push('trusted_device');
    }

    const normalizedAmr = normalizeAmr(nextAmr);
    const stepUpExpiry = toIsoOrNull(stepUpUntil)
        || resolveStepUpExpiry(user)
        || toIsoOrNull(previousSession?.stepUpUntil);
    const hasActiveStepUp = Boolean(
        stepUpExpiry && new Date(stepUpExpiry).getTime() > Date.now()
    );
    const hasStrongFactor = normalizedAmr.some((entry) => (
        entry === 'firebase_mfa'
        || entry === 'webauthn'
        || entry === 'trusted_device'
    ));

    return {
        amr: normalizedAmr,
        aal: (hasStrongFactor || hasActiveStepUp) ? 'aal2' : 'aal1',
        stepUpUntil: hasActiveStepUp ? stepUpExpiry : null,
        deviceMethod: deviceMethod || getStoredTrustedDeviceMethod(previousSession),
    };
};

const resolveRiskState = ({ user = null, previousSession = null, riskState = '' } = {}) => {
    const explicitRiskState = normalizeText(riskState).toLowerCase();
    if (explicitRiskState) return explicitRiskState;
    if (user?.isAdmin) return 'privileged';
    if (user?.isSeller) return 'heightened';
    return String(previousSession?.riskState || 'standard').trim() || 'standard';
};

const getRedisKey = (sessionId = '') => `${SESSION_PREFIX}${String(sessionId || '').trim()}`;

const getCookieHeader = (req = {}) => String(
    req.headers?.cookie
    || req.headers?.Cookie
    || ''
);

const parseCookies = (cookieHeader = '') => String(cookieHeader || '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((accumulator, pair) => {
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex <= 0) return accumulator;
        const key = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        if (!key) return accumulator;
        try {
            accumulator[key] = decodeURIComponent(value);
        } catch {
            accumulator[key] = value;
        }
        return accumulator;
    }, {});

const resolveSessionIdFromCookieHeader = (cookieHeader = '') => (
    parseCookies(cookieHeader)[SESSION_COOKIE_NAME] || ''
);

const resolveSessionIdFromRequest = (req = {}) => resolveSessionIdFromCookieHeader(getCookieHeader(req));

const appendSetCookieHeader = (res, serializedCookie) => {
    const existing = res.getHeader('Set-Cookie');
    if (!existing) {
        res.setHeader('Set-Cookie', [serializedCookie]);
        return;
    }
    const nextCookies = Array.isArray(existing) ? [...existing, serializedCookie] : [existing, serializedCookie];
    res.setHeader('Set-Cookie', nextCookies);
};

const serializeCookie = (name, value, options = {}) => {
    const parts = [`${name}=${encodeURIComponent(String(value || ''))}`];
    if (options.maxAge !== undefined) {
        parts.push(`Max-Age=${Math.max(Number(options.maxAge || 0), 0)}`);
    }
    if (options.path) parts.push(`Path=${options.path}`);
    if (options.httpOnly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');
    if (options.sameSite) {
        const normalized = String(options.sameSite).trim().toLowerCase();
        if (normalized === 'strict') parts.push('SameSite=Strict');
        else if (normalized === 'none') parts.push('SameSite=None');
        else parts.push('SameSite=Lax');
    }
    if (options.expires) {
        parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
    }
    return parts.join('; ');
};

const isSecureRequest = (req = {}) => {
    if (!shouldSetSecureSessionCookie()) {
        return false;
    }

    if (IS_PRODUCTION) {
        return true;
    }

    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
    return Boolean(req.secure || forwardedProto === 'https');
};

const resolveRequestProtocol = (req = {}) => {
    if (isSecureRequest(req)) {
        return 'https';
    }
    return 'http';
};

const shouldUseCrossSiteCookieForOrigin = (req = {}) => {
    const { protocol: originProtocol, host: originHost } = parseOriginContext(req.headers?.origin || '');
    const requestHost = normalizeHost(req.headers?.host || req.hostname || '');
    const requestProtocol = resolveRequestProtocol(req);

    if (!originHost || !requestHost) {
        return false;
    }

    if (originHost === requestHost && (!originProtocol || originProtocol === requestProtocol)) {
        return false;
    }

    if (LOOPBACK_HOSTS.has(originHost)) {
        return true;
    }

    return originHost !== requestHost || (originProtocol && originProtocol !== requestProtocol);
};

const resolveSameSite = (req = {}) => {
    const host = normalizeHost(req.headers?.host || req.hostname || '');
    if (host && SESSION_ADMIN_HOSTS.has(host)) {
        return 'strict';
    }
    if (shouldUseCrossSiteCookieForOrigin(req) && isSecureRequest(req)) {
        return 'none';
    }
    if (SESSION_DEFAULT_SAME_SITE === 'strict' || SESSION_DEFAULT_SAME_SITE === 'none') {
        return SESSION_DEFAULT_SAME_SITE;
    }
    return 'lax';
};

const getCookieOptions = (req = {}) => ({
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: resolveSameSite(req),
    path: '/',
    maxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
});

const generateSessionId = () => crypto.randomBytes(32).toString('base64url');

const readMemorySessionRecord = (sessionId = '') => {
    const entry = inMemorySessionStore.get(String(sessionId || ''));
    if (!entry) return null;

    if (entry.absoluteExpiresAt <= Date.now() || entry.idleExpiresAt <= Date.now()) {
        inMemorySessionStore.delete(String(sessionId || ''));
        return null;
    }

    return entry.record;
};

const writeMemorySessionRecord = (record = {}) => {
    const absoluteExpiresAt = new Date(record.absoluteExpiresAt).getTime();
    const idleExpiresAt = new Date(record.idleExpiresAt).getTime();

    inMemorySessionStore.set(String(record.sessionId || ''), {
        record,
        absoluteExpiresAt,
        idleExpiresAt,
    });
};

const deleteMemorySessionRecord = (sessionId = '') => {
    inMemorySessionStore.delete(String(sessionId || ''));
};

const deleteMemorySessionRecordsForUser = (userId = '') => {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return 0;

    let revoked = 0;
    for (const [sessionId, entry] of inMemorySessionStore.entries()) {
        if (normalizeUserId(entry?.record?.userId) === normalizedUserId) {
            inMemorySessionStore.delete(sessionId);
            revoked += 1;
        }
    }
    return revoked;
};

const clearMemorySessionRecords = () => {
    const revoked = inMemorySessionStore.size;
    inMemorySessionStore.clear();
    return revoked;
};

const normalizeRevocationMs = (value) => {
    const numeric = Number(value || 0);
    if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const getSessionIssuedMs = (session = {}) => {
    const candidates = [
        Number(session?.createdAt ? new Date(session.createdAt).getTime() : 0),
        Number(session?.issuedAt ? new Date(session.issuedAt).getTime() : 0),
        Number(session?.issuedAtSeconds || 0) * 1000,
        Number(session?.authTimeSeconds || 0) * 1000,
    ];
    return candidates.find((value) => Number.isFinite(value) && value > 0) || 0;
};

const isSessionRevokedByGlobalEpoch = async (session = {}) => {
    const revokedAfterMs = await getGlobalSessionRevokedAfter();
    if (!revokedAfterMs) return false;
    const issuedMs = getSessionIssuedMs(session);
    return !issuedMs || issuedMs <= revokedAfterMs;
};

const getStorageMode = () => {
    if (getRedisClient()) return 'redis';
    return isMemorySessionFallbackAllowed() ? 'memory' : 'unavailable';
};

const calculateTtlSeconds = (record = {}) => {
    const now = Date.now();
    const absoluteExpiresAt = new Date(record.absoluteExpiresAt || 0).getTime();
    const idleExpiresAt = new Date(record.idleExpiresAt || 0).getTime();
    const ttlMs = Math.min(
        Number.isFinite(absoluteExpiresAt) ? Math.max(absoluteExpiresAt - now, 0) : SESSION_ABSOLUTE_TTL_MS,
        Number.isFinite(idleExpiresAt) ? Math.max(idleExpiresAt - now, 0) : SESSION_IDLE_TTL_MS,
    );
    return Math.max(Math.ceil(ttlMs / 1000), 1);
};

const persistSessionRecord = async (record = {}) => {
    const storageMode = getStorageMode();
    if (storageMode === 'memory') {
        writeMemorySessionRecord(record);
        return record;
    }
    if (storageMode === 'unavailable') {
        const error = new Error('Browser session store unavailable');
        error.code = 'AUTH_SESSION_STORE_UNAVAILABLE';
        logger.error('browser_session.store_unavailable', {
            sessionId: String(record.sessionId || '').trim(),
        });
        throw error;
    }

    const redisClient = getRedisClient();
    const normalizedSessionId = String(record.sessionId || '').trim();

    try {
        const ttlSeconds = calculateTtlSeconds(record);
        await redisClient.setEx(getRedisKey(normalizedSessionId), ttlSeconds, JSON.stringify(record));

        // Track the session ID in the user's active sessions Redis Set
        if (record.userId) {
            const normalizedUserId = normalizeUserId(record.userId);
            const userSessionsKey = getUserSessionsKey(normalizedUserId);
            await redisClient.sAdd(userSessionsKey, normalizedSessionId);
            await redisClient.expire(userSessionsKey, ttlSeconds);
        }

        deleteMemorySessionRecord(normalizedSessionId);
        return record;
    } catch (error) {
        if (!isMemorySessionFallbackAllowed()) {
            logger.error('browser_session.persist_failed_no_fallback', {
                sessionId: normalizedSessionId,
                error: error?.message || 'unknown',
            });
            throw error;
        }
        logger.warn('browser_session.persist_failed_memory_fallback', {
            sessionId: normalizedSessionId,
            error: error?.message || 'unknown',
        });
        writeMemorySessionRecord(record);
        return record;
    }
};

const loadSessionRecord = async (sessionId = '') => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;

    const storageMode = getStorageMode();
    let record = null;

    if (storageMode === 'memory') {
        record = readMemorySessionRecord(normalizedSessionId);
    } else if (storageMode === 'unavailable') {
        logger.error('browser_session.store_unavailable_read', {
            sessionId: normalizedSessionId,
        });
        return null;
    } else {
        try {
            const raw = await getRedisClient().get(getRedisKey(normalizedSessionId));
            record = raw ? JSON.parse(raw) : null;
        } catch (error) {
            const logPayload = {
                sessionId: normalizedSessionId,
                error: error?.message || 'unknown',
            };
            if (!isMemorySessionFallbackAllowed()) {
                logger.error('browser_session.read_failed_no_fallback', logPayload);
                return null;
            }
            logger.warn('browser_session.read_failed', logPayload);
        }

        if (!record && isMemorySessionFallbackAllowed()) {
            record = readMemorySessionRecord(normalizedSessionId);
        }
    }

    if (!record) return null;

    const now = Date.now();
    const absoluteExpiresAt = new Date(record.absoluteExpiresAt || 0).getTime();
    const idleExpiresAt = new Date(record.idleExpiresAt || 0).getTime();
    if (
        String(record.revokedAt || '').trim()
        || !Number.isFinite(absoluteExpiresAt)
        || !Number.isFinite(idleExpiresAt)
        || absoluteExpiresAt <= now
        || idleExpiresAt <= now
    ) {
        await revokeBrowserSession(normalizedSessionId);
        return null;
    }

    if (await isSessionRevokedByGlobalEpoch(record)) {
        await revokeBrowserSession(normalizedSessionId);
        return null;
    }

    return record;
};

const storeSessionRecord = async (record = {}) => {
    const now = Date.now();
    const absoluteExpiresAt = new Date(record.absoluteExpiresAt || now + SESSION_ABSOLUTE_TTL_MS).getTime();
    const lastSeenAt = new Date(record.lastSeenAt || now).getTime();

    const normalizedRecord = {
        ...record,
        absoluteExpiresAt: new Date(absoluteExpiresAt).toISOString(),
        idleExpiresAt: new Date(Math.min(lastSeenAt + SESSION_IDLE_TTL_MS, absoluteExpiresAt)).toISOString(),
    };

    return persistSessionRecord(normalizedRecord);
};

const buildSessionIdentitySnapshot = ({
    user = null,
    authUid = '',
    authToken = null,
    previousSession = null,
} = {}) => {
    const providerIds = resolveProviderIds({
        authSession: previousSession,
        authToken,
    });
    const email = normalizeEmail(previousSession?.email || authToken?.email || user?.email || '');
    const displayName = normalizeText(previousSession?.displayName || authToken?.name || user?.name || '');
    const phoneNumber = normalizeText(previousSession?.phoneNumber || authToken?.phone_number || user?.phone || '');

    return {
        firebaseUid: normalizeText(authUid || previousSession?.firebaseUid || ''),
        email,
        emailVerified: resolveEmailVerifiedState({
            authToken,
            authSession: previousSession,
            authUid,
            user,
        }),
        displayName,
        phoneNumber,
        providerIds,
        authTimeSeconds: toEpochSeconds(previousSession?.authTimeSeconds || authToken?.auth_time),
        issuedAtSeconds: toEpochSeconds(previousSession?.issuedAtSeconds || authToken?.iat),
        firebaseExpiresAtSeconds: toEpochSeconds(previousSession?.firebaseExpiresAtSeconds || authToken?.exp),
        signInSecondFactor: normalizeText(previousSession?.signInSecondFactor || authToken?.firebase?.sign_in_second_factor),
    };
};

const buildBrowserSessionRecord = ({
    sessionId = '',
    user = null,
    authUid = '',
    authToken = null,
    req = {},
    previousSession = null,
    deviceMethod = '',
    stepUpUntil = null,
    additionalAmr = [],
    riskState = '',
    dpopJwk = null,
} = {}) => {
    const now = new Date();
    const previousCreatedAt = previousSession?.createdAt ? new Date(previousSession.createdAt).getTime() : 0;
    const createdAt = previousCreatedAt > 0 ? new Date(previousCreatedAt) : now;
    const identity = buildSessionIdentitySnapshot({
        user,
        authUid,
        authToken,
        previousSession,
    });
    const { deviceId } = extractTrustedDeviceContext(req);
    const assurance = resolveSyntheticAssurance({
        user,
        authToken,
        previousSession,
        deviceMethod,
        stepUpUntil,
        additionalAmr,
    });
    const absoluteExpiresAt = new Date(createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS).toISOString();

    return {
        sessionId: String(sessionId || '').trim(),
        userId: String(user?._id || previousSession?.userId || '').trim(),
        firebaseUid: identity.firebaseUid,
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        phoneNumber: identity.phoneNumber,
        providerIds: identity.providerIds,
        signInSecondFactor: identity.signInSecondFactor,
        scope: getScopeForUser(user),
        aal: assurance.aal,
        amr: assurance.amr,
        deviceId: deviceId || previousSession?.deviceId || '',
        deviceMethod: assurance.deviceMethod,
        riskState: resolveRiskState({ user, previousSession, riskState }),
        stepUpUntil: assurance.stepUpUntil,
        authTime: epochSecondsToIso(identity.authTimeSeconds),
        authTimeSeconds: identity.authTimeSeconds,
        issuedAt: epochSecondsToIso(identity.issuedAtSeconds),
        issuedAtSeconds: identity.issuedAtSeconds,
        firebaseExpiresAt: epochSecondsToIso(identity.firebaseExpiresAtSeconds),
        firebaseExpiresAtSeconds: identity.firebaseExpiresAtSeconds,
        createdAt: createdAt.toISOString(),
        lastSeenAt: now.toISOString(),
        rotatedAt: now.toISOString(),
        revokedAt: null,
        absoluteExpiresAt,
        dpopJwk: dpopJwk || previousSession?.dpopJwk || null,
    };
};

const setBrowserSessionCookie = (res, sessionId, req = {}) => {
    appendSetCookieHeader(res, serializeCookie(SESSION_COOKIE_NAME, sessionId, getCookieOptions(req)));
};

const clearBrowserSessionCookie = (res, req = {}) => {
    appendSetCookieHeader(res, serializeCookie(SESSION_COOKIE_NAME, '', {
        ...getCookieOptions(req),
        expires: new Date(0).toISOString(),
        maxAge: 0,
    }));
};

async function revokeBrowserSession(sessionId = '') {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return;

    deleteMemorySessionRecord(normalizedSessionId);

    const storageMode = getStorageMode();
    if (storageMode === 'memory' || storageMode === 'unavailable') {
        return;
    }

    try {
        const client = getRedisClient();
        // Load the session first to find the user ID so we can clean up the tracking set
        const raw = await client.get(getRedisKey(normalizedSessionId));
        if (raw) {
            try {
                const record = JSON.parse(raw);
                if (record && record.userId) {
                    const normalizedUserId = normalizeUserId(record.userId);
                    const userSessionsKey = getUserSessionsKey(normalizedUserId);
                    await client.sRem(userSessionsKey, normalizedSessionId);
                }
            } catch (err) { /* ignore parser or redis failures */ }
        }
        await client.del(getRedisKey(normalizedSessionId));
    } catch (error) {
        const logPayload = {
            sessionId: normalizedSessionId,
            error: error?.message || 'unknown',
        };
        if (!isMemorySessionFallbackAllowed()) {
            logger.error('browser_session.revoke_failed_no_fallback', logPayload);
            throw error;
        }
        logger.warn('browser_session.revoke_failed', logPayload);
    }
}

async function revokeBrowserSessionsForUser(userId = '') {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return { revoked: 0 };

    let revoked = deleteMemorySessionRecordsForUser(normalizedUserId);
    const storageMode = getStorageMode();
    if (storageMode === 'memory') {
        return { revoked };
    }
    if (storageMode === 'unavailable') {
        const error = new Error('Browser session store unavailable');
        error.code = 'AUTH_SESSION_STORE_UNAVAILABLE';
        logger.error('browser_session.revoke_user_unavailable', { userId: normalizedUserId });
        throw error;
    }

    const redisClient = getRedisClient();
    const userSessionsKey = getUserSessionsKey(normalizedUserId);
    const keysToDelete = [];

    try {
        // Retrieve all session IDs from the user's sessions set (O(1) lookup)
        const sessionIds = await redisClient.sMembers(userSessionsKey);

        if (sessionIds && sessionIds.length > 0) {
            for (const id of sessionIds) {
                keysToDelete.push(getRedisKey(id));
            }
            keysToDelete.push(userSessionsKey);
            await redisClient.del(keysToDelete);
            revoked += sessionIds.length;
        } else {
            // Fallback scan if the tracking set is empty/missing
            if (typeof redisClient.scanIterator === 'function') {
                for await (const key of redisClient.scanIterator({ MATCH: `${SESSION_PREFIX}*`, COUNT: 100 })) {
                    const raw = await redisClient.get(key);
                    if (!raw) continue;
                    let record = null;
                    try {
                        record = JSON.parse(raw);
                    } catch {
                        continue;
                    }
                    if (normalizeUserId(record?.userId) === normalizedUserId) {
                        keysToDelete.push(key);
                    }
                }
                if (keysToDelete.length > 0) {
                    await redisClient.del(keysToDelete);
                    revoked += keysToDelete.length;
                }
            }
        }
        return { revoked };
    } catch (error) {
        const logPayload = {
            userId: normalizedUserId,
            error: error?.message || 'unknown',
        };
        if (!isMemorySessionFallbackAllowed()) {
            logger.error('browser_session.revoke_user_failed_no_fallback', logPayload);
            throw error;
        }
        logger.warn('browser_session.revoke_user_failed', logPayload);
        return { revoked };
    }
}

async function setGlobalSessionRevokedAfter(value = new Date()) {
    const revokedAfterMs = normalizeRevocationMs(value) || Date.now();
    inMemoryGlobalSessionRevokedAfter = revokedAfterMs;
    globalSessionRevocationCacheExpiresAt = Date.now() + GLOBAL_SESSION_REVOCATION_CACHE_MS;

    const redisClient = getRedisClient();
    if (!redisClient) {
        return revokedAfterMs;
    }

    try {
        await redisClient.set(GLOBAL_SESSION_REVOKED_AFTER_KEY, String(revokedAfterMs));
    } catch (error) {
        logger.warn('browser_session.global_revocation_write_failed', {
            error: error?.message || 'unknown',
        });
    }

    return revokedAfterMs;
}

async function getGlobalSessionRevokedAfter() {
    const redisClient = getRedisClient();
    if (!redisClient) {
        return inMemoryGlobalSessionRevokedAfter;
    }

    if (Date.now() < globalSessionRevocationCacheExpiresAt) {
        return inMemoryGlobalSessionRevokedAfter;
    }

    try {
        const raw = await redisClient.get(GLOBAL_SESSION_REVOKED_AFTER_KEY);
        const revokedAfterMs = normalizeRevocationMs(raw);
        if (revokedAfterMs) {
            inMemoryGlobalSessionRevokedAfter = Math.max(inMemoryGlobalSessionRevokedAfter, revokedAfterMs);
        }
        globalSessionRevocationCacheExpiresAt = Date.now() + GLOBAL_SESSION_REVOCATION_CACHE_MS;
    } catch (error) {
        logger.warn('browser_session.global_revocation_read_failed', {
            error: error?.message || 'unknown',
        });
        globalSessionRevocationCacheExpiresAt = Date.now() + Math.min(GLOBAL_SESSION_REVOCATION_CACHE_MS, 1000);
    }

    return inMemoryGlobalSessionRevokedAfter;
}

async function revokeAllBrowserSessions({ revokedAfter = new Date() } = {}) {
    const revokedAfterMs = await setGlobalSessionRevokedAfter(revokedAfter);
    let revoked = clearMemorySessionRecords();
    const storageMode = getStorageMode();

    if (storageMode === 'memory') {
        return { revoked, revokedAfter: new Date(revokedAfterMs).toISOString() };
    }
    if (storageMode === 'unavailable') {
        const error = new Error('Browser session store unavailable');
        error.code = 'AUTH_SESSION_STORE_UNAVAILABLE';
        logger.error('browser_session.revoke_all_unavailable');
        throw error;
    }

    const redisClient = getRedisClient();
    const keysToDelete = [];

    try {
        if (typeof redisClient.scanIterator !== 'function') {
            throw new Error('Redis scanIterator is unavailable');
        }

        for await (const key of redisClient.scanIterator({ MATCH: `${SESSION_PREFIX}*`, COUNT: 100 })) {
            if (key === GLOBAL_SESSION_REVOKED_AFTER_KEY) continue;
            keysToDelete.push(key);
        }

        if (keysToDelete.length > 0) {
            await redisClient.del(keysToDelete);
            revoked += keysToDelete.length;
        }
        return { revoked, revokedAfter: new Date(revokedAfterMs).toISOString() };
    } catch (error) {
        const logPayload = { error: error?.message || 'unknown' };
        if (!isMemorySessionFallbackAllowed()) {
            logger.error('browser_session.revoke_all_failed_no_fallback', logPayload);
            throw error;
        }
        logger.warn('browser_session.revoke_all_failed', logPayload);
        return { revoked, revokedAfter: new Date(revokedAfterMs).toISOString() };
    }
}

const createBrowserSession = async ({
    req = {},
    res = null,
    user = null,
    authUid = '',
    authToken = null,
    deviceMethod = '',
    stepUpUntil = null,
    additionalAmr = [],
    riskState = '',
} = {}) => {
    let dpopJwk = null;
    const dpopHeader = req.headers?.dpop || req.headers?.DPoP || (typeof req.get === 'function' ? req.get('DPoP') : '');
    if (dpopHeader) {
        const verification = await verifyDpopProof(req);
        if (verification.success) {
            dpopJwk = verification.jwk;
        } else if (process.env.AUTH_DPOP_REQUIRED === 'true') {
            const err = new Error(`DPoP verification failed: ${verification.reason}`);
            err.statusCode = 401;
            throw err;
        }
    }

    const sessionRecord = await storeSessionRecord(buildBrowserSessionRecord({
        sessionId: generateSessionId(),
        user,
        authUid,
        authToken,
        req,
        deviceMethod,
        stepUpUntil,
        additionalAmr,
        riskState,
        dpopJwk,
    }));

    if (res) {
        setBrowserSessionCookie(res, sessionRecord.sessionId, req);
    }

    return sessionRecord;
};

const rotateBrowserSession = async ({
    req = {},
    res = null,
    currentSession = null,
    user = null,
    authUid = '',
    authToken = null,
    deviceMethod = '',
    stepUpUntil = null,
    additionalAmr = [],
    riskState = '',
} = {}) => {
    const previousSession = currentSession || null;
    let dpopJwk = previousSession?.dpopJwk || null;

    const dpopHeader = req.headers?.dpop || req.headers?.DPoP || (typeof req.get === 'function' ? req.get('DPoP') : '');
    if (dpopHeader) {
        const verification = await verifyDpopProof(req, dpopJwk);
        if (verification.success) {
            dpopJwk = verification.jwk;
        } else if (process.env.AUTH_DPOP_REQUIRED === 'true' || dpopJwk) {
            const err = new Error(`DPoP verification failed: ${verification.reason}`);
            err.statusCode = 401;
            throw err;
        }
    }

    const nextSession = await storeSessionRecord(buildBrowserSessionRecord({
        sessionId: generateSessionId(),
        user,
        authUid: authUid || previousSession?.firebaseUid || '',
        authToken,
        req,
        previousSession,
        deviceMethod,
        stepUpUntil,
        additionalAmr,
        riskState,
        dpopJwk,
    }));

    if (previousSession?.sessionId) {
        await revokeBrowserSession(previousSession.sessionId);
    }

    if (res) {
        setBrowserSessionCookie(res, nextSession.sessionId, req);
    }

    return nextSession;
};

const touchBrowserSession = async (sessionRecord = {}) => {
    if (!sessionRecord?.sessionId) return sessionRecord;

    const lastSeenAt = new Date(sessionRecord.lastSeenAt || 0).getTime();
    if (Number.isFinite(lastSeenAt) && (Date.now() - lastSeenAt) < SESSION_TOUCH_INTERVAL_MS) {
        return sessionRecord;
    }

    const nextRecord = await storeSessionRecord({
        ...sessionRecord,
        lastSeenAt: new Date().toISOString(),
    });
    return nextRecord;
};

const getBrowserSession = async (sessionId = '') => loadSessionRecord(sessionId);

const getBrowserSessionFromRequest = async (req = {}) => {
    const sessionId = resolveSessionIdFromRequest(req);
    return getBrowserSession(sessionId);
};

const refreshBrowserSession = async ({
    req = {},
    res = null,
    currentSession = null,
    user = null,
    authUid = '',
    authToken = null,
    deviceMethod = '',
    stepUpUntil = null,
    additionalAmr = [],
    rotate = false,
    riskState = '',
} = {}) => {
    if (!currentSession) {
        return createBrowserSession({
            req,
            res,
            user,
            authUid,
            authToken,
            deviceMethod,
            stepUpUntil,
            additionalAmr,
            riskState,
        });
    }

    if (rotate) {
        return rotateBrowserSession({
            req,
            res,
            currentSession,
            user,
            authUid,
            authToken,
            deviceMethod,
            stepUpUntil,
            additionalAmr,
            riskState,
        });
    }

    let dpopJwk = currentSession?.dpopJwk || null;
    const dpopHeader = req.headers?.dpop || req.headers?.DPoP || (typeof req.get === 'function' ? req.get('DPoP') : '');
    if (dpopHeader) {
        const verification = await verifyDpopProof(req, dpopJwk);
        if (verification.success) {
            dpopJwk = verification.jwk;
        } else if (process.env.AUTH_DPOP_REQUIRED === 'true' || dpopJwk) {
            const err = new Error(`DPoP verification failed: ${verification.reason}`);
            err.statusCode = 401;
            throw err;
        }
    }

    const nextRecord = await storeSessionRecord(buildBrowserSessionRecord({
        sessionId: currentSession.sessionId,
        user,
        authUid: authUid || currentSession.firebaseUid || '',
        authToken,
        req,
        previousSession: currentSession,
        deviceMethod,
        stepUpUntil,
        additionalAmr,
        riskState,
        dpopJwk,
    }));

    if (res) {
        setBrowserSessionCookie(res, nextRecord.sessionId, req);
    }

    return nextRecord;
};

module.exports = {
    SESSION_COOKIE_NAME,
    SESSION_STEP_UP_TTL_MS,
    clearBrowserSessionCookie,
    createBrowserSession,
    getBrowserSession,
    getBrowserSessionFromRequest,
    getGlobalSessionRevokedAfter,
    getCookieOptions,
    parseCookies,
    refreshBrowserSession,
    resolveSessionIdFromCookieHeader,
    resolveSessionIdFromRequest,
    revokeAllBrowserSessions,
    revokeBrowserSession,
    revokeBrowserSessionsForUser,
    rotateBrowserSession,
    setBrowserSessionCookie,
    setGlobalSessionRevokedAfter,
    touchBrowserSession,
};
