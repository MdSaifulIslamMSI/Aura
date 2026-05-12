const { evaluateLoginRisk } = require('../services/authRiskEngineService');

describe('authRiskEngineService', () => {
    test('returns low risk for a known trusted device with no adverse signals', () => {
        const result = evaluateLoginRisk({
            user: { trustedDevices: [{ deviceId: 'device-a' }] },
            deviceId: 'device-a',
            recentFailureCount: 0,
            ipReputation: 'clean',
            emailVerified: true,
        });

        expect(result).toMatchObject({
            score: 0,
            level: 'low',
            requireStepUp: false,
            block: false,
            knownDevice: true,
        });
    });

    test('recommends step-up for new device and failed-login velocity', () => {
        const result = evaluateLoginRisk({
            user: { trustedDevices: [{ deviceId: 'device-a' }] },
            deviceId: 'device-b',
            recentFailureCount: 6,
            ipReputation: 'clean',
        });

        expect(result.level).toBe('medium');
        expect(result.requireStepUp).toBe(true);
        expect(result.block).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining([
            'failed_login_velocity',
            'new_device',
        ]));
    });

    test('blocks denylisted IPs even when other signals are quiet', () => {
        const result = evaluateLoginRisk({
            user: { trustedDevices: [{ deviceId: 'device-a' }] },
            deviceId: 'device-a',
            ipReputation: 'denylist',
        });

        expect(result.level).toBe('high');
        expect(result.requireStepUp).toBe(true);
        expect(result.block).toBe(true);
        expect(result.reasons).toContain('ip_denylist');
    });

    test('models impossible travel as a high-signal step-up reason', () => {
        const result = evaluateLoginRisk({
            user: { trustedDevices: [{ deviceId: 'device-a' }] },
            deviceId: 'device-a',
            impossibleTravel: true,
        });

        expect(result.requireStepUp).toBe(true);
        expect(result.reasons).toContain('impossible_travel');
    });
});
