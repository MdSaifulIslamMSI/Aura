const { getRedisClient, flags: redisFlags } = require('../config/redis');
const logger = require('../utils/logger');

const memoryStore = new Map();
let memoryCleanupEvery = 0;

let redisCircuitBroken = false;
let redisCircuitLastFailure = 0;
const REDIS_CIRCUIT_TIMEOUT = 10000; // 10 seconds before retry

const parseKey = (value) => String(value || '').trim();

const scheduleMemoryCleanup = () => {
    if (memoryCleanupEvery) return;
    memoryCleanupEvery = setInterval(() => {
        const now = Date.now();
        for (const [key, value] of memoryStore.entries()) {
            if (value.resetAt <= now) {
                memoryStore.delete(key);
            }
        }
    }, 60 * 1000);

    if (typeof memoryCleanupEvery.unref === 'function') {
        memoryCleanupEvery.unref();
    }
};

const computeMemoryWindow = (storeKey, windowMs) => {
    const now = Date.now();
    const current = memoryStore.get(storeKey);

    if (!current || current.resetAt <= now) {
        const next = { count: 1, resetAt: now + windowMs };
        memoryStore.set(storeKey, next);
        return {
            count: next.count,
            ttlMs: Math.max(next.resetAt - now, 0),
        };
    }

    current.count += 1;
    memoryStore.set(storeKey, current);
    return {
        count: current.count,
        ttlMs: Math.max(current.resetAt - now, 0),
    };
};

const applyRedisExpiry = async (client, storeKey, windowMs) => {
    if (typeof client?.pExpire === 'function') {
        await client.pExpire(storeKey, windowMs);
        return;
    }

    await client.sendCommand(['PEXPIRE', storeKey, String(windowMs)]);
};

const computeRedisWindow = async (storeKey, windowMs) => {
    const client = getRedisClient();
    if (!client) return null;

    const tx = client.multi();
    tx.incr(storeKey);
    tx.pTTL(storeKey);
    const [countRaw, ttlRaw] = await tx.exec();
    const count = Number(countRaw) || 0;
    let ttlMs = Number(ttlRaw);

    if (ttlMs < 0) {
        await applyRedisExpiry(client, storeKey, windowMs);
        ttlMs = windowMs;
    }

    return {
        count,
        ttlMs: Math.max(ttlMs, 0),
    };
};

const setHeaders = (res, max, count, ttlMs) => {
    const remaining = Math.max(max - count, 0);
    const resetAtSeconds = Math.ceil((Date.now() + ttlMs) / 1000);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetAtSeconds));
};

const createDistributedRateLimit = ({
    name,
    windowMs,
    max,
    message,
    keyGenerator,
    skip,
    securityCritical = false,
    allowInMemoryFallback = false,
}) => {
    if (!name || !windowMs || !max) {
        throw new Error('createDistributedRateLimit requires name, windowMs, and max');
    }

    scheduleMemoryCleanup();
    const limiterName = parseKey(name);
    const limiterMessage = message || 'Too many requests. Please try again later.';
    const buildResponsePayload = (req, context = {}) => {
        const payload = typeof limiterMessage === 'function'
            ? limiterMessage(req, context)
            : limiterMessage;
        const responsePayload = typeof payload === 'string'
            ? { message: payload }
            : { ...(payload || {}) };
        if (req.requestId && responsePayload.requestId === undefined) {
            responsePayload.requestId = req.requestId;
        }
        if (context.retryAfterSeconds && responsePayload.retryAfter === undefined) {
            responsePayload.retryAfter = context.retryAfterSeconds;
        }
        return responsePayload;
    };
    const createKey = typeof keyGenerator === 'function'
        ? keyGenerator
        : (req) => req.ip || req.socket?.remoteAddress || 'unknown';
    const buildRedisUnavailablePayload = (req) => ({
        message: 'Rate limiter dependency unavailable. Please try again shortly.',
        ...(req.requestId ? { requestId: req.requestId } : {}),
    });

    const failClosedIfRequired = (res, reason) => {
        if (!securityCritical || process.env.NODE_ENV !== 'production') return false;
        logger.error('rate_limit.redis_required_unavailable', {
            limiter: limiterName,
            reason,
        });
        if (!res.headersSent) {
            return res.status(503).json(buildRedisUnavailablePayload(res.req || {}));
        }
        return true;
    };

    return async (req, res, next) => {
        if (process.env.NODE_ENV === 'test') return next();
        if (typeof skip === 'function' && skip(req)) return next();

        const identifier = parseKey(createKey(req)) || 'unknown';
        const storeKey = `${redisFlags.redisPrefix}:rl:${limiterName}:${identifier}`;

        const now = Date.now();
        const skipRedis = redisCircuitBroken && (now - redisCircuitLastFailure < REDIS_CIRCUIT_TIMEOUT);

        try {
            let state = null;
            if (!skipRedis) {
                const client = getRedisClient();
                if (client) {
                    try {
                        state = await computeRedisWindow(storeKey, windowMs);
                        if (redisCircuitBroken) {
                            redisCircuitBroken = false;
                            logger.info('rate_limit.redis_circuit_recovered');
                        }
                    } catch (redisError) {
                        redisCircuitBroken = true;
                        redisCircuitLastFailure = now;
                        logger.warn('rate_limit.redis_circuit_opened', { error: redisError.message });
                    }
                }
            }

            if (!state && allowInMemoryFallback) {
                state = computeMemoryWindow(storeKey, windowMs);
            }

            if (!state) {
                return failClosedIfRequired(res, skipRedis ? 'redis_circuit_open' : 'redis_unavailable')
                    || res.status(503).json(buildRedisUnavailablePayload(req));
            }

            setHeaders(res, max, state.count, state.ttlMs);

            if (state.count > max) {
                const retryAfterSeconds = Math.max(Math.ceil(state.ttlMs / 1000), 1);
                res.setHeader('Retry-After', String(retryAfterSeconds));
                return res.status(429).json(buildResponsePayload(req, { retryAfterSeconds }));
            }
            return next();
        } catch (error) {
            logger.error('rate_limit.unexpected_error', {
                limiter: limiterName,
                error: error?.message || 'unknown error',
            });

            if (!allowInMemoryFallback) {
                return failClosedIfRequired(res, 'unexpected_error')
                    || res.status(503).json(buildRedisUnavailablePayload(req));
            }

            const state = computeMemoryWindow(storeKey, windowMs);
            if (!res.headersSent) {
                setHeaders(res, max, state.count, state.ttlMs);
            }
            if (state.count > max && !res.headersSent) {
                const retryAfterSeconds = Math.max(Math.ceil(state.ttlMs / 1000), 1);
                res.setHeader('Retry-After', String(retryAfterSeconds));
                return res.status(429).json(buildResponsePayload(req, { retryAfterSeconds }));
            }
            return next();
        }
    };
};

module.exports = {
    createDistributedRateLimit,
    applyRedisExpiry,
};
