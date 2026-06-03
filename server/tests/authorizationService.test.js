const {
    evaluateAuthorization,
    findActivePrivilegedGrant,
    getUserPermissions,
    getUserRoles,
    hasPermission,
    hasRole,
    resolveAuthorizationPolicy,
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
        expect(hasPermission(admin, 'admin.users.delete')).toBe(true);
        expect(hasPermission({ permissions: ['admin:users:*'] }, 'admin.users.delete')).toBe(true);
        expect(hasPermission({ permissions: ['admin.products.*'] }, 'admin:products:delete')).toBe(true);
        expect(hasPermission(seller, 'listing:manage:self')).toBe(true);
        expect(hasPermission(seller, 'admin:read')).toBe(false);
    });

    test('require helpers throw AppError-compatible authorization failures', () => {
        expect(() => requireRole({ isSeller: true }, 'admin')).toThrow(/Required role/);
        expect(() => requirePermission({ isSeller: true }, 'admin:read')).toThrow(/Required permission/);
    });

    test('matches route policies with express-style params and query strings', () => {
        const policy = resolveAuthorizationPolicy({
            method: 'POST',
            path: '/api/admin/users/507f1f77bcf86cd799439011/delete?confirm=true',
        });

        expect(policy).toMatchObject({
            method: 'POST',
            path: '/api/admin/users/:userId/delete',
            permission: 'admin.users.delete',
            role: 'admin',
        });
    });

    test('evaluates policy decisions and blocks missing roles before permissions', () => {
        const decision = evaluateAuthorization({
            user: { isSeller: true },
            method: 'POST',
            path: '/api/admin/users/507f1f77bcf86cd799439011/delete',
        });

        expect(decision).toMatchObject({
            allowed: false,
            reason: 'role_required',
            code: 'AUTHZ_ROLE_REQUIRED',
            permission: 'admin.users.delete',
            role: 'admin',
        });
    });

    test('requires active just-in-time grants for protected privileged permissions when enabled', () => {
        const now = Date.now();
        const routePolicy = {
            method: 'POST',
            path: '/api/admin/users/:userId/delete',
            permission: 'admin.users.delete',
            role: 'admin',
        };
        const privilegedAccessPolicy = {
            jitAccessEnabled: true,
            approvalRequiredFor: ['admin.users.delete'],
        };

        const missingGrant = evaluateAuthorization({
            user: { isAdmin: true },
            method: 'POST',
            path: '/api/admin/users/507f1f77bcf86cd799439011/delete',
            policies: [routePolicy],
            privilegedAccessPolicy,
            now,
        });
        expect(missingGrant).toMatchObject({
            allowed: false,
            code: 'PRIVILEGED_JIT_REQUIRED',
            jitRequired: true,
        });

        const activeGrant = {
            grantId: 'jit-grant-1',
            permission: 'admin.users.delete',
            status: 'approved',
            expiresAt: new Date(now + 60_000).toISOString(),
        };
        expect(findActivePrivilegedGrant({
            grants: [activeGrant],
            permission: 'admin.users.delete',
            now,
        })).toMatchObject({ grantId: 'jit-grant-1' });
        expect(findActivePrivilegedGrant({
            grants: [{
                permission: 'admin.users.delete',
                status: 'pending',
                expiresAt: new Date(now + 60_000).toISOString(),
            }],
            permission: 'admin.users.delete',
            now,
        })).toBeNull();
        expect(findActivePrivilegedGrant({
            grants: [{
                permission: 'admin.users.delete',
                expiresAt: new Date(now + 60_000).toISOString(),
            }],
            permission: 'admin.users.delete',
            now,
        })).toBeNull();

        const granted = evaluateAuthorization({
            user: { isAdmin: true },
            method: 'POST',
            path: '/api/admin/users/507f1f77bcf86cd799439011/delete',
            policies: [routePolicy],
            privilegedAccessPolicy,
            authSession: { privilegedGrants: [activeGrant] },
            now,
        });
        expect(granted).toMatchObject({
            allowed: true,
            reason: 'jit_grant_satisfied',
            grantId: 'jit-grant-1',
        });
    });
});
