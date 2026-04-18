const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getRedisClient, flags: redisFlags } = require('../config/redis');
const {
    normalizeEmail,
    resolveProviderIds,
    resolveEmailVerifiedState,
} = require('../utils/authIdentity');
const { extractTrustedDeviceContext } = require('./trustedDeviceChallengeService');

const SESSION_COOKIE_NAME = String(process.env.AUTH_SESSION_COOKIE_NAME || 'aura_sid').trim() || 'aura_sid';
const SESSION_PREFIX = `${redisFlags.redisPrefix}:auth:session:`;
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const SESSION_IDLE_TTL_MS = Math.max(Number(process.env.AUTH_SESSION_IDLE_TTL_MS || (8 * 60 * 60 * 1000)), 5 * 60 * 1000);
const SESSION_ABSOLUTE_TTL_MS = Math.max(Number(process.env.AUTH_SESSION_ABSOLUTE_TTL_MS || (7 * 24 * 60 * 60 * 1000)), SESSION_IDLE_TTL_MS);
const SESSION_TOUCH_INTERVAL_MS = Math.max(Number(process.env.AUTH_SESSION_TOUCH_INTERVAL_MS || (5 * 60 * 1000)), 30 * 1000);
const SESSION_STEP_UP_TTL_MS = Math.max(Number(process.env.AUTH_SESSION_STEP_UP_TTL_MS || (10 * 60 * 1000)), 60 * 1000);
const SESSION_DEFAULT_SAME_SITE = String(process.env.AUTH_SESSION_SAME_SITE || 'lax').trim().toLowerCase();
const BROWSER_SESSION_STORAGE_UNAVAILABLE_MESSAGE = 'Secure browser session storage is temporarily unavailable. Retry shortly.';
const SESSION_ADMIN_HOSTS = new Set(
    String(process.env.AUTH_SESSION_ADMIN_HOSTS || '')
        .split(',')
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
);

const inMemorySessionStore = new Map();

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const ALLOW_MEMORY_SESSION_FALLBACK = parseBooleanEnv(
    process.env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK,
    !IS_PRODUCTION
);

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

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

const resolveRiskState = ({ user = null, previousSession = null } = {}) => {
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
        accumulator[key] = decodeURIComponent(value);
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
    if (parseBooleanEnv(process.env.AUTH_SESSION_COOKIE_SECURE, IS_PRODUCTION)) {
        const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
        return Boolean(req.secure || forwardedProto === 'https');
    }
    return false;
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

const getStorageMode = () => {
    if (getRedisClient()) {
        return 'redis';
    }

    if (ALLOW_MEMORY_SESSION_FALLBACK) {
        return 'memory';
    }

    return 'unavailable';
};

const requireStorageMode = (operation = 'use') => {
    const storageMode = getStorageMode();
    if (storageMode !== 'unavailable') {
        return storageMode;
    }

    logger.error('browser_session.storage_unavailable', {
        operation,
        nodeEnv: NODE_ENV,
        allowMemoryFallback: ALLOW_MEMORY_SESSION_FALLBACK,
    });
    throw new AppError(BROWSER_SESSION_STORAGE_UNAVAILABLE_MESSAGE, 503);
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
    const storageMode = requireStorageMode('persist');
    if (storageMode === 'memory') {
        writeMemorySessionRecord(record);
        return record;
    }

    const redisClient = getRedisClient();
    await redisClient.setEx(getRedisKey(record.sessionId), calculateTtlSeconds(record), JSON.stringify(record));
    return record;
};

const loadSessionRecord = async (sessionId = '') => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;

    const storageMode = requireStorageMode('read');
    let record = null;

    if (storageMode === 'memory') {
        record = readMemorySessionRecord(normalizedSessionId);
    } else {
        try {
            const raw = await getRedisClient().get(getRedisKey(normalizedSessionId));
            record = raw ? JSON.parse(raw) : null;
        } catch (error) {
            logger.warn('browser_session.read_failed', {
                sessionId: normalizedSessionId,
                error: error?.message || 'unknown',
            });
            return null;
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
        riskState: resolveRiskState({ user, previousSession }),
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

    const storageMode = getStorageMode();
    if (storageMode === 'memory') {
        deleteMemorySessionRecord(normalizedSessionId);
        return;
    }

    if (storageMode === 'unavailable') {
        logger.warn('browser_session.revoke_skipped_storage_unavailable', {
            sessionId: normalizedSessionId,
            nodeEnv: NODE_ENV,
        });
        return;
    }

    try {
        await getRedisClient().del(getRedisKey(normalizedSessionId));
    } catch (error) {
        logger.warn('browser_session.revoke_failed', {
            sessionId: normalizedSessionId,
            error: error?.message || 'unknown',
        });
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
} = {}) => {
    const sessionRecord = await storeSessionRecord(buildBrowserSessionRecord({
        sessionId: generateSessionId(),
        user,
        authUid,
        authToken,
        req,
        deviceMethod,
        stepUpUntil,
        additionalAmr,
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
} = {}) => {
    const previousSession = currentSession || null;
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
        });
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
    }));

    if (res) {
        setBrowserSessionCookie(res, nextRecord.sessionId, req);
    }

    return nextRecord;
};

module.exports = {
    BROWSER_SESSION_STORAGE_UNAVAILABLE_MESSAGE,
    SESSION_COOKIE_NAME,
    SESSION_STEP_UP_TTL_MS,
    clearBrowserSessionCookie,
    createBrowserSession,
    getBrowserSession,
    getBrowserSessionFromRequest,
    getCookieOptions,
    parseCookies,
    refreshBrowserSession,
    resolveSessionIdFromCookieHeader,
    resolveSessionIdFromRequest,
    revokeBrowserSession,
    rotateBrowserSession,
    setBrowserSessionCookie,
    touchBrowserSession,
};
