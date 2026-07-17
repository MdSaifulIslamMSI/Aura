const { getRedisClient, flags: redisFlags } = require('../../config/redis');
const {
    actionFamily,
    isCritical,
    isHighOrCritical,
    normalizeAction,
} = require('./types');

const memoryStore = new Map();

const keyFor = (sessionId = '', userId = '', action = '') => (
    `${redisFlags.redisPrefix}:authshield:stepup:${sessionId || 'no-session'}:${userId || 'no-user'}:${actionFamily(action)}`
);

const ttlForSensitivity = (sensitivity = 'medium', config = {}) => (
    isCritical(sensitivity)
        ? (config.stepUpTtlCriticalSeconds || 300)
        : (config.stepUpTtlHighSeconds || 900)
);

const hasFreshAuthTime = (req = {}, sensitivity = 'medium', config = {}) => {
    const authTime = Number(req.authToken?.auth_time || req.authToken?.iat || req.authSession?.authTime || 0);
    if (!Number.isFinite(authTime) || authTime <= 0) return false;
    const ageSeconds = Math.max(Math.floor(Date.now() / 1000) - authTime, 0);
    return ageSeconds <= ttlForSensitivity(sensitivity, config);
};

const hasFreshSessionStepUp = (req = {}) => {
    const stepUpUntilMs = req.authSession?.stepUpUntil
        ? new Date(req.authSession.stepUpUntil).getTime()
        : 0;
    if (!Number.isFinite(stepUpUntilMs) || stepUpUntilMs <= Date.now()) return false;
    const amr = Array.isArray(req.authSession?.amr)
        ? req.authSession.amr.map((entry) => String(entry || '').trim().toLowerCase())
        : [];
    return amr.some((entry) => ['mfa', 'otp', 'totp', 'webauthn', 'passkey', 'duo', 'duo_oidc'].includes(entry));
};

const getStoredFreshStepUp = async ({ req = {}, action = '' } = {}) => {
    const key = keyFor(req.authSession?.sessionId || '', req.user?._id || req.authSession?.userId || '', action);
    const client = getRedisClient();
    if (client) {
        const raw = await client.get(key);
        return Boolean(raw);
    }
    const expiresAt = memoryStore.get(key) || 0;
    if (expiresAt <= Date.now()) {
        memoryStore.delete(key);
        return false;
    }
    return true;
};

const recordStepUpSuccess = async (req = {}, action = '', sensitivity = 'high', config = {}) => {
    const key = keyFor(req.authSession?.sessionId || '', req.user?._id || req.authSession?.userId || '', action);
    const ttlSeconds = ttlForSensitivity(sensitivity, config);
    const client = getRedisClient();
    if (client) {
        await client.set(key, '1', { EX: ttlSeconds });
        return { recorded: true, key };
    }
    memoryStore.set(key, Date.now() + ttlSeconds * 1000);
    return { recorded: true, key };
};

const hasFreshStepUp = async (req = {}, action = '', sensitivity = 'medium', config = {}) => (
    Boolean(
        req.authzPosture?.stepUpFresh
        || req.authzPosture?.webAuthnStepUpFresh
        || req.authzPosture?.freshWebAuthnStepUp
        || hasFreshSessionStepUp(req)
        || hasFreshAuthTime(req, sensitivity, config)
        || await getStoredFreshStepUp({ req, action })
    )
);

const requireStepUp = async (req = {}, action = '', sensitivity = 'medium', options = {}) => {
    const config = options.config || {};
    const actionPolicy = options.actionPolicy || {};
    const requiredByPolicy = Boolean(actionPolicy.stepUp || options.requireFreshAuth || isHighOrCritical(sensitivity));
    if (!requiredByPolicy) {
        return { requiredByPolicy: false, required: false, enabled: config.stepUpEnabled, fresh: true, reasons: [] };
    }
    if (!config.stepUpEnabled) {
        return {
            requiredByPolicy: true,
            required: false,
            enabled: false,
            fresh: true,
            reasons: ['step_up_disabled'],
        };
    }
    const fresh = await hasFreshStepUp(req, normalizeAction(action), sensitivity, config);
    return {
        requiredByPolicy: true,
        required: true,
        enabled: true,
        fresh,
        reasons: fresh ? [] : ['step_up_required'],
    };
};

const resetStepUpMemoryForTests = () => memoryStore.clear();

module.exports = {
    hasFreshAuthTime,
    hasFreshSessionStepUp,
    hasFreshStepUp,
    recordStepUpSuccess,
    requireStepUp,
    resetStepUpMemoryForTests,
};
