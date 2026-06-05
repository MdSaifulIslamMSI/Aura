const crypto = require('crypto');
const { getRedisClient, flags: redisFlags, isRedisRequired } = require('../config/redis');
const { resolveAlienOtpConfig } = require('../config/alienOtpConfig');
const { normalizeAction } = require('../security/authShield/types');

const memoryChallenges = new Map();

const normalizeId = (value = '') => String(value || '').trim();
const nowIso = () => new Date().toISOString();

const buildChallengeKey = (challengeId) => `${redisFlags.redisPrefix}:alien-otp:challenge:${challengeId}`;

const normalizeRiskLevel = (value = 'low') => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['low', 'medium', 'high', 'critical'].includes(normalized) ? normalized : 'low';
};

const purgeExpiredMemory = () => {
    const now = Date.now();
    for (const [challengeId, challenge] of memoryChallenges.entries()) {
        if (Number(challenge.expiresAtMs || 0) <= now) {
            memoryChallenges.delete(challengeId);
        }
    }
};

const cloneChallenge = (challenge) => (
    challenge ? JSON.parse(JSON.stringify(challenge)) : null
);

const assertWritableStore = () => {
    const client = getRedisClient();
    if (client) return client;
    if (process.env.NODE_ENV === 'production' || isRedisRequired()) {
        throw new Error('ALIEN OTP challenge store unavailable');
    }
    return null;
};

const persistChallenge = async (challenge, ttlSeconds) => {
    const client = assertWritableStore();
    if (client) {
        const result = await client.set(
            buildChallengeKey(challenge.challengeId),
            JSON.stringify(challenge),
            { NX: true, EX: ttlSeconds }
        );
        if (result !== 'OK') {
            throw new Error('ALIEN OTP challenge collision');
        }
        return challenge;
    }

    purgeExpiredMemory();
    if (memoryChallenges.has(challenge.challengeId)) {
        throw new Error('ALIEN OTP challenge collision');
    }
    memoryChallenges.set(challenge.challengeId, cloneChallenge(challenge));
    return challenge;
};

const createChallenge = async ({
    userId,
    tenantId = '',
    action,
    resourceId = '',
    sessionId = '',
    deviceId = '',
    requestId = '',
    riskContext = {},
    ttlSeconds,
    env,
} = {}) => {
    const config = resolveAlienOtpConfig(env || process.env);
    const resolvedTtl = ttlSeconds || config.challengeTtlSeconds;
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + (resolvedTtl * 1000);
    const challenge = {
        challengeId: `alien_ch_${crypto.randomBytes(16).toString('hex')}`,
        nonce: crypto.randomBytes(32).toString('base64url'),
        userId: normalizeId(userId),
        tenantId: normalizeId(tenantId),
        sessionId: normalizeId(sessionId),
        deviceId: normalizeId(deviceId),
        action: normalizeAction(action),
        resourceId: normalizeId(resourceId),
        riskLevel: normalizeRiskLevel(riskContext.riskLevel || riskContext.level),
        issuedAt: new Date(issuedAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        used: false,
        requestId: normalizeId(requestId),
    };

    if (!challenge.userId || !challenge.action) {
        throw new Error('ALIEN OTP challenge requires userId and action');
    }

    await persistChallenge(challenge, resolvedTtl);
    return cloneChallenge(challenge);
};

const loadChallenge = async (challengeId = '') => {
    const normalizedChallengeId = normalizeId(challengeId);
    if (!normalizedChallengeId) return null;
    const client = getRedisClient();

    if (client) {
        const raw = await client.get(buildChallengeKey(normalizedChallengeId));
        if (!raw) return null;
        return JSON.parse(raw);
    }

    purgeExpiredMemory();
    return cloneChallenge(memoryChallenges.get(normalizedChallengeId));
};

const getChallenge = async (challengeId) => {
    const challenge = await loadChallenge(challengeId);
    if (!challenge) return null;
    if (challenge.used) return null;
    if (Number(challenge.expiresAtMs || 0) <= Date.now()) {
        memoryChallenges.delete(challenge.challengeId);
        return null;
    }
    return cloneChallenge(challenge);
};

const verifyChallengeShape = async ({
    challengeId,
    userId,
    tenantId = '',
    action,
    resourceId = '',
    sessionId = '',
    deviceId = '',
    requireDevice = false,
} = {}) => {
    const challenge = await loadChallenge(challengeId);
    const reasons = [];

    if (!challenge) reasons.push('challenge_missing');
    if (challenge?.used) reasons.push('challenge_replayed');
    if (challenge && Number(challenge.expiresAtMs || 0) <= Date.now()) reasons.push('challenge_expired');
    if (challenge && normalizeId(challenge.userId) !== normalizeId(userId)) reasons.push('wrong_user');
    if (challenge && normalizeId(challenge.tenantId) !== normalizeId(tenantId)) reasons.push('wrong_tenant');
    if (challenge && normalizeAction(challenge.action) !== normalizeAction(action)) reasons.push('wrong_action');
    if (challenge && normalizeId(challenge.resourceId) !== normalizeId(resourceId)) reasons.push('wrong_resource');
    if (challenge?.sessionId && sessionId && normalizeId(challenge.sessionId) !== normalizeId(sessionId)) reasons.push('wrong_session');
    if (requireDevice && challenge && normalizeId(challenge.deviceId) !== normalizeId(deviceId)) reasons.push('wrong_device');

    return {
        ok: reasons.length === 0,
        challenge: reasons.length === 0 ? cloneChallenge(challenge) : null,
        reasons,
    };
};

const consumeChallengeMemory = (challengeId) => {
    purgeExpiredMemory();
    const challenge = memoryChallenges.get(challengeId);
    if (!challenge) return { success: false, reason: 'challenge_missing' };
    if (challenge.used) return { success: false, reason: 'challenge_replayed' };
    if (Number(challenge.expiresAtMs || 0) <= Date.now()) {
        memoryChallenges.delete(challengeId);
        return { success: false, reason: 'challenge_expired' };
    }
    challenge.used = true;
    challenge.consumedAt = nowIso();
    memoryChallenges.set(challengeId, challenge);
    return { success: true, challenge: cloneChallenge(challenge) };
};

const consumeChallenge = async (challengeId) => {
    const normalizedChallengeId = normalizeId(challengeId);
    if (!normalizedChallengeId) return { success: false, reason: 'challenge_missing' };
    const client = getRedisClient();

    if (client) {
        const result = await client.eval(
            `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'challenge_missing' end
local obj = cjson.decode(raw)
if obj['used'] == true then return 'challenge_replayed' end
if tonumber(obj['expiresAtMs'] or '0') <= tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1])
  return 'challenge_expired'
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 1 then
  redis.call('DEL', KEYS[1])
  return 'challenge_expired'
end
obj['used'] = true
obj['consumedAt'] = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(obj), 'PX', ttl)
return 'ok'
`,
            {
                keys: [buildChallengeKey(normalizedChallengeId)],
                arguments: [String(Date.now()), nowIso()],
            }
        );
        return result === 'ok'
            ? { success: true }
            : { success: false, reason: result || 'challenge_consume_failed' };
    }

    return consumeChallengeMemory(normalizedChallengeId);
};

const revokeUserChallenges = async (userId) => {
    const normalizedUserId = normalizeId(userId);
    const client = getRedisClient();
    if (client) {
        const keys = await client.keys(buildChallengeKey('*'));
        let revoked = 0;
        for (const key of keys) {
            const raw = await client.get(key);
            if (!raw) continue;
            const challenge = JSON.parse(raw);
            if (normalizeId(challenge.userId) === normalizedUserId) {
                await client.del(key);
                revoked += 1;
            }
        }
        return { revoked };
    }

    let revoked = 0;
    for (const [challengeId, challenge] of memoryChallenges.entries()) {
        if (normalizeId(challenge.userId) === normalizedUserId) {
            memoryChallenges.delete(challengeId);
            revoked += 1;
        }
    }
    return { revoked };
};

const cleanupExpiredChallenges = () => {
    const before = memoryChallenges.size;
    purgeExpiredMemory();
    return { removed: before - memoryChallenges.size };
};

const resetAlienOtpChallengeMemoryForTests = () => memoryChallenges.clear();

module.exports = {
    cleanupExpiredChallenges,
    consumeChallenge,
    createChallenge,
    getChallenge,
    resetAlienOtpChallengeMemoryForTests,
    revokeUserChallenges,
    verifyChallengeShape,
};
