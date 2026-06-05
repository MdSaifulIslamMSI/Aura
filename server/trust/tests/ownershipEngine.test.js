const { evaluateOwnership } = require('../engines/ownershipEngine');

describe('ownershipEngine', () => {
    const policy = {
        requiresOwnership: true,
        adminBypassesOwnership: true,
    };

    test('allows a user who owns the resource', () => {
        const decision = evaluateOwnership({
            actor: { id: 'user-1', role: 'buyer' },
            resource: { id: 'order-1', ownerId: 'user-1' },
            policy,
        });

        expect(decision).toMatchObject({
            ok: true,
            reason: 'RESOURCE_OWNER_MATCH',
        });
    });

    test('detects object ownership mismatch', () => {
        const decision = evaluateOwnership({
            actor: { id: 'user-1', role: 'buyer' },
            resource: { id: 'order-1', ownerId: 'user-2' },
            policy,
        });

        expect(decision).toMatchObject({
            ok: false,
            reason: 'RESOURCE_OWNERSHIP_MISMATCH',
        });
    });

    test('allows admin bypass only when policy permits it', () => {
        const decision = evaluateOwnership({
            actor: { id: 'admin-1', role: 'admin' },
            resource: { id: 'order-1', ownerId: 'user-2' },
            policy,
        });

        expect(decision).toMatchObject({
            ok: true,
            reason: 'ADMIN_OWNERSHIP_BYPASS',
        });
    });
});
