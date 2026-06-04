const crypto = require('crypto');
const { getRedisClient, flags: redisFlags, isRedisRequired } = require('../config/redis');
const { resolveMfaConfig } = require('../config/mfaConfig');
const logger = require('../utils/logger');

const CHALLENGE_PREFIX = `${redisFlags.redisPrefix}:mfa:challenge:`;
const CONSUMED_PREFIX = `${redisFlags.redisPrefix}:mfa:challenge-consumed:`;
const memoryChallenges = new Map();
let cleanupTimer = null;

const normalizeText = (value) => String(value || '').trim();
const normalizeMethod = (value) => normalizeText(value).toLowerCase();
const normalizeChallengeId = (value) => {
    const normalized = normalizeText(value);
    return /^[a-f0-9]{32,64}$/i.test(normalized) ? normalized.toLowerCase() : '';
};

const hashBounded = (value = '') => {
    const normalized = normalizeText(value);
    return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : '';
};

const getRequestIp = (req = {}) => normalizeText(
    req.ip
    || req.headers?.['x-forwarded-for']?.split(',')?.[0]
    || req.socket?.remoteAddress
);

const getRequestUserAgent = (req = {}) => normalizeText(req.headers?.['user-agent']);

const scheduleCleanup = () => {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [challengeId, record] of memoryChallenges.entries()) {
            if (new Date(record.expiresAt).getTime() <= now || record.consumedAt) {
                memoryChallenges.delete(challengeId);
            }
        }
    }, 60 * 1000);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
};

const getStorageMode = () => {
    if (getRedisClient()) return 'redis';
    const nodeEnv = normalizeText(process.env.NODE_ENV).toLowerCase();
    if (nodeEnv !== 'production' && !isRedisRequired()) return 'memory';
    return 'unavailable';
};

const challengeKey = (challengeId = '') => `${CHALLENGE_PREFIX}${challengeId}`;
const consumedKey = (challengeId = '') => `${CONSUMED_PREFIX}${challengeId}`;

const persistChallenge = async (record = {}) => {
    const mode = getStorageMode();
    const expiresAtMs = new Date(record.expiresAt).getTime();
    const ttlSeconds = Math.max(Math.ceil((expiresAtMs - Date.now()) / 1000), 1);

    if (mode === 'redis') {
        await getRedisClient().setEx(challengeKey(record.challengeId), ttlSeconds, JSON.stringify(record));
        return record;
    }

    if (mode === 'memory') {
        scheduleCleanup();
        memoryChallenges.set(record.challengeId, record);
        return record;
    }

    logger.error('mfa.challenge_store_unavailable');
    const error = new Error('MFA challenge store is unavailable');
    error.code = 'MFA_CHALLENGE_STORE_UNAVAILABLE';
    throw error;
};

const readChallenge = async (challengeId = '') => {
    const normalizedChallengeId = normalizeChallengeId(challengeId);
    if (!normalizedChallengeId) return null;

    const mode = getStorageMode();
    if (mode === 'redis') {
        const raw = await getRedisClient().get(challengeKey(normalizedChallengeId));
        return raw ? JSON.parse(raw) : null;
    }
    if (mode === 'memory') {
        return memoryChallenges.get(normalizedChallengeId) || null;
    }
    return null;
};

const deleteChallenge = async (challengeId = '') => {
    const normalizedChallengeId = normalizeChallengeId(challengeId);
    if (!normalizedChallengeId) return;
    const mode = getStorageMode();
    if (mode === 'redis') {
        await getRedisClient().del(challengeKey(normalizedChallengeId));
    } else if (mode === 'memory') {
        memoryChallenges.delete(normalizedChallengeId);
    }
};

const markConsumed = async (record = {}) => {
    const challengeId = normalizeChallengeId(record.challengeId);
    if (!challengeId) return { success: false, reason: 'invalid_challenge' };
    const expiresAtMs = new Date(record.expiresAt).getTime();
    const ttlMs = Math.max(expiresAtMs - Date.now(), 1000);
    const mode = getStorageMode();

    if (mode === 'redis') {
        const result = await getRedisClient().set(consumedKey(challengeId), '1', { NX: true, PX: ttlMs });
        if (result !== 'OK') return { success: false, reason: 'already_consumed' };
        await deleteChallenge(challengeId);
        return { success: true };
    }

    if (mode === 'memory') {
        const current = memoryChallenges.get(challengeId);
        if (!current || current.consumedAt) return { success: false, reason: 'already_consumed' };
        memoryChallenges.set(challengeId, { ...current, consumedAt: new Date().toISOString() });
        memoryChallenges.delete(challengeId);
        return { success: true };
    }

    return { success: false, reason: 'challenge_store_unavailable' };
};

const buildPublicChallenge = (record = {}) => ({
    challengeId: record.challengeId,
    purpose: record.purpose,
    allowedMethods: Array.isArray(record.allowedMethods) ? record.allowedMethods : [],
    preferredMethod: record.preferredMethod || null,
    requiredStrength: record.requiredStrength || '',
    reason: record.reason || '',
    action: record.action || '',
    returnTo: record.returnTo || '',
    expiresAt: record.expiresAt,
    expiresIn: Math.max(Math.ceil((new Date(record.expiresAt).getTime() - Date.now()) / 1000), 0),
});

const createMfaChallenge = async ({
    user = null,
    purpose = 'login',
    policy = {},
    req = {},
    action = '',
    returnTo = '',
} = {}) => {
    if (!user?._id) {
        const error = new Error('MFA challenge requires a user');
        error.statusCode = 400;
        throw error;
    }
    const config = resolveMfaConfig();
    const challengeId = crypto.randomBytes(16).toString('hex');
    const allowedMethods = Array.isArray(policy.allowedMethods) ? policy.allowedMethods : [];
    const expiresAt = new Date(Date.now() + config.challengeTtlSeconds * 1000).toISOString();
    const record = {
        challengeId,
        userId: String(user._id),
        purpose: normalizeText(purpose) || 'login',
        allowedMethods,
        preferredMethod: policy.preferredMethod || allowedMethods[0] || null,
        requiredStrength: policy.preferredMethod || '',
        reason: policy.reason || '',
        action: normalizeText(action || policy.action || ''),
        returnTo: normalizeText(returnTo),
        createdAt: new Date().toISOString(),
        expiresAt,
        consumedAt: null,
        createdIpHash: hashBounded(getRequestIp(req)),
        createdUserAgentHash: hashBounded(getRequestUserAgent(req)),
    };

    await persistChallenge(record);
    return buildPublicChallenge(record);
};

const inspectMfaChallenge = async ({
    challengeId = '',
    userId = '',
    method = '',
    purpose = '',
    action = '',
} = {}) => {
    const record = await readChallenge(challengeId);
    const normalizedMethod = normalizeMethod(method);
    if (!record) return { success: false, reason: 'not_found' };
    if (record.consumedAt) return { success: false, reason: 'already_consumed' };
    if (String(record.userId || '') !== String(userId || '')) return { success: false, reason: 'subject_mismatch' };
    if (purpose && normalizeText(record.purpose) !== normalizeText(purpose)) return { success: false, reason: 'purpose_mismatch' };
    if (action && normalizeText(record.action) && normalizeText(record.action) !== normalizeText(action)) {
        return { success: false, reason: 'action_mismatch' };
    }
    if (new Date(record.expiresAt).getTime() <= Date.now()) return { success: false, reason: 'expired' };
    if (normalizedMethod && !record.allowedMethods.map(normalizeMethod).includes(normalizedMethod)) {
        return { success: false, reason: 'method_not_allowed' };
    }
    return { success: true, challenge: record };
};

const consumeMfaChallenge = async (options = {}) => {
    const inspected = await inspectMfaChallenge(options);
    if (!inspected.success) return inspected;
    const consumed = await markConsumed(inspected.challenge);
    if (!consumed.success) return consumed;
    return { success: true, challenge: inspected.challenge };
};

const clearMfaChallengeMemory = () => {
    memoryChallenges.clear();
};

module.exports = {
    buildPublicChallenge,
    clearMfaChallengeMemory,
    consumeMfaChallenge,
    createMfaChallenge,
    inspectMfaChallenge,
};
