const { getRedisClient, flags: redisFlags } = require('../../config/redis');

const localSignals = new Map();

const nowMs = () => Date.now();

const getLocalEntry = (key = '') => {
    const entry = localSignals.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs()) {
        localSignals.delete(key);
        return null;
    }
    return entry;
};

const incrementLocal = (key = '', ttlSeconds = 300, by = 1) => {
    const existing = getLocalEntry(key);
    const nextValue = (existing?.value || 0) + by;
    localSignals.set(key, {
        value: nextValue,
        expiresAt: nowMs() + (ttlSeconds * 1000),
    });
    return nextValue;
};

const getLocal = (key = '') => getLocalEntry(key)?.value || 0;

const setLocalOnce = (key = '', ttlSeconds = 300) => {
    if (getLocalEntry(key)) return false;
    localSignals.set(key, {
        value: 1,
        expiresAt: nowMs() + (ttlSeconds * 1000),
    });
    return true;
};

const trustSignalKey = (kind = '', key = '') => `${redisFlags.redisPrefix}:trust:${kind}:${String(key || 'unknown')}`;

const incrementSignal = async ({
    kind = '',
    key = '',
    ttlSeconds = 300,
    by = 1,
} = {}) => {
    const signalKey = trustSignalKey(kind, key);
    const client = getRedisClient();
    if (!client) {
        return incrementLocal(signalKey, ttlSeconds, by);
    }

    const value = await client.incrBy(signalKey, by);
    if (value === by) {
        await client.expire(signalKey, ttlSeconds);
    }
    return value;
};

const getSignal = async ({ kind = '', key = '' } = {}) => {
    const signalKey = trustSignalKey(kind, key);
    const client = getRedisClient();
    if (!client) return getLocal(signalKey);
    const value = Number(await client.get(signalKey));
    return Number.isFinite(value) ? value : 0;
};

const setSignalOnce = async ({
    kind = '',
    key = '',
    ttlSeconds = 24 * 60 * 60,
} = {}) => {
    const signalKey = trustSignalKey(kind, key);
    const client = getRedisClient();
    if (!client) return setLocalOnce(signalKey, ttlSeconds);
    const result = await client.set(signalKey, '1', { NX: true, EX: ttlSeconds });
    return result === 'OK';
};

const recordOwnershipMismatch = async ({ actorId = '', route = '' } = {}) => (
    incrementSignal({
        kind: 'ownership_mismatch',
        key: `${actorId || 'anonymous'}:${route || 'unknown'}`,
        ttlSeconds: 10 * 60,
    })
);

const recordPaymentWebhookEvent = async ({ eventId = '', provider = '' } = {}) => {
    if (!eventId) return { duplicate: false, count: 0 };
    const firstSeen = await setSignalOnce({
        kind: 'payment_webhook_event',
        key: `${provider || 'unknown'}:${eventId}`,
        ttlSeconds: 24 * 60 * 60,
    });
    const count = await incrementSignal({
        kind: 'payment_webhook_count',
        key: `${provider || 'unknown'}:${eventId}`,
        ttlSeconds: 24 * 60 * 60,
    });
    return {
        duplicate: !firstSeen || count > 1,
        count,
    };
};

const resetLocalSignals = () => {
    localSignals.clear();
};

module.exports = {
    getSignal,
    incrementSignal,
    recordOwnershipMismatch,
    recordPaymentWebhookEvent,
    resetLocalSignals,
    setSignalOnce,
    trustSignalKey,
};
