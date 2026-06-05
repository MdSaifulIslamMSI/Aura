const logger = require('../utils/logger');
const {
    buildAuditEvent,
    writeDecisionAudit,
} = require('../security/authShield/auditWriter');

describe('authShield audit writer', () => {
    test('builds redacted decision event with hashes only', () => {
        const event = buildAuditEvent({
            req: {
                requestId: 'req-1',
                method: 'POST',
                originalUrl: '/api/payments/intents/pi_1/refunds',
                ip: '203.0.113.9',
                headers: { 'user-agent': 'jest-agent' },
            },
            decision: {
                decision: 'deny',
                action: 'payment.refund',
                sensitivity: 'critical',
                riskLevel: 'high',
                requestId: 'req-1',
                failClosed: true,
            },
            identity: { userId: 'user-secret-id' },
            resource: { type: 'refund', id: 'refund-secret-id', tenantId: 'tenant-secret' },
            risk: { level: 'high', reasons: ['missing_nonce'] },
            config: { policyVersion: '2026-06-05', shadowMode: true },
        });

        expect(event.userIdHash).toHaveLength(16);
        expect(event.resourceIdHash).toHaveLength(16);
        expect(event.tenantIdHash).toHaveLength(16);
        expect(JSON.stringify(event)).not.toContain('user-secret-id');
        expect(JSON.stringify(event)).not.toContain('refund-secret-id');
    });

    test('writes audit event without secrets', async () => {
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        await writeDecisionAudit({
            req: { requestId: 'req-2', headers: {} },
            decision: { decision: 'deny', action: 'auth.mfa.disable', sensitivity: 'critical' },
            identity: { userId: 'user-secret-id' },
            resource: { type: 'auth', id: 'auth-secret-id' },
            risk: { level: 'high', reasons: [] },
            config: { auditEnabled: true, policyVersion: '2026-06-05' },
        });

        expect(warnSpy).toHaveBeenCalledWith('authshield.decision', expect.not.objectContaining({
            userId: 'user-secret-id',
        }));
        warnSpy.mockRestore();
    });
});
