const { evaluateSecurityDecision } = require('../../security/securityDecisionEngine');
const { SECURITY_DECISIONS } = require('../../security/securityDecisionTypes');
const { __resetBufferedEvents } = require('../../security/securityEventLogger');

const baseContext = {
    userId: 'user-1',
    role: 'user',
    tenantId: 'tenant-1',
    resourceId: 'resource-1',
    resourceOwnerId: 'user-1',
    route: '/test',
    method: 'POST',
    ipHash: 'ip-hash',
    userAgentHash: 'ua-hash',
    deviceTrust: 'trusted',
    sessionAgeSeconds: 60,
    mfaFresh: true,
    passkeyFresh: true,
    csrfVerified: true,
    requestVelocity: 0,
    failedAttemptCount: 0,
    previousSecurityEvents: 0,
    payloadRisk: 0,
    environment: 'test',
    isProduction: false,
};

describe('securityDecisionEngine', () => {
    beforeEach(() => {
        __resetBufferedEvents();
    });

    test('unknown sensitive action denies by default', () => {
        const decision = evaluateSecurityDecision({
            ...baseContext,
            action: 'admin.secret.dump',
        });

        expect(decision.decision).toBe(SECURITY_DECISIONS.DENY);
        expect(decision.reason).toBe('unknown_sensitive_action');
    });

    test('low-risk normal action allows', () => {
        const decision = evaluateSecurityDecision({
            ...baseContext,
            action: 'product.view',
            userId: '',
            tenantId: '',
            resourceId: '',
            resourceOwnerId: '',
            mfaFresh: false,
            passkeyFresh: false,
        });

        expect(decision.decision).toBe(SECURITY_DECISIONS.ALLOW);
        expect(decision.riskScore).toBeLessThan(35);
    });

    test('critical action without fresh auth challenges', () => {
        const decision = evaluateSecurityDecision({
            ...baseContext,
            action: 'payment.refund',
            role: 'support',
            sessionAgeSeconds: 20 * 60,
            mfaFresh: false,
            passkeyFresh: false,
        });

        expect(decision.decision).toBe(SECURITY_DECISIONS.CHALLENGE);
        expect(decision.reason).toBe('session_too_old');
    });

    test('critical admin action without passkey challenges', () => {
        const decision = evaluateSecurityDecision({
            ...baseContext,
            action: 'admin.role.change',
            role: 'admin',
            mfaFresh: true,
            passkeyFresh: false,
        });

        expect(decision.decision).toBe(SECURITY_DECISIONS.CHALLENGE);
        expect(decision.reason).toBe('passkey_freshness_missing');
    });

    test('missing tenant proof denies tenant resource action', () => {
        const decision = evaluateSecurityDecision({
            ...baseContext,
            action: 'data.export',
            tenantId: '',
        });

        expect(decision.decision).toBe(SECURITY_DECISIONS.DENY);
        expect(decision.reason).toBe('tenant_boundary_missing');
    });

    test('missing owner proof denies owner resource action', () => {
        const decision = evaluateSecurityDecision({
            ...baseContext,
            action: 'order.cancel',
            resourceId: '',
            resourceOwnerId: '',
        });

        expect(decision.decision).toBe(SECURITY_DECISIONS.DENY);
        expect(decision.reason).toBe('owner_or_resource_check_missing');
    });

    test('high-risk export blocks with containment', () => {
        const decision = evaluateSecurityDecision({
            ...baseContext,
            action: 'data.export',
            role: 'admin',
            deviceTrust: 'untrusted',
            requestVelocity: 50,
            failedAttemptCount: 10,
            previousSecurityEvents: 5,
            payloadRisk: 80,
        });

        expect(decision.decision).toBe(SECURITY_DECISIONS.CONTAIN);
        expect(decision.containmentActions).toContain('freeze_exports');
    });
});
