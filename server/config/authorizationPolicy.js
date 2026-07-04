const ADMIN_ROUTE_POLICIES = [
    ['GET', '/api/admin/notifications/summary', 'admin.notifications.read'],
    ['GET', '/api/admin/notifications', 'admin.notifications.read'],
    ['PATCH', '/api/admin/notifications/read-all', 'admin.notifications.write'],
    ['GET', '/api/admin/analytics/overview', 'admin.analytics.read'],
    ['GET', '/api/admin/analytics/timeseries', 'admin.analytics.read'],
    ['GET', '/api/admin/analytics/anomalies', 'admin.analytics.read'],
    ['GET', '/api/admin/analytics/export', 'admin.analytics.export'],
    ['POST', '/api/admin/catalog/imports', 'admin.catalog.write'],
    ['POST', '/api/admin/catalog/sync/run', 'admin.catalog.write'],
    ['GET', '/api/admin/email-ops/summary', 'admin.email.read'],
    ['POST', '/api/admin/email-ops/test-send', 'admin.email.test'],
    ['GET', '/api/admin/users', 'admin.users.read'],
    ['GET', '/api/admin/users/:userId', 'admin.users.read'],
    ['POST', '/api/admin/users/:userId/warn', 'admin.users.moderate'],
    ['POST', '/api/admin/users/:userId/suspend', 'admin.users.moderate'],
    ['POST', '/api/admin/users/:userId/reactivate', 'admin.users.moderate'],
    ['POST', '/api/admin/users/:userId/delete', 'admin.users.delete'],
    ['GET', '/api/admin/products', 'admin.products.read'],
    ['POST', '/api/admin/products', 'admin.products.write'],
    ['PATCH', '/api/admin/products/:id/core', 'admin.products.write'],
    ['PATCH', '/api/admin/products/:id/pricing', 'admin.products.write'],
    ['DELETE', '/api/admin/products/:id', 'admin.products.delete'],
    ['GET', '/api/admin/payments', 'admin.payments.read'],
    ['POST', '/api/admin/payments/ops/expire-stale', 'admin.payments.expire_stale'],
    ['PATCH', '/api/admin/payments/refunds/ledger/:orderId/:requestId/reference', 'admin.payments.refunds.write'],
    ['POST', '/api/admin/payments/:id/capture', 'admin.payments.capture'],
    ['POST', '/api/admin/payments/:id/retry-capture', 'admin.payments.capture'],
    ['GET', '/api/admin/ops/readiness', 'admin.ops.read'],
    ['GET', '/api/admin/ops/aws-control', 'admin.ops.read'],
    ['POST', '/api/admin/ops/smoke', 'admin.ops.smoke'],
    ['POST', '/api/admin/ops/maintenance', 'admin.ops.maintenance'],
    ['POST', '/api/admin/ops/aws-control/actions', 'admin.ops.aws_control'],
].map(([method, path, permission]) => ({
    method,
    path,
    permission,
    role: 'admin',
    assurance: 'passkey_or_second_factor',
    middleware: ['protect', 'admin'],
}));

const SENSITIVE_USER_ROUTE_POLICIES = [
    ['GET', '/api/auth/session', 'auth.session.read', 'authenticated'],
    ['POST', '/api/auth/sync', 'auth.session.sync', 'authenticated'],
    ['POST', '/api/auth/recovery-codes', 'auth.recovery_codes.issue', 'passkey'],
    ['POST', '/api/auth/verify-device', 'auth.trusted_device.verify', 'authenticated'],
    ['PATCH', '/api/users/profile', 'user.profile.write', 'authenticated'],
    ['DELETE', '/api/users/account', 'user.account.delete', 'fresh_session'],
].map(([method, path, permission, assurance]) => ({
    method,
    path,
    permission,
    role: 'user',
    assurance,
    middleware: ['protect'],
}));

const AUTHORIZATION_POLICY = [
    ...ADMIN_ROUTE_POLICIES,
    ...SENSITIVE_USER_ROUTE_POLICIES,
];

const listAuthorizationPolicy = () => AUTHORIZATION_POLICY.map((entry) => ({ ...entry }));

module.exports = {
    ADMIN_ROUTE_POLICIES,
    AUTHORIZATION_POLICY,
    SENSITIVE_USER_ROUTE_POLICIES,
    listAuthorizationPolicy,
};
