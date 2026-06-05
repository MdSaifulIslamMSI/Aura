const {
    evaluateRisk,
    recordDeniedDecision,
    resetRiskMemoryForTests,
} = require('../security/authShield/riskEngine');

describe('authShield risk engine', () => {
    afterEach(() => resetRiskMemoryForTests());

    test('tenant mismatch becomes critical risk', () => {
        const risk = evaluateRisk({
            identity: { userId: 'u1', tenantId: 'tenant-a' },
            session: { userAgent: 'jest', requestId: 'req-1', deviceId: 'dev-1' },
            resource: { tenantId: 'tenant-b' },
            relationship: { reason: 'tenant_mismatch' },
            sensitivity: 'critical',
            config: { riskEngineEnabled: true },
        });

        expect(risk.level).toBe('critical');
        expect(risk.reasons).toContain('tenant_mismatch');
    });

    test('repeated denied decisions raise risk', () => {
        const identity = { userId: 'u1' };
        recordDeniedDecision(identity, 'listing.update');
        recordDeniedDecision(identity, 'listing.update');
        recordDeniedDecision(identity, 'listing.update');

        const risk = evaluateRisk({
            identity,
            action: 'listing.update',
            session: { userAgent: 'jest', requestId: 'req-1', deviceId: 'dev-1' },
            config: { riskEngineEnabled: true },
        });

        expect(risk.reasons).toContain('repeated_denied_decisions');
    });
});
