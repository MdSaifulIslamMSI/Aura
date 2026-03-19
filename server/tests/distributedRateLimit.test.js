describe('distributedRateLimit redis expiry compatibility', () => {
    afterEach(() => {
        jest.resetModules();
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
});
