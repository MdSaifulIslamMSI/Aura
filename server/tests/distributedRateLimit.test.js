const ORIGINAL_ENV = { ...process.env };

describe('distributedRateLimit redis expiry compatibility', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.dontMock('../config/redis');
        jest.dontMock('../utils/logger');
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('uses client.pExpire when supported by the redis client', async () => {
        const fakeClient = {
            pExpire: jest.fn().mockResolvedValue(true),
            sendCommand: jest.fn(),
        };

        const { applyRedisExpiry } = require('../middleware/distributedRateLimit');
        await applyRedisExpiry(fakeClient, 'aura:rl:test', 30000);

        expect(fakeClient.pExpire).toHaveBeenCalledWith('aura:rl:test', 30000);
        expect(fakeClient.sendCommand).not.toHaveBeenCalled();
    });

    test('falls back to plain PEXPIRE without NX for redis variants that reject the extra argument', async () => {
        const fakeClient = {
            sendCommand: jest.fn().mockResolvedValue(1),
        };

        const { applyRedisExpiry } = require('../middleware/distributedRateLimit');
        await applyRedisExpiry(fakeClient, 'aura:rl:test', 45000);

        expect(fakeClient.sendCommand).toHaveBeenCalledWith(['PEXPIRE', 'aura:rl:test', '45000']);
    });

    test('does not mutate or continue a response closed while Redis admission is pending', async () => {
        process.env.NODE_ENV = 'production';
        let releaseRedis;
        const redisResult = new Promise((resolve) => {
            releaseRedis = resolve;
        });
        const transaction = {
            incr: jest.fn(),
            pTTL: jest.fn(),
            exec: jest.fn(() => redisResult),
        };
        const logger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };

        jest.doMock('../config/redis', () => ({
            flags: { redisPrefix: 'aura-test' },
            getRedisClient: () => ({ multi: () => transaction }),
        }));
        jest.doMock('../utils/logger', () => logger);

        const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
        const limiter = createDistributedRateLimit({
            name: 'timeout_race',
            windowMs: 60_000,
            max: 10,
            securityCritical: true,
        });
        const req = {
            ip: '127.0.0.1',
            requestId: 'timeout-race',
            trafficBudgetTimedOut: false,
        };
        const res = {
            destroyed: false,
            headersSent: false,
            writableEnded: false,
            json: jest.fn(),
            setHeader: jest.fn(),
            status: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        const pending = limiter(req, res, next);
        req.trafficBudgetTimedOut = true;
        res.headersSent = true;
        res.writableEnded = true;
        releaseRedis([1, 60_000]);
        await pending;

        expect(res.setHeader).not.toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });
});
