const {
    registerDeviceBinding,
    verifyDeviceBinding,
} = require('../services/alienDeviceBindingService');

describe('ALIEN device binding service', () => {
    test('registers only hashed binding metadata', async () => {
        const binding = await registerDeviceBinding({
            userId: 'user-1',
            sessionId: 'session-secret',
            credentialId: 'credential-secret',
            publicKeyThumbprint: 'thumbprint-secret',
            userAgentHash: 'ua-hash',
        });

        expect(binding.sessionIdHash).toHaveLength(64);
        expect(binding.credentialIdHash).toHaveLength(64);
        expect(JSON.stringify(binding)).not.toContain('session-secret');
        expect(JSON.stringify(binding)).not.toContain('credential-secret');
    });

    test('rejects stolen-token style proof without device session', () => {
        const result = verifyDeviceBinding({
            userId: 'user-1',
            sessionId: 'session-1',
            proof: { deviceId: 'device-1', sessionId: 'session-1' },
            request: { headers: { 'x-aura-device-id': 'device-1' } },
        });

        expect(result).toEqual({
            success: false,
            reason: 'device_session_missing',
        });
    });
});
