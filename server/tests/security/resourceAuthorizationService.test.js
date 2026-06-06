const { verifyResourceAuthorization } = require('../../security/resourceAuthorizationService');

describe('resourceAuthorizationService', () => {
    test('tenant mismatch denies', () => {
        const decision = verifyResourceAuthorization({
            actor: { _id: 'user-1', tenantId: 'tenant-a', role: 'user' },
            resource: { id: 'resource-1', tenantId: 'tenant-b', ownerId: 'user-1' },
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasonCode).toBe('tenant_mismatch');
    });

    test('owner mismatch denies', () => {
        const decision = verifyResourceAuthorization({
            actor: { _id: 'user-1', tenantId: 'tenant-a', role: 'user' },
            resource: { id: 'resource-1', tenantId: 'tenant-a', ownerId: 'user-2' },
            allowAdminOverride: false,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasonCode).toBe('owner_mismatch');
    });

    test('support can access redacted data by default', () => {
        const decision = verifyResourceAuthorization({
            actor: { _id: 'support-1', tenantId: 'tenant-a', role: 'support' },
            resource: { id: 'resource-1', tenantId: 'tenant-a', ownerId: 'user-2' },
        });

        expect(decision.allowed).toBe(true);
        expect(decision.redacted).toBe(true);
        expect(decision.auditRequired).toBe(true);
    });

    test('admin override is allowed and audited', () => {
        const decision = verifyResourceAuthorization({
            actor: { _id: 'admin-1', tenantId: 'tenant-a', role: 'admin' },
            resource: { id: 'resource-1', tenantId: 'tenant-a', ownerId: 'user-2' },
        });

        expect(decision.allowed).toBe(true);
        expect(decision.reasonCode).toBe('admin_override');
        expect(decision.auditRequired).toBe(true);
    });

    test('deleted resource blocks', () => {
        const decision = verifyResourceAuthorization({
            actor: { _id: 'user-1', tenantId: 'tenant-a', role: 'user' },
            resource: { id: 'resource-1', tenantId: 'tenant-a', ownerId: 'user-1', deleted: true },
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasonCode).toBe('resource_inactive');
    });
});
