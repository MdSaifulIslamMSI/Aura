const crypto = require('crypto');
const { getRedisClient, flags: redisFlags, isRedisRequired } = require('../config/redis');
const { getBrowserSession } = require('./browserSessionService');
const {
    evaluateLogin,
    isAdminSubject,
    isLoginMfaSatisfied,
} = require('./mfaPolicyService');
const { hasObservedWebAuthnUserVerification } = require('./trustedDeviceAssuranceService');
const {
    getTrustedDeviceRegistration,
    normalizeDeviceId,
    verifyTrustedDeviceSession,
} = require('./trustedDeviceChallengeService');

const DESKTOP_HANDOFF_ASSURANCE_TTL_MS = 5 * 60 * 1000;
const DESKTOP_HANDOFF_REQUEST_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESKTOP_HANDOFF_GRANT_ID_REGEX = /^[A-Za-z0-9_-]{43}$/;
const DESKTOP_HANDOFF_GRANT_PREFIX = `${redisFlags.redisPrefix}:desktop-handoff:assurance-grant:`;
const DESKTOP_HANDOFF_GRANT_TYPE = 'desktop_handoff_assurance_grant';

const assuranceGrantMemoryStore = new Map();

class DesktopHandoffAssuranceError extends Error {
    constructor(message, statusCode = 403, code = 'DESKTOP_HANDOFF_ASSURANCE_INVALID') {
        super(message);
        this.name = 'DesktopHandoffAssuranceError';
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        this.code = code;
    }
}

const normalizeText = (value) => String(value || '').trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeAmr = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map(normalizeLower)
        .filter((entry) => /^[a-z0-9:_-]{1,64}$/.test(entry))
)];

const parseBoolean = (value) => {
    const normalized = normalizeLower(value);
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const isDistributedGrantStoreRequired = (env = process.env) => Boolean(
    normalizeLower(env?.NODE_ENV) === 'production'
    || parseBoolean(env?.REDIS_REQUIRED)
    || parseBoolean(env?.DISTRIBUTED_SECURITY_CONTROLS_ENABLED)
    || parseBoolean(env?.SPLIT_RUNTIME_ENABLED)
    || (env === process.env && (isRedisRequired() || redisFlags.distributedSecurityControlsEnabled))
);

const buildGrantKey = (grantId) => `${DESKTOP_HANDOFF_GRANT_PREFIX}${grantId}`;

const getUserId = (user = null) => normalizeText(user?._id || user?.id || '');

const getRegistrationMethod = (registration = null) => (
    normalizeLower(registration?.method) === 'webauthn'
    || Boolean(normalizeText(registration?.webauthnCredentialIdBase64Url))
        ? 'webauthn'
        : 'browser_key'
);

const getDateMs = (value) => {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const isRegistrationActive = (registration = null, nowMs = Date.now()) => {
    if (!registration || registration.revokedAt) return false;
    const expiresAtMs = getDateMs(registration.expiresAt);
    return !Number.isNaN(expiresAtMs) && (expiresAtMs <= 0 || expiresAtMs > nowMs);
};

const assertIdentityBinding = ({ user, authUid = '', authToken = null } = {}) => {
    const userId = getUserId(user);
    const normalizedUid = normalizeText(authUid);
    const tokenUid = normalizeText(authToken?.uid || authToken?.sub || '');
    const userUid = normalizeText(user?.authUid || '');

    if (!userId || !normalizedUid || !authToken || !tokenUid) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff requires an authenticated user.',
            401,
            'DESKTOP_HANDOFF_ASSURANCE_UNAUTHENTICATED'
        );
    }
    if (tokenUid !== normalizedUid || (userUid && userUid !== normalizedUid)) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff identity binding did not match.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_IDENTITY_MISMATCH'
        );
    }

    return { authUid: normalizedUid, userId };
};

const assertActiveAuthSession = ({ authSession, authUid, userId, deviceId, nowMs }) => {
    const sessionId = normalizeText(authSession?.sessionId);
    const sessionUserId = normalizeText(authSession?.userId);
    const sessionUid = normalizeText(authSession?.firebaseUid);
    const sessionDeviceId = normalizeDeviceId(authSession?.deviceId);

    if (
        !sessionId
        || authSession?.revokedAt
        || sessionUserId !== userId
        || sessionUid !== authUid
        || sessionDeviceId !== deviceId
    ) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff requires a matching active browser session.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_SESSION_MISMATCH'
        );
    }

    // Firebase expiry is a snapshot of the token that created or last refreshed
    // the server session. Browser-session liveness is governed by its own idle
    // and absolute deadlines. Requests are independently authenticated by
    // `protect` before this assurance is issued.
    for (const expiry of [authSession?.absoluteExpiresAt, authSession?.idleExpiresAt]) {
        if (!expiry) continue;
        const expiryMs = getDateMs(expiry);
        if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) {
            throw new DesktopHandoffAssuranceError(
                'Desktop handoff browser session expired.',
                403,
                'DESKTOP_HANDOFF_ASSURANCE_SESSION_EXPIRED'
            );
        }
    }
};

const assertOriginalBrowserAssurance = (authSession = null) => {
    if (normalizeAmr(authSession?.amr).includes('desktop_handoff')) {
        throw new DesktopHandoffAssuranceError(
            'A relayed desktop session cannot create another desktop handoff.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_SOURCE_RELAYED'
        );
    }
};

const assertCurrentSourceBrowserSession = async ({
    sourceSessionId = '',
    identity,
    deviceId = '',
    nowMs,
    getBrowserSessionById,
} = {}) => {
    let sourceSession;
    try {
        sourceSession = await getBrowserSessionById(sourceSessionId);
    } catch {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff source browser session could not be verified.',
            503,
            'DESKTOP_HANDOFF_ASSURANCE_SESSION_STORE_UNAVAILABLE'
        );
    }

    if (normalizeText(sourceSession?.sessionId) !== normalizeText(sourceSessionId)) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff source browser session is no longer active.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_SESSION_MISMATCH'
        );
    }

    assertActiveAuthSession({
        authSession: sourceSession,
        authUid: identity.authUid,
        userId: identity.userId,
        deviceId,
        nowMs,
    });
    assertOriginalBrowserAssurance(sourceSession);
};

const assertAdminAssurance = ({ user, registration, authSession, nowMs }) => {
    if (!isAdminSubject(user)) return;

    const amr = normalizeAmr(authSession?.amr);
    const stepUpUntilMs = getDateMs(authSession?.stepUpUntil);
    const webAuthnStepUpUntilMs = getDateMs(authSession?.webAuthnStepUpUntil);
    const valid = getRegistrationMethod(registration) === 'webauthn'
        && hasObservedWebAuthnUserVerification(registration)
        && normalizeLower(registration?.credentialScope) === 'admin'
        && normalizeLower(registration?.adminEligibility) === 'verified'
        && normalizeLower(authSession?.aal) === 'aal2'
        && Number.isFinite(stepUpUntilMs)
        && stepUpUntilMs > nowMs
        && Number.isFinite(webAuthnStepUpUntilMs)
        && webAuthnStepUpUntilMs > nowMs
        && amr.includes('mfa')
        && amr.some((entry) => entry === 'webauthn' || entry === 'passkey');

    if (!valid) {
        throw new DesktopHandoffAssuranceError(
            'Admin desktop handoff requires a fresh verified passkey session.',
            403,
            'DESKTOP_HANDOFF_ADMIN_ASSURANCE_REQUIRED'
        );
    }
};

const purgeExpiredMemoryGrants = (nowMs) => {
    for (const [grantId, record] of assuranceGrantMemoryStore.entries()) {
        if (Number(record?.expiresAtMs || 0) <= nowMs) {
            assuranceGrantMemoryStore.delete(grantId);
        }
    }
};

const storeGrant = async ({ record, ttlMs, redisClient, env }) => {
    if (redisClient) {
        try {
            const result = await redisClient.set(
                buildGrantKey(record.grantId),
                JSON.stringify(record),
                { NX: true, PX: ttlMs }
            );
            if (result !== 'OK' && result !== true) {
                throw new Error('grant collision');
            }
            return;
        } catch {
            throw new DesktopHandoffAssuranceError(
                'Desktop handoff assurance storage is unavailable.',
                503,
                'DESKTOP_HANDOFF_ASSURANCE_STORE_UNAVAILABLE'
            );
        }
    }

    if (isDistributedGrantStoreRequired(env)) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff assurance storage is unavailable.',
            503,
            'DESKTOP_HANDOFF_ASSURANCE_STORE_UNAVAILABLE'
        );
    }

    purgeExpiredMemoryGrants(Date.now());
    assuranceGrantMemoryStore.set(record.grantId, record);
};

const consumeStoredGrant = async ({ grantId, redisClient, env, nowMs }) => {
    if (redisClient) {
        let raw;
        try {
            raw = await redisClient.eval(
                `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
redis.call('DEL', KEYS[1])
return raw
`,
                { keys: [buildGrantKey(grantId)], arguments: [] }
            );
        } catch {
            throw new DesktopHandoffAssuranceError(
                'Desktop handoff assurance storage is unavailable.',
                503,
                'DESKTOP_HANDOFF_ASSURANCE_STORE_UNAVAILABLE'
            );
        }

        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            throw new DesktopHandoffAssuranceError(
                'Desktop handoff assurance grant is invalid.',
                401,
                'DESKTOP_HANDOFF_ASSURANCE_GRANT_INVALID'
            );
        }
    }

    if (isDistributedGrantStoreRequired(env)) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff assurance storage is unavailable.',
            503,
            'DESKTOP_HANDOFF_ASSURANCE_STORE_UNAVAILABLE'
        );
    }

    purgeExpiredMemoryGrants(nowMs);
    const record = assuranceGrantMemoryStore.get(grantId) || null;
    assuranceGrantMemoryStore.delete(grantId);
    return record;
};

const inspectDesktopHandoffAssurance = ({
    requestId = '',
    user = null,
    authUid = '',
    authToken = null,
    authSession = null,
    deviceId = '',
    deviceSessionToken = '',
} = {}, { now = () => Date.now() } = {}) => {
    const normalizedRequestId = normalizeText(requestId);
    if (!DESKTOP_HANDOFF_REQUEST_ID_REGEX.test(normalizedRequestId)) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff request is invalid.',
            400,
            'DESKTOP_HANDOFF_ASSURANCE_REQUEST_INVALID'
        );
    }

    const nowMs = Number(now());
    const identity = assertIdentityBinding({ user, authUid, authToken });
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff trusted-device binding is missing.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_DEVICE_REQUIRED'
        );
    }

    assertActiveAuthSession({
        authSession,
        authUid: identity.authUid,
        userId: identity.userId,
        deviceId: normalizedDeviceId,
        nowMs,
    });
    assertOriginalBrowserAssurance(authSession);

    const registration = getTrustedDeviceRegistration(user, normalizedDeviceId, { includeInactive: true });
    if (!isRegistrationActive(registration, nowMs)) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff trusted-device registration is not active.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_DEVICE_INVALID'
        );
    }

    const sessionVerification = verifyTrustedDeviceSession({
        user,
        authUid: identity.authUid,
        authToken,
        deviceId: normalizedDeviceId,
        deviceSessionToken,
    });
    if (!sessionVerification.success) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff trusted-device session could not be verified.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_DEVICE_SESSION_INVALID'
        );
    }

    assertAdminAssurance({ user, registration, authSession, nowMs });
    const sourceMfaPolicy = evaluateLogin({
        user,
        context: { session: authSession },
    });
    if (sourceMfaPolicy.mfaRequired) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff requires the current MFA checkpoint to be completed.',
            403,
            'DESKTOP_HANDOFF_MFA_REQUIRED'
        );
    }

    const deviceMethod = getRegistrationMethod(registration);
    const sourceAmr = normalizeAmr(authSession?.amr);
    const stepUpUntilMs = getDateMs(authSession?.stepUpUntil);
    const webAuthnStepUpUntilMs = getDateMs(authSession?.webAuthnStepUpUntil);
    const activeWebAuthnStepUpUntilMs = Number.isFinite(webAuthnStepUpUntilMs)
        && webAuthnStepUpUntilMs > nowMs
        ? webAuthnStepUpUntilMs
        : 0;
    const transferableStepUpUntilMs = isAdminSubject(user) && activeWebAuthnStepUpUntilMs > 0
        ? Math.min(stepUpUntilMs, activeWebAuthnStepUpUntilMs)
        : stepUpUntilMs;
    const stepUpUntil = Number.isFinite(transferableStepUpUntilMs) && transferableStepUpUntilMs > nowMs
        ? new Date(transferableStepUpUntilMs).toISOString()
        : null;
    const webAuthnStepUpUntil = activeWebAuthnStepUpUntilMs > 0
        ? new Date(activeWebAuthnStepUpUntilMs).toISOString()
        : null;

    return {
        requestId: normalizedRequestId,
        identity,
        sourceSessionId: normalizeText(authSession?.sessionId),
        deviceId: normalizedDeviceId,
        deviceMethod,
        registration,
        sourceAal: normalizeLower(authSession?.aal),
        sourceAmr,
        stepUpUntil,
        webAuthnStepUpUntil,
        admin: isAdminSubject(user),
        loginMfaSatisfied: isLoginMfaSatisfied({ user, session: authSession }),
        sessionVersion: normalizeText(registration?.sessionVersion),
    };
};

const createDesktopHandoffAssuranceGrant = async (input = {}, {
    env = process.env,
    now = () => Date.now(),
    randomBytes = crypto.randomBytes,
    redisClient = getRedisClient(),
} = {}) => {
    const assurance = inspectDesktopHandoffAssurance(input, { now });
    const nowMs = Number(now());
    const {
        requestId: normalizedRequestId,
        identity,
        sourceSessionId,
        deviceId: normalizedDeviceId,
        deviceMethod,
        sessionVersion,
        sourceAal,
        sourceAmr,
        stepUpUntil,
        webAuthnStepUpUntil,
        admin,
        loginMfaSatisfied,
    } = assurance;

    const grantId = randomBytes(32).toString('base64url');
    const expiresAtMs = nowMs + DESKTOP_HANDOFF_ASSURANCE_TTL_MS;
    const record = {
        typ: DESKTOP_HANDOFF_GRANT_TYPE,
        grantId,
        requestId: normalizedRequestId,
        uid: identity.authUid,
        userId: identity.userId,
        sourceSessionId,
        deviceId: normalizedDeviceId,
        deviceMethod,
        sessionVersion,
        admin,
        sourceAal,
        sourceAmr,
        stepUpUntil,
        webAuthnStepUpUntil,
        loginMfaSatisfied,
        expiresAtMs,
    };

    await storeGrant({
        record,
        ttlMs: DESKTOP_HANDOFF_ASSURANCE_TTL_MS,
        redisClient,
        env,
    });

    return {
        claims: {
            desktop_handoff: true,
            desktop_request_id: normalizedRequestId,
            desktop_handoff_grant_id: grantId,
            desktop_handoff_grant_exp: Math.floor(expiresAtMs / 1000),
        },
        expiresAt: new Date(expiresAtMs).toISOString(),
    };
};

const consumeDesktopHandoffAssuranceGrant = async ({
    authToken = null,
    authUid = '',
    user = null,
    desktopHandoffRequestId = '',
} = {}, {
    env = process.env,
    now = () => Date.now(),
    redisClient = getRedisClient(),
    getBrowserSessionById = getBrowserSession,
} = {}) => {
    const nowMs = Number(now());
    const identity = assertIdentityBinding({ user, authUid, authToken });
    const requestId = normalizeText(desktopHandoffRequestId);
    const claimRequestId = normalizeText(authToken?.desktop_request_id);
    const grantId = normalizeText(authToken?.desktop_handoff_grant_id);
    const claimExpiresAtSeconds = Number(authToken?.desktop_handoff_grant_exp || 0);

    if (
        authToken?.desktop_handoff !== true
        || !DESKTOP_HANDOFF_REQUEST_ID_REGEX.test(requestId)
        || requestId !== claimRequestId
        || !DESKTOP_HANDOFF_GRANT_ID_REGEX.test(grantId)
        || !Number.isFinite(claimExpiresAtSeconds)
        || claimExpiresAtSeconds <= 0
        || nowMs >= claimExpiresAtSeconds * 1000
    ) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff assurance claims are invalid or expired.',
            401,
            'DESKTOP_HANDOFF_ASSURANCE_CLAIMS_INVALID'
        );
    }

    const record = await consumeStoredGrant({ grantId, redisClient, env, nowMs });
    if (!record) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff assurance grant is missing or already used.',
            409,
            'DESKTOP_HANDOFF_ASSURANCE_GRANT_CONSUMED'
        );
    }
    const recordExpiresAtMs = Number(record.expiresAtMs || 0);
    const recordAmr = normalizeAmr(record.sourceAmr);

    if (
        record.typ !== DESKTOP_HANDOFF_GRANT_TYPE
        || record.grantId !== grantId
        || record.requestId !== requestId
        || record.uid !== identity.authUid
        || record.userId !== identity.userId
        || !normalizeText(record.sourceSessionId)
        || !Number.isFinite(recordExpiresAtMs)
        || recordExpiresAtMs <= nowMs
        || Math.floor(recordExpiresAtMs / 1000) !== claimExpiresAtSeconds
        || recordAmr.includes('desktop_handoff')
    ) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff assurance grant binding is invalid.',
            401,
            'DESKTOP_HANDOFF_ASSURANCE_GRANT_INVALID'
        );
    }

    await assertCurrentSourceBrowserSession({
        sourceSessionId: record.sourceSessionId,
        identity,
        deviceId: record.deviceId,
        nowMs,
        getBrowserSessionById,
    });

    const registration = getTrustedDeviceRegistration(user, record.deviceId, { includeInactive: true });
    const currentSessionVersion = normalizeText(registration?.sessionVersion);
    if (
        !isRegistrationActive(registration, nowMs)
        || getRegistrationMethod(registration) !== record.deviceMethod
        || currentSessionVersion !== normalizeText(record.sessionVersion)
    ) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff trusted-device registration changed or was revoked.',
            403,
            'DESKTOP_HANDOFF_ASSURANCE_DEVICE_CHANGED'
        );
    }

    if (record.admin || isAdminSubject(user)) {
        assertAdminAssurance({
            user: { ...user, isAdmin: true },
            registration,
            authSession: {
                aal: record.sourceAal,
                amr: record.sourceAmr,
                stepUpUntil: record.stepUpUntil,
                webAuthnStepUpUntil: record.webAuthnStepUpUntil,
            },
            nowMs,
        });
    }

    const sourceMfaPolicy = evaluateLogin({
        user,
        context: {
            session: {
                deviceId: record.deviceId,
                aal: record.sourceAal,
                amr: record.sourceAmr,
                stepUpUntil: record.stepUpUntil,
                webAuthnStepUpUntil: record.webAuthnStepUpUntil,
            },
        },
    });
    if (sourceMfaPolicy.mfaRequired) {
        throw new DesktopHandoffAssuranceError(
            'Desktop handoff source MFA assurance is no longer valid.',
            403,
            'DESKTOP_HANDOFF_MFA_REQUIRED'
        );
    }

    return {
        // The browser grant authorizes only one target-device challenge. It
        // must not transfer the browser's key, trusted-device session, AMR,
        // AAL, or step-up window into Electron.
        bootstrapExpiresAt: new Date(Math.min(
            recordExpiresAtMs,
            claimExpiresAtSeconds * 1000
        )).toISOString(),
        requestId: record.requestId,
        loginMfaSatisfied: isLoginMfaSatisfied({
            user,
            session: {
                deviceId: record.deviceId,
                aal: record.sourceAal,
                amr: record.sourceAmr,
                stepUpUntil: record.stepUpUntil,
                webAuthnStepUpUntil: record.webAuthnStepUpUntil,
            },
        }),
        adminPasskeySatisfied: Boolean(record.admin || isAdminSubject(user)),
    };
};

const resetDesktopHandoffAssuranceGrantsForTests = () => {
    assuranceGrantMemoryStore.clear();
};

module.exports = {
    DESKTOP_HANDOFF_ASSURANCE_TTL_MS,
    DesktopHandoffAssuranceError,
    consumeDesktopHandoffAssuranceGrant,
    createDesktopHandoffAssuranceGrant,
    inspectDesktopHandoffAssurance,
    isDistributedGrantStoreRequired,
    resetDesktopHandoffAssuranceGrantsForTests,
};
