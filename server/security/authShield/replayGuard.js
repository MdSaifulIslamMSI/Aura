const { getRedisClient, flags: redisFlags } = require('../../config/redis');
const { isCritical } = require('./types');

const memoryStore = new Map();

const purgeExpired = () => {
    const now = Date.now();
    for (const [key, expiresAt] of memoryStore.entries()) {
        if (expiresAt <= now) memoryStore.delete(key);
    }
};

const setOnceMemory = (key, ttlSeconds) => {
    purgeExpired();
    if (memoryStore.has(key)) return false;
    memoryStore.set(key, Date.now() + ttlSeconds * 1000);
    return true;
};

const setOnce = async (key, ttlSeconds) => {
    const client = getRedisClient();
    if (client) {
        const result = await client.set(key, '1', { NX: true, EX: ttlSeconds });
        return Boolean(result);
    }
    return setOnceMemory(key, ttlSeconds);
};

const buildKey = (kind, value) => `${redisFlags.redisPrefix}:authshield:${kind}:${value}`;

const isFreshTimestamp = (value = '', ttlSeconds = 300) => {
    if (!value) return true;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return Math.abs(Date.now() - millis) <= ttlSeconds * 1000;
};

const checkReplay = async ({
    session = {},
    proof = {},
    config = {},
    sensitivity = 'medium',
    requireNonce = false,
} = {}) => {
    if (!config.replayGuardEnabled) {
        return { ok: true, replayed: false, reasons: ['replay_guard_disabled'] };
    }

    const reasons = [];
    const ttlSeconds = config.replayTtlSeconds || 300;
    const nonce = String(session.nonce || proof.nonce || '').trim();
    const jti = String(proof.jti || '').trim();
    const needsNonce = requireNonce || isCritical(sensitivity);

    if (needsNonce && !nonce) {
        reasons.push('missing_nonce');
    }
    if (!isFreshTimestamp(session.timestamp, ttlSeconds)) {
        reasons.push('stale_timestamp');
    }

    if (nonce) {
        const ok = await setOnce(buildKey('replay:nonce', nonce), ttlSeconds);
        if (!ok) reasons.push('replayed_nonce');
    }
    if (jti) {
        const ok = await setOnce(buildKey('replay:jti', jti), ttlSeconds);
        if (!ok) reasons.push('replayed_jti');
    }

    return {
        ok: reasons.length === 0,
        replayed: reasons.some((reason) => reason.startsWith('replayed_')),
        reasons,
    };
};

const resetReplayMemoryForTests = () => memoryStore.clear();

module.exports = {
    checkReplay,
    resetReplayMemoryForTests,
};
