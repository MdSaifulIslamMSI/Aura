const relationshipAuthz = require('../security/authShield/relationshipAuthz');

describe('authShield relationship authorization', () => {
    test('valid owner is allowed for own order', () => {
        const result = relationshipAuthz.can(
            { userId: 'buyer-1', roles: ['user'] },
            'order.cancel',
            { type: 'order', ownerId: 'buyer-1', buyerId: 'buyer-1' }
        );

        expect(result.allowed).toBe(true);
        expect(result.relation).toBe('buyer');
    });

    test('non-owner seller cannot update another seller listing', () => {
        const result = relationshipAuthz.can(
            { userId: 'seller-2', roles: ['seller'] },
            'listing.update',
            { type: 'listing', sellerId: 'seller-1', ownerId: 'seller-1' }
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('listing_relationship_denied');
    });

    test('tenant mismatch always denies', () => {
        const result = relationshipAuthz.can(
            { userId: 'u1', roles: ['admin'], hasAdminRole: true, tenantId: 'tenant-a' },
            'admin.config.update',
            { type: 'admin_config', tenantId: 'tenant-b' }
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('tenant_mismatch');
    });
});
