const {
    authShield,
    buildReq,
    shieldEnv,
    withAuthShieldEnv,
} = require('./helpers/authShieldTestHelpers');

describe('authShield listing route integration', () => {
    test('seller can update own listing', async () => {
        await withAuthShieldEnv(shieldEnv({}), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'seller-1',
                isSeller: true,
                roles: ['seller'],
                path: '/api/listings/listing-1',
            }), {
                action: 'listing.update',
                sensitivity: 'medium',
                resource: { type: 'listing', id: 'listing-1', ownerId: 'seller-1', sellerId: 'seller-1' },
            });

            expect(decision.decision).toBe('allow');
        });
    });

    test('shadow mode does not break non-critical route', async () => {
        await withAuthShieldEnv(shieldEnv({ shadow: 'true' }), async () => {
            const decision = await authShield.enforce(buildReq({
                userId: 'seller-2',
                isSeller: true,
                roles: ['seller'],
                path: '/api/listings/listing-1',
            }), {
                action: 'listing.update',
                sensitivity: 'medium',
                resource: { type: 'listing', id: 'listing-1', ownerId: 'seller-1', sellerId: 'seller-1' },
            });

            expect(decision.decision).toBe('shadow_deny');
            expect(decision.enforced).toBe(false);
        });
    });

    test('public route remains unaffected when shield is disabled', async () => {
        await withAuthShieldEnv(shieldEnv({ enabled: 'false', shadow: 'true' }), async () => {
            const decision = await authShield.enforce({
                method: 'GET',
                originalUrl: '/api/listings',
                headers: { 'user-agent': 'jest-agent' },
            }, {
                action: 'listing.update',
                sensitivity: 'medium',
                resource: { type: 'listing', id: 'listing-1', ownerId: 'seller-1', sellerId: 'seller-1' },
            });

            expect(decision.decision).toBe('shadow_deny');
            expect(decision.enforced).toBe(false);
            expect(decision.reasons).toContain('auth_shield_disabled');
        });
    });
});
