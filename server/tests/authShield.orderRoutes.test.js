const {
    authShield,
    buildReq,
    shieldEnv,
    withAuthShieldEnv,
} = require('./helpers/authShieldTestHelpers');

describe('authShield order route integration', () => {
    test('buyer can act on own order', async () => {
        await withAuthShieldEnv(shieldEnv({}), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'buyer-1',
                path: '/api/orders/order-1/cancel',
            }), {
                action: 'order.cancel',
                sensitivity: 'medium',
                resource: { type: 'order', id: 'order-1', ownerId: 'buyer-1', buyerId: 'buyer-1' },
            });

            expect(decision.decision).toBe('allow');
        });
    });

    test('resource not found is surfaced as a safe shield denial', async () => {
        await withAuthShieldEnv(shieldEnv({ shadow: 'false' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'buyer-1',
                path: '/api/orders/missing/cancel',
            }), {
                action: 'order.cancel',
                sensitivity: 'medium',
                resource: null,
            });

            expect(decision.decision).toBe('deny');
            expect(decision.reasons).toContain('resource_missing');
        });
    });
});
