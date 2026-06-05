const { evaluateAlienRisk } = require('../services/alienOtpRiskEngine');

describe('ALIEN OTP risk engine', () => {
    test('escalates sensitive admin actions on unknown devices', () => {
        const risk = evaluateAlienRisk({
            user: { adminRoles: ['SUPER_ADMIN'] },
            session: {},
            device: {},
            action: 'admin.role.update',
            request: { headers: {} },
        });

        expect(risk.riskLevel).toBe('high');
        expect(risk.requiresAlienProof).toBe(true);
        expect(risk.reasons).toEqual(expect.arrayContaining([
            'new_or_missing_device',
            'missing_session',
            'sensitive_admin_action',
        ]));
    });

    test('blocks tenant boundary mismatches as critical risk', () => {
        const risk = evaluateAlienRisk({
            user: { tenantId: 'tenant-a' },
            action: 'tenant.settings.update',
            resource: { tenantId: 'tenant-b' },
            request: { headers: { 'x-aura-device-id': 'device-1', 'user-agent': 'jest-agent' } },
            session: { sessionId: 'session-1' },
            device: { deviceId: 'device-1' },
        });

        expect(risk.riskLevel).toBe('critical');
        expect(risk.block).toBe(true);
    });
});
