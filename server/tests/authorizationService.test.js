const {
    getUserPermissions,
    getUserRoles,
    hasPermission,
    hasRole,
    requirePermission,
    requireRole,
} = require('../services/auth/authorizationService');

describe('authorizationService', () => {
    test('denies roles and permissions by default', () => {
        expect(getUserRoles(null)).toEqual([]);
        expect(hasRole(null, 'admin')).toBe(false);
        expect(hasPermission(null, 'admin:read')).toBe(false);
    });

    test('maps existing user fields into centralized roles', () => {
        const user = {
            isAdmin: true,
            isSeller: true,
            adminRoles: ['SECURITY_ADMIN'],
        };

        expect(getUserRoles(user)).toEqual(expect.arrayContaining(['user', 'admin', 'seller', 'support']));
        expect(hasRole(user, 'admin')).toBe(true);
        expect(hasRole(user, 'support')).toBe(true);
        expect(hasRole(user, 'seller')).toBe(true);
    });

    test('grants role-derived permissions and wildcard permissions', () => {
        const admin = { isAdmin: true };
        const seller = { isSeller: true };

        expect(getUserPermissions(admin)).toEqual(expect.arrayContaining(['admin:*']));
        expect(hasPermission(admin, 'payment:refund')).toBe(true);
        expect(hasPermission(seller, 'listing:manage:self')).toBe(true);
        expect(hasPermission(seller, 'admin:read')).toBe(false);
    });

    test('require helpers throw AppError-compatible authorization failures', () => {
        expect(() => requireRole({ isSeller: true }, 'admin')).toThrow(/Required role/);
        expect(() => requirePermission({ isSeller: true }, 'admin:read')).toThrow(/Required permission/);
    });
});
