const { trustFabric } = require('../index');
const { resetLocalSignals } = require('../engines/rateSignalEngine');

describe('trustFabric.evaluate', () => {
    beforeEach(() => {
        resetLocalSignals();
        delete process.env.AURA_TRUST_FABRIC_MODE;
        delete process.env.AURA_TRUST_FABRIC_ENABLED;
    });

    test('disabled Trust Fabric returns ALLOW and skips audit', async () => {
        const decision = await trustFabric.evaluate({
            action: 'order.read',
            actor: null,
            resource: { id: 'order-1', resourceType: 'order', ownerId: 'user-1' },
            config: { enabled: false },
        });

        expect(decision).toMatchObject({
            decision: 'ALLOW',
            allowed: true,
            reason: 'TRUST_FABRIC_OFF',
            audit: false,
            enforcementMode: 'off',
        });
    });

    test('missing flags default to shadow mode instead of uncontrolled enforcement', async () => {
        const decision = await trustFabric.evaluate({
            action: 'order.read',
            actor: { _id: 'user-1' },
            resource: { id: 'order-1', resourceType: 'order', ownerId: 'user-2' },
            request: { route: '/api/orders/order-1', requestId: 'req-1' },
        });

        expect(decision).toMatchObject({
            decision: 'AUDIT_ONLY',
            allowed: true,
            reason: 'RESOURCE_OWNERSHIP_MISMATCH',
            enforcementMode: 'shadow',
        });
    });

    test('decision output has a stable schema', async () => {
        const decision = await trustFabric.evaluate({
            action: 'ai.chat.invoke',
            actor: null,
            resource: { id: 'ai-session-1', resourceType: 'ai_session' },
            request: { route: '/api/ai/chat', requestId: 'req-ai-1' },
        });

        expect(Object.keys(decision).sort()).toEqual([
            'allowed',
            'audit',
            'decision',
            'enforcementMode',
            'evidence',
            'metadata',
            'reason',
            'requiredStepUp',
            'riskLevel',
            'riskScore',
        ].sort());
        expect(decision.evidence).toEqual(expect.objectContaining({
            action: 'ai.chat.invoke',
            resourceType: 'ai_session',
            route: '/api/ai/chat',
            requestId: 'req-ai-1',
            decisionId: expect.stringMatching(/^trust_/),
        }));
    });

    test('audit flag can suppress Trust Fabric audit writes', async () => {
        const decision = await trustFabric.evaluate({
            action: 'order.read',
            actor: { _id: 'user-1' },
            resource: { id: 'order-1', resourceType: 'order', ownerId: 'user-1' },
            config: { auditEnabled: false },
        });

        expect(decision).toMatchObject({
            decision: 'ALLOW',
            audit: false,
        });
    });

    test('payment webhook duplicate is detected and audited in shadow', async () => {
        const decision = await trustFabric.evaluate({
            action: 'payment.webhook.process',
            actor: { actorType: 'payment_webhook', role: 'payment_webhook' },
            resource: {
                id: 'evt-1',
                eventId: 'evt-1',
                resourceType: 'payment_webhook',
                duplicate: true,
            },
            request: { route: '/api/payments/webhooks/stripe', requestId: 'req-webhook-1' },
        });

        expect(decision).toMatchObject({
            decision: 'AUDIT_ONLY',
            allowed: true,
            reason: 'PAYMENT_WEBHOOK_REPLAY',
            audit: true,
        });
    });

    test('system health degradation throttles only mapped risky actions', async () => {
        const riskyWrite = await trustFabric.evaluate({
            action: 'order.cancel',
            actor: { _id: 'user-1' },
            resource: { id: 'order-1', resourceType: 'order', ownerId: 'user-1', state: 'placed' },
            system: { status: 'degraded', throttleRiskyWrites: true },
            config: { mode: 'enforce-safe' },
        });
        const normalRead = await trustFabric.evaluate({
            action: 'order.read',
            actor: { _id: 'user-1' },
            resource: { id: 'order-1', resourceType: 'order', ownerId: 'user-1', state: 'placed' },
            system: { status: 'degraded', throttleRiskyWrites: true },
            config: { mode: 'enforce-safe' },
        });

        expect(riskyWrite).toMatchObject({
            decision: 'THROTTLE',
            allowed: false,
            reason: 'SYSTEM_HEALTH_DEGRADED',
        });
        expect(normalRead.allowed).toBe(true);
    });
});
