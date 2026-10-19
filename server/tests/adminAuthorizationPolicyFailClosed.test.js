// Regression guard for the admin authorization policy coverage and the
// fail-closed behaviour of the PDP on the admin surface.
//
// The PDP (server/services/auth/authorizationService.js) returned
// allowed:true with reason 'no_policy_match' for ANY route that was absent
// from the policy table. The `admin` middleware is the only thing standing
// between an unmapped admin route and unrestricted access, so an admin route
// without a policy entry was effectively "authorized by nothing".
//
// These tests assert:
//   1. EVERY route mounted under /api/admin/ (including the ones gated by a
//      router-level `router.use(protect, admin)`) has a policy entry.
//   2. The PDP refuses an unmapped /api/admin/ route.
//   3. The PDP keeps its historical fail-open behaviour for routes outside
//      /api/admin/ (several admin-gated routes live there: order admin
//      commands, product administration, support administration, observability).
const { evaluateAuthorization, resolveAuthorizationPolicy } = require('../services/auth/authorizationService');

// Mirrors the app.use('/api/admin/...', ...) mounts in server/index.js.
const ADMIN_MOUNTS = [
    ['/api/admin/security', '../routes/adminSecurityRoutes'],
    ['/api/admin/emergency-controls', '../routes/adminEmergencyControlRoutes'],
    ['/api/admin/payments', '../routes/adminPaymentRoutes'],
    ['/api/admin/order-emails', '../routes/adminOrderEmailRoutes'],
    ['/api/admin/email-ops', '../routes/adminEmailOpsRoutes'],
    ['/api/admin/notifications', '../routes/adminNotificationRoutes'],
    ['/api/admin/analytics', '../routes/adminAnalyticsRoutes'],
    ['/api/admin/catalog', '../routes/adminCatalogRoutes'],
    ['/api/admin/users', '../routes/adminUserRoutes'],
    ['/api/admin/products', '../routes/adminProductRoutes'],
    ['/api/admin/ops', '../routes/adminOpsRoutes'],
    ['/api/admin/fraud', '../routes/adminFraudRoutes'],
    ['/api/admin/abuse', '../routes/adminAbuseRoutes'],
    ['/api/admin/privileged-access', '../routes/adminPrivilegedAccessRoutes'],
    ['/api/admin/status', '../routes/adminStatusRoutes'],
];

const layerHandles = (layer) => (
    Array.isArray(layer?.handle) ? layer.handle : [layer?.handle]
);

// Collects EVERY route a router exposes — inline `admin` middleware,
// router-level `router.use(protect, admin)` and the self-service routes that
// only carry `protect`. Every route mounted under /api/admin/ has to be
// represented in the policy table, otherwise the PDP has nothing to decide.
const collectRoutes = (stack, prefix = '') => {
    const routes = [];

    for (const layer of stack || []) {
        if (layer.route) {
            const path = `${prefix}${layer.route.path}`;
            Object.entries(layer.route.methods || {}).forEach(([method, enabled]) => {
                if (enabled) routes.push(`${method.toUpperCase()} ${path}`);
            });
        } else if (layer.handle?.stack) {
            routes.push(...collectRoutes(layer.handle.stack, `${prefix}${layer.path || ''}`));
        }
    }

    return routes;
};

describe('admin authorization policy coverage and fail-closed PDP', () => {
    const adminRoutes = ADMIN_MOUNTS.flatMap(([prefix, modulePath]) => (
        collectRoutes(require(modulePath).stack, prefix)
    ));

    test('every route mounted under /api/admin has a policy entry', () => {
        const uncovered = adminRoutes.filter((route) => {
            const [method, ...pathParts] = route.split(' ');
            return !resolveAuthorizationPolicy({ method, path: pathParts.join(' ') });
        });

        expect(adminRoutes.length).toBeGreaterThan(80);
        expect(uncovered).toEqual([]);
    });

    test('the admin security routes are all covered', () => {
        const securityRoutes = adminRoutes.filter((route) => route.includes('/api/admin/security'));

        expect(securityRoutes).toEqual(expect.arrayContaining([
            'GET /api/admin/security/status',
            'GET /api/admin/security/assurance/:userId',
            'POST /api/admin/security/recovery/exchange',
            'POST /api/admin/security/passkeys/enrollment/options',
            'POST /api/admin/security/passkeys/enrollment/verify',
            'POST /api/admin/security/passkeys/challenge/options',
            'POST /api/admin/security/passkeys/challenge/verify',
        ]));
    });

    test('the PDP refuses an admin route that has no policy entry', () => {
        const decision = evaluateAuthorization({
            user: { isAdmin: true },
            method: 'GET',
            path: '/api/admin/unmapped/route',
        });

        expect(decision).toMatchObject({
            allowed: false,
            reason: 'no_policy_match_admin',
            code: 'AUTHZ_NO_POLICY_MATCH',
            statusCode: 403,
        });
    });

    test('the PDP refuses an unmapped admin route even for a super admin', () => {
        const decision = evaluateAuthorization({
            user: { isAdmin: true, roles: ['super_admin'], permissions: ['admin:*'] },
            method: 'POST',
            path: '/api/admin/unmapped/action',
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('no_policy_match_admin');
    });

    test('the PDP still allows a non-admin route without a policy entry', () => {
        // Admin-gated routes exist outside /api/admin/ (order admin commands,
        // product administration, support administration, observability).
        // Flipping them to deny would break the app.
        const decision = evaluateAuthorization({
            user: { isAdmin: true },
            method: 'GET',
            path: '/api/observability/client-diagnostics',
        });

        expect(decision).toMatchObject({
            allowed: true,
            reason: 'no_policy_match',
            code: 'NO_POLICY_MATCH',
        });
    });

    test('a mapped admin route is still decided by its policy', () => {
        const decision = evaluateAuthorization({
            user: { isAdmin: true },
            method: 'GET',
            path: '/api/admin/users',
        });

        expect(decision).toMatchObject({
            allowed: true,
            reason: 'policy_satisfied',
            permission: 'admin.users.read',
            role: 'admin',
        });
    });

    test('an explicitly supplied policy still wins over the admin fail-closed rule', () => {
        const decision = evaluateAuthorization({
            user: { isAdmin: true },
            method: 'GET',
            path: '/api/admin/unmapped/route',
            policy: {
                method: 'GET',
                path: '/api/admin/unmapped/route',
                permission: 'admin.ops.read',
                role: 'admin',
            },
        });

        expect(decision).toMatchObject({
            allowed: true,
            reason: 'policy_satisfied',
            permission: 'admin.ops.read',
        });
    });
});
