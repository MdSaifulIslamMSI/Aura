const { evaluateAuthorization } = require('../engines/authorizationEngine');

describe('authorizationEngine', () => {
    test('allows actors with a mapped role', () => {
        const decision = evaluateAuthorization({
            actor: { role: 'admin', roles: ['admin'] },
            policy: { allowedRoles: ['admin', 'super_admin'] },
        });

        expect(decision).toMatchObject({
            ok: true,
            reason: 'PERMISSION_ALLOWED',
        });
    });

    test('denies actors without permission', () => {
        const decision = evaluateAuthorization({
            actor: { role: 'buyer', roles: ['buyer'] },
            policy: { allowedRoles: ['admin'] },
        });

        expect(decision).toMatchObject({
            ok: false,
            reason: 'PERMISSION_DENIED',
            actorRole: 'buyer',
        });
    });
});
