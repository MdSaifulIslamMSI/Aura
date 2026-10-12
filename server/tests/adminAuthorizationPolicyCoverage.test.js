// Guards the admin authorization surface against silent fail-open.
//
// evaluateAuthorization returns allowed:true with reason 'no_policy_match' for
// any route absent from the policy table, and enforceAdminAuthorizationPolicy
// (run by the `admin` middleware) is the only thing standing between an
// unmapped admin route and unrestricted access. This test walks every route
// mounted under /api/admin in server/index.js that carries the `admin`
// middleware and asserts each one has a matching policy entry, so a newly
// added admin endpoint can never ship authorized by nothing.
//
// Routes mounted with `protect` only (the caller's own security status, own
// passkey enrollment, own recovery exchange) operate on the authenticated
// user's own identity and are intentionally outside the admin policy surface.
const { resolveAuthorizationPolicy } = require('../services/auth/authorizationService');
const { admin: adminMiddleware } = require('../middleware/authMiddleware');

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

const collectRoutes = (stack, prefix = '') => {
    const routes = [];
    for (const layer of stack || []) {
        if (layer.route) {
            const path = `${prefix}${layer.route.path}`;
            const hasAdminGate = (layer.route.stack || []).some(
                (handler) => handler?.handle === adminMiddleware
            );
            if (!hasAdminGate) continue;
            Object.entries(layer.route.methods || {}).forEach(([method, enabled]) => {
                if (enabled) routes.push(`${method.toUpperCase()} ${path}`);
            });
        } else if (layer.handle?.stack) {
            routes.push(...collectRoutes(layer.handle.stack, `${prefix}${layer.path || ''}`));
        }
    }
    return routes;
};

describe('admin authorization policy coverage', () => {
    test('every admin-gated route has a matching authorization policy', () => {
        const uncovered = [];
        let checked = 0;

        for (const [prefix, modulePath] of ADMIN_MOUNTS) {
            // eslint-disable-next-line global-require, import/no-dynamic-require
            const router = require(modulePath);
            const routes = collectRoutes(router.stack, prefix);
            for (const route of routes) {
                checked += 1;
                const [method, ...pathParts] = route.split(' ');
                const path = pathParts.join(' ');
                if (!resolveAuthorizationPolicy({ method, path })) {
                    uncovered.push(route);
                }
            }
        }

        expect(checked).toBeGreaterThan(50);
        expect(uncovered).toEqual([]);
    });
});
