const {
    evaluateResourceAuthorization,
} = require('../security/authorizationPolicy');

describe('authorization policy', () => {
    test('allows owners and denies non-owners by default', () => {
        const ownerDecision = evaluateResourceAuthorization({
            actor: { _id: 'user-1', role: 'user' },
            resource: { ownerId: 'user-1' },
            action: 'order.read',
        });
        const deniedDecision = evaluateResourceAuthorization({
            actor: { _id: 'user-2', role: 'user' },
            resource: { ownerId: 'user-1' },
            action: 'order.read',
        });

        expect(ownerDecision).toMatchObject({ allowed: true, reasonCode: 'owner_allowed' });
        expect(deniedDecision).toMatchObject({ allowed: false, reasonCode: 'owner_mismatch' });
    });

    test('allows admin override only when policy opts in', () => {
        const denied = evaluateResourceAuthorization({
            actor: { _id: 'admin-1', isAdmin: true },
            resource: { ownerId: 'user-1' },
            action: 'order.status.change',
            allowAdmin: false,
        });
        const allowed = evaluateResourceAuthorization({
            actor: { _id: 'admin-1', isAdmin: true },
            resource: { ownerId: 'user-1' },
            action: 'order.status.change',
            allowAdmin: true,
        });

        expect(denied.allowed).toBe(false);
        expect(allowed).toMatchObject({
            allowed: true,
            reasonCode: 'admin_allowed',
            adminOverride: true,
        });
    });

    test('denies tenant mismatch and missing resources fail closed', () => {
        const mismatch = evaluateResourceAuthorization({
            actor: { _id: 'seller-1', sellerId: 'store-1' },
            resource: { ownerId: 'seller-1', sellerId: 'store-2' },
            action: 'seller.product.update',
            requireTenantMatch: true,
        });
        const missing = evaluateResourceAuthorization({
            actor: { _id: 'user-1' },
            resource: null,
            action: 'order.read',
        });

        expect(mismatch).toMatchObject({ allowed: false, reasonCode: 'tenant_mismatch' });
        expect(missing).toMatchObject({ allowed: false, reasonCode: 'resource_missing' });
    });

    test('malformed or missing actor is denied safely', () => {
        const decision = evaluateResourceAuthorization({
            actor: {},
            resource: { ownerId: 'user-1' },
            action: 'order.read',
        });

        expect(decision).toMatchObject({ allowed: false, reasonCode: 'actor_missing' });
    });
});
