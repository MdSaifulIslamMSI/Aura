const { verifyIdentity } = require('../security/authShield/identityVerifier');

describe('authShield identity verifier', () => {
    test('denies disabled or deleted accounts on protected actions', () => {
        const result = verifyIdentity({
            user: {
                _id: 'user-1',
                email: 'user@example.test',
                isVerified: true,
                accountState: 'deleted',
            },
        }, { sensitivity: 'critical' });

        expect(result.ok).toBe(false);
        expect(result.reasons).toContain('account_deleted');
    });

    test('unknown role does not become admin without server isAdmin flag', () => {
        const result = verifyIdentity({
            user: {
                _id: 'user-1',
                roles: ['admin', 'mystery'],
                isAdmin: false,
                isVerified: true,
                accountState: 'active',
            },
        }, { sensitivity: 'medium' });

        expect(result.identity.roles).not.toContain('admin');
        expect(result.identity.hasAdminRole).toBe(false);
    });
});
