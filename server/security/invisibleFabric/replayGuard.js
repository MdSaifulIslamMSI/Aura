const crypto = require('crypto');
const { getRedisClient, flags: redisFlags } = require('../../config/redis');

const memoryStore = new Map();

const normalizeText = (value = '') => String(value || '').trim();

const purgeExpired = () => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
        if (Number(entry?.expiresAt || 0) <= now) memoryStore.delete(key);
    }
};

const hashBinding = (parts = []) => crypto
    .createHash('sha256')
    .update(parts.map((part) => normalizeText(part)).join('|'))
    .digest('hex');

const setNonceBindingMemory = (key, binding, ttlSeconds) => {
    purgeExpired();
    const existing = memoryStore.get(key);
    if (existing) {
        return {
            ok: false,
            existingBinding: existing.binding,
        };
    }
    memoryStore.set(key, {
        binding,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return { ok: true, existingBinding: '' };
};

const setNonceBinding = async (key, binding, ttlSeconds) => {
    const client = getRedisClient();
    if (client) {
        const result = await client.set(key, binding, { NX: true, EX: ttlSeconds });
        if (result) return { ok: true, existingBinding: '' };
        const existingBinding = await client.get(key);
        return { ok: false, existingBinding: existingBinding || '' };
    }
    return setNonceBindingMemory(key, binding, ttlSeconds);
};

const assertReplayGuard = async ({
    actorId = '',
    sessionId = '',
    intent = '',
    resourceType = '',
    resourceId = '',
    nonce = '',
    timestamp = '',
    ttlSeconds = 300,
} = {}) => {
    const reasons = [];
    const safeNonce = normalizeText(nonce);
    const safeTimestamp = Number(timestamp);

    if (!safeNonce) reasons.push('missing_nonce');
    if (!normalizeText(actorId)) reasons.push('missing_actor');
    if (!normalizeText(sessionId)) reasons.push('missing_session');
    if (!normalizeText(intent)) reasons.push('missing_intent');
    if (!Number.isFinite(safeTimestamp)) {
        reasons.push('invalid_timestamp');
    } else if (Math.abs(Date.now() - (safeTimestamp > 10_000_000_000 ? safeTimestamp : safeTimestamp * 1000)) > ttlSeconds * 1000) {
        reasons.push('expired_timestamp');
    }

    if (reasons.length > 0) {
        return { ok: false, reasons };
    }

    const binding = hashBinding([actorId, sessionId, intent, resourceType, resourceId, safeNonce]);
    const key = `${redisFlags.redisPrefix}:invisible-fabric:replay:nonce:${safeNonce}`;
    const firstUse = await setNonceBinding(key, binding, ttlSeconds);
    if (!firstUse.ok) {
        reasons.push(firstUse.existingBinding && firstUse.existingBinding !== binding
            ? 'nonce_binding_mismatch'
            : 'replayed_nonce');
    }

    return { ok: reasons.length === 0, reasons, binding };
};

const resetInvisibleReplayMemoryForTests = () => memoryStore.clear();

module.exports = {
    assertReplayGuard,
    resetInvisibleReplayMemoryForTests,
};
