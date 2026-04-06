describe('chatQuotaService', () => {
    afterEach(() => {
        jest.resetModules();
        delete process.env.CHAT_USER_WINDOW_MS;
        delete process.env.CHAT_USER_MAX_REQUESTS;
    });

    test('uses redis-backed quota when redis is available', async () => {
        process.env.CHAT_USER_WINDOW_MS = '60000';
        process.env.CHAT_USER_MAX_REQUESTS = '3';

        const fakeRedis = {
            isOpen: true,
            incr: jest.fn().mockResolvedValue(1),
            pExpire: jest.fn().mockResolvedValue(true),
            pTTL: jest.fn(),
        };

        jest.doMock('../config/redis', () => ({
            flags: { redisPrefix: 'aura-test' },
            getRedisClient: () => fakeRedis,
        }));

        const { assertPrivateChatQuota, getChatQuotaHealth } = require('../services/chatQuotaService');
        await assertPrivateChatQuota('user-1');

        expect(fakeRedis.incr).toHaveBeenCalledWith('aura-test:chat:quota:user-1');
        expect(fakeRedis.pExpire).toHaveBeenCalledWith('aura-test:chat:quota:user-1', 60000);
        expect(getChatQuotaHealth()).toMatchObject({
            mode: 'redis',
            distributed: true,
            maxRequestsPerWindow: 3,
        });
    });

    test('falls back to local quota when redis is unavailable and enforces limits', async () => {
        process.env.CHAT_USER_WINDOW_MS = '60000';
        process.env.CHAT_USER_MAX_REQUESTS = '2';

        jest.doMock('../config/redis', () => ({
            flags: { redisPrefix: 'aura-test' },
            getRedisClient: () => null,
        }));

        const { assertPrivateChatQuota, getChatQuotaHealth } = require('../services/chatQuotaService');

        await assertPrivateChatQuota('user-2');
        await assertPrivateChatQuota('user-2');
        await expect(assertPrivateChatQuota('user-2')).rejects.toMatchObject({
            statusCode: 429,
        });

        expect(getChatQuotaHealth()).toMatchObject({
            mode: 'local',
            distributed: false,
            maxRequestsPerWindow: 2,
        });
    });
});
