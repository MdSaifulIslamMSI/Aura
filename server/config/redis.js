const { createClient } = require('redis');
const logger = require('../utils/logger');

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseNumber = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
};

const asTrimmed = (value, fallback = '') => String(value || fallback).trim();

const nodeEnv = asTrimmed(process.env.NODE_ENV, 'development').toLowerCase();
const isProduction = nodeEnv === 'production';

const flags = {
    redisEnabled: parseBoolean(process.env.REDIS_ENABLED, false),
    redisRequired: parseBoolean(process.env.REDIS_REQUIRED, false),
    splitRuntimeEnabled: parseBoolean(process.env.SPLIT_RUNTIME_ENABLED, false),
    redisUrl: asTrimmed(process.env.REDIS_URL, ''),
    redisPrefix: asTrimmed(process.env.REDIS_PREFIX, 'aura'),
    redisConnectTimeoutMs: parseNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, 3000, { min: 250, max: 30000 }),
};

let redisClient = null;
let initPromise = null;
let lastError = null;
let connectedAt = null;

const isRedisRequired = () => flags.redisRequired || (isProduction && flags.splitRuntimeEnabled);

const isRedisEnabled = () => flags.redisEnabled;

const getRedisHealth = () => ({
    enabled: flags.redisEnabled,
    required: isRedisRequired(),
    splitRuntimeEnabled: flags.splitRuntimeEnabled,
    connected: Boolean(redisClient?.isOpen),
    urlConfigured: Boolean(flags.redisUrl),
    prefix: flags.redisPrefix,
    connectedAt: connectedAt ? connectedAt.toISOString() : null,
    lastError: lastError || null,
});

const assertProductionRedisConfig = () => {
    if (!isProduction) return;
    if (isRedisRequired() && !flags.redisEnabled) {
        throw new Error('Redis must be enabled for production split-runtime or REDIS_REQUIRED deployments');
    }
    if ((flags.redisEnabled || isRedisRequired()) && !flags.redisUrl) {
        throw new Error('REDIS_URL must be configured when Redis is enabled or required in production');
    }
};

const initRedis = async () => {
    if (!flags.redisEnabled) return null;
    if (redisClient?.isOpen) return redisClient;
    if (initPromise) return initPromise;

    if (!flags.redisUrl) {
        lastError = 'REDIS_URL missing';
        logger.warn('redis.disabled_missing_url');
        return null;
    }

    const client = createClient({
        url: flags.redisUrl,
        socket: {
            connectTimeout: flags.redisConnectTimeoutMs,
            reconnectStrategy: (attempt) => {
                const delay = Math.min(attempt * 200, 3000);
                return delay;
            },
        },
    });

    client.on('connect', () => {
        logger.info('redis.connecting');
    });
    client.on('ready', () => {
        connectedAt = new Date();
        lastError = null;
        logger.info('redis.ready');
    });
    client.on('reconnecting', () => {
        logger.warn('redis.reconnecting');
    });
    client.on('end', () => {
        logger.warn('redis.disconnected');
    });
    client.on('error', (error) => {
        lastError = error?.message || 'unknown redis error';
        logger.warn('redis.error', { error: lastError });
    });

    initPromise = client
        .connect()
        .then(() => {
            redisClient = client;
            return redisClient;
        })
        .catch((error) => {
            lastError = error?.message || 'redis connect failed';
            logger.error('redis.connect_failed', { error: lastError });
            if (isRedisRequired()) {
                throw error;
            }
            return null;
        })
        .finally(() => {
            initPromise = null;
        });

    return initPromise;
};

const getRedisClient = () => {
    if (!flags.redisEnabled) return null;
    if (!redisClient?.isOpen) return null;
    return redisClient;
};

module.exports = {
    flags,
    initRedis,
    getRedisClient,
    getRedisHealth,
    assertProductionRedisConfig,
    isRedisEnabled,
    isRedisRequired,
};
