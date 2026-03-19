const AppError = require('../utils/AppError');
const { flags: redisFlags, getRedisClient } = require('../config/redis');

const CHAT_WINDOW_MS = Number(process.env.CHAT_USER_WINDOW_MS || (15 * 60 * 1000));
const CHAT_MAX_REQUESTS_PER_WINDOW = Number(process.env.CHAT_USER_MAX_REQUESTS || 60);
const localQuotaBuckets = new Map();

const chatQuotaHealth = {
    mode: 'local',
    lastError: '',
};

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const buildRedisQuotaKey = (userId) => `${redisFlags.redisPrefix}:chat:quota:${safeString(userId)}`;

const updateChatQuotaHealth = (partial = {}) => {
    Object.assign(chatQuotaHealth, partial);
};

const assertLocalQuota = (userId) => {
    const key = safeString(userId);
    if (!key) throw new AppError('User identity is required for private chat', 401);

    const now = Date.now();
    const current = localQuotaBuckets.get(key);
    if (!current || current.expiresAt <= now) {
        localQuotaBuckets.set(key, { count: 1, expiresAt: now + CHAT_WINDOW_MS });
        updateChatQuotaHealth({
            mode: 'local',
            lastError: '',
        });
        return;
    }

    if (current.count >= CHAT_MAX_REQUESTS_PER_WINDOW) {
        throw new AppError('Private AI chat quota exceeded. Please retry later.', 429);
    }

    current.count += 1;
    localQuotaBuckets.set(key, current);
    updateChatQuotaHealth({
        mode: 'local',
        lastError: '',
    });
};

const assertRedisQuota = async (userId) => {
    const key = safeString(userId);
    if (!key) throw new AppError('User identity is required for private chat', 401);

    const client = getRedisClient();
    if (!client?.isOpen) {
        assertLocalQuota(key);
        return;
    }

    try {
        const redisKey = buildRedisQuotaKey(key);
        const currentCount = await client.incr(redisKey);

        if (currentCount === 1) {
            await client.pExpire(redisKey, CHAT_WINDOW_MS);
        } else {
            const ttlMs = await client.pTTL(redisKey);
            if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
                await client.pExpire(redisKey, CHAT_WINDOW_MS);
            }
        }

        if (currentCount > CHAT_MAX_REQUESTS_PER_WINDOW) {
            throw new AppError('Private AI chat quota exceeded. Please retry later.', 429);
        }

        updateChatQuotaHealth({
            mode: 'redis',
            lastError: '',
        });
    } catch (error) {
        if (error instanceof AppError) {
            updateChatQuotaHealth({
                mode: 'redis',
                lastError: '',
            });
            throw error;
        }

        updateChatQuotaHealth({
            mode: 'local',
            lastError: error?.message || 'redis_chat_quota_failed',
        });
        assertLocalQuota(key);
    }
};

const assertPrivateChatQuota = async (userId) => {
    await assertRedisQuota(userId);
};

const getChatQuotaHealth = () => ({
    mode: getRedisClient()?.isOpen && !chatQuotaHealth.lastError ? 'redis' : chatQuotaHealth.mode,
    distributed: Boolean(getRedisClient()?.isOpen) && !chatQuotaHealth.lastError,
    windowMs: CHAT_WINDOW_MS,
    maxRequestsPerWindow: CHAT_MAX_REQUESTS_PER_WINDOW,
    lastError: chatQuotaHealth.lastError || null,
});

module.exports = {
    assertPrivateChatQuota,
    getChatQuotaHealth,
};
