const { buildTrustAuditEvent } = require('../audit/trustEvidenceModel');
const { recordTrustDecision } = require('../audit/trustAuditLogger');

describe('trustAuditLogger', () => {
    test('redacts secrets and hashes actor/resource identifiers', () => {
        const event = buildTrustAuditEvent({
            decision: {
                decision: 'BLOCK',
                reason: 'RESOURCE_OWNERSHIP_MISMATCH',
                riskScore: 75,
                riskLevel: 'high',
                enforcementMode: 'enforce-safe',
                requiredStepUp: null,
                evidence: {
                    decisionId: 'trust_decision_1',
                    requestId: 'req-1',
                    actorId: 'user-raw-1',
                    action: 'order.read',
                    resourceType: 'order',
                    resourceId: 'order-raw-1',
                    route: '/api/orders/order-raw-1',
                    timestamp: '2026-06-05T00:00:00.000Z',
                },
            },
            metadata: {
                authorization: {
                    raw: 'Bearer secret-token',
                },
                cookie: 'session=secret',
                proof: 'raw-device-proof',
                providerError: 'upstream returned Bearer provider-token',
                harmless: 'ok',
            },
        });
        const serialized = JSON.stringify(event);

        expect(event.actorId).not.toBe('user-raw-1');
        expect(event.resourceId).not.toBe('order-raw-1');
        expect(event.metadata.authorization).toBe('[REDACTED]');
        expect(event.metadata.cookie).toBe('[REDACTED]');
        expect(event.metadata.proof).toBe('[REDACTED]');
        expect(event.metadata.providerError).toBe('upstream returned [REDACTED]');
        expect(event.metadata.harmless).toBe('ok');
        expect(serialized).not.toContain('secret-token');
        expect(serialized).not.toContain('raw-device-proof');
        expect(serialized).not.toContain('provider-token');
    });

    test('returns an audit event without throwing', () => {
        const event = recordTrustDecision({
            req: {
                method: 'GET',
                originalUrl: '/api/orders/123',
                headers: {},
            },
            decision: {
                audit: true,
                allowed: true,
                decision: 'AUDIT_ONLY',
                reason: 'RESOURCE_OWNERSHIP_MISMATCH',
                riskScore: 60,
                riskLevel: 'high',
                enforcementMode: 'shadow',
                evidence: {
                    decisionId: 'trust_decision_2',
                    action: 'order.read',
                    resourceType: 'order',
                    resourceId: 'order-1',
                },
            },
        });

        expect(event).toMatchObject({
            event: 'trust.fabric.decision',
            decision: 'AUDIT_ONLY',
            reason: 'RESOURCE_OWNERSHIP_MISMATCH',
        });
    });
});
