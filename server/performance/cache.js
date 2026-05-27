const crypto = require('crypto');
const { createClient } = require('redis');
const logger = require('../utils/logger');
const { recordSpan } = require('./otel');
const {
    recordCacheBypass,
    recordCacheError,
    recordCacheHit,
    recordCacheMiss,
} = require('../middleware/metrics');

const DEFAULT_ALLOWED_PATH_PREFIXES = ['/api/public', '/health', '/status'];
const DEFAULT_DENIED_PATH_PREFIXES = [
    '/api/auth',
    '/api/otp',
    '/api/admin',
    '/api/user',
    '/api/users',
    '/api/me',
    '/api/cart',
    '/api/orders',
    '/api/checkout',
    '/api/payment',
    '/api/payments',
    '/api/notifications',
    '/api/support',
    '/api/upload',
    '/api/uploads',
    '/api/webhooks',
    '/api/email-webhooks',
    '/uploads',
];

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

let redisClient = null;
let redisConnectPromise = null;
let lastRedisError = null;
let lastRedisAttemptMs = 0;

const memoryCache = new Map();

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
};

const parseNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
};

const parsePathList = (value, fallback = []) => {
    const raw = String(value || '').trim();
    if (!raw) return [...fallback];
    return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => (entry.startsWith('/') ? entry : `/${entry}`));
};

const getCacheSettings = () => {
    const configuredDenied = parsePathList(process.env.CACHE_DENIED_PATH_PREFIXES, DEFAULT_DENIED_PATH_PREFIXES);
    return {
        performanceEnabled: parseBoolean(process.env.PERFORMANCE_STACK_ENABLED, false),
        cacheEnabled: parseBoolean(process.env.CACHE_ENABLED, false),
        cacheProvider: String(process.env.CACHE_PROVIDER || 'redis').trim().toLowerCase(),
        redisUrl: String(process.env.REDIS_URL || '').trim(),
        defaultTtlSeconds: parseNumber(process.env.CACHE_DEFAULT_TTL_SECONDS, 60, { min: 1, max: 86400 }),
        publicGetTtlSeconds: parseNumber(process.env.CACHE_PUBLIC_GET_TTL_SECONDS, 120, { min: 1, max: 86400 }),
        staleWhileRevalidateSeconds: parseNumber(process.env.CACHE_STALE_WHILE_REVALIDATE_SECONDS, 30, { min: 0, max: 86400 }),
        maxValueBytes: parseNumber(process.env.CACHE_MAX_VALUE_BYTES, 1048576, { min: 1024, max: 10 * 1024 * 1024 }),
        bypassAuth: parseBoolean(process.env.CACHE_BYPASS_AUTH, true),
        bypassCookie: parseBoolean(process.env.CACHE_BYPASS_COOKIE, true),
        bypassPrivateRoutes: parseBoolean(process.env.CACHE_BYPASS_PRIVATE_ROUTES, true),
        allowedPathPrefixes: parsePathList(process.env.CACHE_ALLOWED_PATH_PREFIXES, DEFAULT_ALLOWED_PATH_PREFIXES),
        deniedPathPrefixes: Array.from(new Set([...DEFAULT_DENIED_PATH_PREFIXES, ...configuredDenied])),
    };
};

const isCacheGloballyEnabled = (settings = getCacheSettings()) =>
    settings.performanceEnabled && settings.cacheEnabled;

const normalizePath = (req = {}) => {
    const raw = req.path || req.originalUrl || req.url || '/';
    try {
        return new URL(raw, 'http://local.test').pathname || '/';
    } catch {
        return String(raw || '/').split('?')[0] || '/';
    }
};

const hasHeader = (req, name) => {
    if (!req?.headers) return false;
    const lower = String(name).toLowerCase();
    return Object.prototype.hasOwnProperty.call(req.headers, lower)
        || Object.keys(req.headers).some((key) => key.toLowerCase() === lower);
};

const getRequestHeader = (req, name) => {
    if (typeof req.get === 'function') return req.get(name);
    const lower = String(name).toLowerCase();
    return req?.headers?.[lower] || req?.headers?.[name] || '';
};

const pathStartsWithAny = (path, prefixes = []) =>
    prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix.replace(/\/+$/, '')}/`));

const isPrivateCacheControl = (value = '') => {
    const normalized = String(value || '').toLowerCase();
    return normalized.includes('private')
        || normalized.includes('no-store')
        || normalized.includes('no-cache');
};

const getHeaderFromResponse = (res, name) => {
    if (!res || typeof res.getHeader !== 'function') return '';
    return res.getHeader(name) || res.getHeader(String(name).toLowerCase()) || '';
};

const getCacheDecision = (req, res = null, settings = getCacheSettings()) => {
    if (!isCacheGloballyEnabled(settings)) return { cacheable: false, reason: 'disabled' };

    const method = String(req?.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) return { cacheable: false, reason: 'method' };

    const path = normalizePath(req);
    if (settings.bypassPrivateRoutes && pathStartsWithAny(path, settings.deniedPathPrefixes)) {
        return { cacheable: false, reason: 'denied_path' };
    }

    if (!pathStartsWithAny(path, settings.allowedPathPrefixes)) {
        return { cacheable: false, reason: 'not_allowed_path' };
    }

    if (settings.bypassAuth && hasHeader(req, 'authorization')) {
        return { cacheable: false, reason: 'authorization' };
    }

    if (settings.bypassCookie && hasHeader(req, 'cookie')) {
        return { cacheable: false, reason: 'cookie' };
    }

    const requestCacheControl = getRequestHeader(req, 'cache-control');
    if (String(requestCacheControl || '').toLowerCase().includes('no-cache')) {
        return { cacheable: false, reason: 'request_no_cache' };
    }

    if (res) {
        if (res.statusCode >= 400) return { cacheable: false, reason: 'status' };
        if (getHeaderFromResponse(res, 'set-cookie')) return { cacheable: false, reason: 'set_cookie' };
        if (isPrivateCacheControl(getHeaderFromResponse(res, 'cache-control'))) {
            return { cacheable: false, reason: 'private_cache_control' };
        }
    }

    return { cacheable: true, reason: 'public_get' };
};

const shouldCacheRequest = (req, res = null) => getCacheDecision(req, res).cacheable;

const buildCacheKey = (req) => {
    const method = String(req?.method || 'GET').toUpperCase() === 'HEAD' ? 'GET' : String(req?.method || 'GET').toUpperCase();
    const url = req?.originalUrl || req?.url || '/';
    const vary = {
        acceptLanguage: getRequestHeader(req, 'accept-language') || '',
        market: getRequestHeader(req, 'x-market') || '',
        currency: getRequestHeader(req, 'x-currency') || '',
    };
    const digest = crypto
        .createHash('sha256')
        .update(JSON.stringify({ method, url, vary }))
        .digest('hex');
    return `perf-cache:v1:${digest}`;
};

const connectRedis = async () => {
    const settings = getCacheSettings();
    if (!isCacheGloballyEnabled(settings) || settings.cacheProvider !== 'redis') return null;
    if (!settings.redisUrl) {
        lastRedisError = 'REDIS_URL missing';
        return null;
    }
    if (redisClient?.isOpen) return redisClient;
    if (redisConnectPromise) return redisConnectPromise;

    const now = Date.now();
    if (lastRedisError && now - lastRedisAttemptMs < 5000) return null;
    lastRedisAttemptMs = now;

    const client = createClient({
        url: settings.redisUrl,
        socket: {
            connectTimeout: 1000,
            reconnectStrategy: false,
        },
    });

    client.on('error', (error) => {
        lastRedisError = error?.message || 'redis error';
        logger.warn('performance.cache.redis_error', { error: lastRedisError });
    });

    redisConnectPromise = client.connect()
        .then(() => {
            redisClient = client;
            lastRedisError = null;
            logger.info('performance.cache.redis_ready');
            return redisClient;
        })
        .catch((error) => {
            lastRedisError = error?.message || 'redis connect failed';
            logger.warn('performance.cache.redis_unavailable', { error: lastRedisError });
            return null;
        })
        .finally(() => {
            redisConnectPromise = null;
        });

    return redisConnectPromise;
};

const getMemoryValue = (key) => {
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        memoryCache.delete(key);
        return null;
    }
    return entry.value;
};

const setMemoryValue = (key, value, ttlSeconds) => {
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });
};

const getCache = async (key) => {
    const settings = getCacheSettings();
    if (!isCacheGloballyEnabled(settings)) return null;
    const start = process.hrtime.bigint();

    try {
        if (settings.cacheProvider === 'memory') {
            const value = getMemoryValue(key);
            void recordSpan({
                name: 'cache.get',
                durationMs: Number(process.hrtime.bigint() - start) / 1e6,
                attributes: { provider: 'memory', hit: Boolean(value) },
            });
            return value;
        }

        const client = await connectRedis();
        if (!client) return null;
        const value = await client.get(key);
        void recordSpan({
            name: 'redis.get',
            durationMs: Number(process.hrtime.bigint() - start) / 1e6,
            attributes: { provider: 'redis', hit: Boolean(value) },
        });
        return value ? JSON.parse(value) : null;
    } catch (error) {
        void recordSpan({
            name: 'cache.get',
            durationMs: Number(process.hrtime.bigint() - start) / 1e6,
            attributes: { provider: settings.cacheProvider },
            error,
        });
        recordCacheError({ reason: 'get' });
        logger.warn('performance.cache.get_failed', { error: error.message });
        return null;
    }
};

const setCache = async (key, value, ttl = null) => {
    const settings = getCacheSettings();
    if (!isCacheGloballyEnabled(settings)) return false;
    const start = process.hrtime.bigint();

    try {
        const serialized = JSON.stringify(value);
        if (Buffer.byteLength(serialized, 'utf8') > settings.maxValueBytes) {
            recordCacheBypass({ reason: 'max_value_bytes' });
            return false;
        }
        const ttlSeconds = parseNumber(ttl, settings.defaultTtlSeconds, { min: 1, max: 86400 });

        if (settings.cacheProvider === 'memory') {
            setMemoryValue(key, value, ttlSeconds);
            void recordSpan({
                name: 'cache.set',
                durationMs: Number(process.hrtime.bigint() - start) / 1e6,
                attributes: { provider: 'memory', ttlSeconds },
            });
            return true;
        }

        const client = await connectRedis();
        if (!client) return false;
        await client.set(key, serialized, { EX: ttlSeconds });
        void recordSpan({
            name: 'redis.set',
            durationMs: Number(process.hrtime.bigint() - start) / 1e6,
            attributes: { provider: 'redis', ttlSeconds },
        });
        return true;
    } catch (error) {
        void recordSpan({
            name: 'cache.set',
            durationMs: Number(process.hrtime.bigint() - start) / 1e6,
            attributes: { provider: settings.cacheProvider },
            error,
        });
        recordCacheError({ reason: 'set' });
        logger.warn('performance.cache.set_failed', { error: error.message });
        return false;
    }
};

const delCache = async (key) => {
    const settings = getCacheSettings();
    try {
        if (settings.cacheProvider === 'memory') {
            return memoryCache.delete(key);
        }
        const client = await connectRedis();
        if (!client) return false;
        await client.del(key);
        return true;
    } catch (error) {
        recordCacheError({ reason: 'delete' });
        logger.warn('performance.cache.delete_failed', { error: error.message });
        return false;
    }
};

const invalidateCachePrefix = async (prefix = 'perf-cache:v1:') => {
    const settings = getCacheSettings();
    try {
        if (settings.cacheProvider === 'memory') {
            for (const key of Array.from(memoryCache.keys())) {
                if (key.startsWith(prefix)) memoryCache.delete(key);
            }
            return true;
        }

        const client = await connectRedis();
        if (!client || typeof client.scanIterator !== 'function') return false;
        for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
            await client.del(key);
        }
        return true;
    } catch (error) {
        recordCacheError({ reason: 'invalidate' });
        logger.warn('performance.cache.invalidate_failed', { error: error.message });
        return false;
    }
};

const invalidatePublicCache = () => invalidateCachePrefix('perf-cache:v1:');

const pickCacheableHeaders = (res) => {
    const headers = typeof res.getHeaders === 'function' ? res.getHeaders() : {};
    return Object.entries(headers).reduce((acc, [key, value]) => {
        const lower = key.toLowerCase();
        if (['set-cookie', 'content-length', 'transfer-encoding', 'connection', 'x-cache', 'server-timing'].includes(lower)) return acc;
        acc[key] = value;
        return acc;
    }, {});
};

const sendCachedResponse = (req, res, cached) => {
    res.set('X-Cache', 'HIT');
    Object.entries(cached.headers || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) res.setHeader(key, value);
    });
    res.status(cached.status || 200);
    if (String(req.method || '').toUpperCase() === 'HEAD') return res.end();
    return res.send(cached.body);
};

const createPublicCacheMiddleware = () => async (req, res, next) => {
    const requestDecision = getCacheDecision(req);
    if (!requestDecision.cacheable) {
        recordCacheBypass({ reason: requestDecision.reason });
        res.set('X-Cache', 'BYPASS');
        return next();
    }

    const key = buildCacheKey(req);

    try {
        const cached = await getCache(key);
        if (cached) {
            recordCacheHit({ route: normalizePath(req) });
            return sendCachedResponse(req, res, cached);
        }

        recordCacheMiss({ route: normalizePath(req) });
        res.set('X-Cache', 'MISS');
    } catch (error) {
        recordCacheError({ reason: 'middleware_get' });
        res.set('X-Cache', 'ERROR');
        logger.warn('performance.cache.middleware_get_failed', { error: error.message });
        return next();
    }

    const originalSend = res.send.bind(res);
    res.send = function sendAndMaybeCache(body) {
        const responseDecision = getCacheDecision(req, res);
        if (responseDecision.cacheable) {
            const payload = {
                status: res.statusCode,
                headers: pickCacheableHeaders(res),
                body: Buffer.isBuffer(body) ? body.toString('utf8') : body,
                storedAt: new Date().toISOString(),
            };
            void setCache(key, payload, getCacheSettings().publicGetTtlSeconds);
        } else {
            res.set('X-Cache', 'BYPASS');
            recordCacheBypass({ reason: responseDecision.reason });
        }

        return originalSend(body);
    };

    return next();
};

const publicCacheInvalidationMiddleware = () => (req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

    const path = normalizePath(req);
    const affectsPublicCache = path.startsWith('/api/products')
        || path.startsWith('/api/status')
        || path.startsWith('/api/public');
    if (!affectsPublicCache) return next();

    res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 400) return;
        void invalidatePublicCache();
    });

    return next();
};

const __resetCacheForTests = async () => {
    memoryCache.clear();
    if (redisClient?.isOpen) {
        await redisClient.quit().catch(() => {});
    }
    redisClient = null;
    redisConnectPromise = null;
    lastRedisError = null;
    lastRedisAttemptMs = 0;
};

module.exports = {
    buildCacheKey,
    connectRedis,
    createPublicCacheMiddleware,
    delCache,
    getCache,
    getCacheDecision,
    getCacheSettings,
    invalidateCachePrefix,
    invalidatePublicCache,
    publicCacheInvalidationMiddleware,
    setCache,
    shouldCacheRequest,
    __resetCacheForTests,
};
