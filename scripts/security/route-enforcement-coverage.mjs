import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const strict = process.argv.includes('--strict');
const docPath = path.join(repoRoot, 'docs', 'security', 'route-enforcement-coverage.md');
const reportDir = path.join(repoRoot, 'reports', 'security');
const reportJsonPath = path.join(reportDir, 'route-enforcement-coverage.json');
const reportMarkdownPath = path.join(reportDir, 'route-enforcement-coverage.md');

const routeMounts = [
    ['server/routes/adminAnalyticsRoutes.js', '/api/admin/analytics'],
    ['server/routes/adminCatalogRoutes.js', '/api/admin/catalog'],
    ['server/routes/adminEmailOpsRoutes.js', '/api/admin/email-ops'],
    ['server/routes/adminEmergencyControlRoutes.js', '/api/admin/emergency-controls'],
    ['server/routes/adminFraudRoutes.js', '/api/admin/fraud'],
    ['server/routes/adminNotificationRoutes.js', '/api/admin/notifications'],
    ['server/routes/adminOpsRoutes.js', '/api/admin/ops'],
    ['server/routes/adminOrderEmailRoutes.js', '/api/admin/order-emails'],
    ['server/routes/adminPaymentRoutes.js', '/api/admin/payments'],
    ['server/routes/adminProductRoutes.js', '/api/admin/products'],
    ['server/routes/adminStatusRoutes.js', '/api/admin/status'],
    ['server/routes/adminUserRoutes.js', '/api/admin/users'],
    ['server/routes/aiRoutes.js', '/api/ai'],
    ['server/routes/authRoutes.js', '/api/auth'],
    ['server/routes/otpRoutes.js', '/api/auth/otp'],
    ['server/routes/listingRoutes.js', '/api/listings'],
    ['server/routes/orderRoutes.js', '/api/orders'],
    ['server/routes/paymentRoutes.js', '/api/payments'],
    ['server/routes/productRoutes.js', '/api/products'],
    ['server/routes/supportRoutes.js', '/api/support'],
    ['server/routes/uploadRoutes.js', '/api/uploads'],
];

const coverage = [
    ['GET', '/api/admin/analytics/export', 'DATA_EXPORT', ['sensitiveActions.dataExport']],
    ['POST', '/api/admin/catalog/onboarding/validate', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminCatalogChange']],
    ['POST', '/api/admin/catalog/imports', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminCatalogChange']],
    ['POST', '/api/admin/catalog/imports/:jobId/publish', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminCatalogChange']],
    ['POST', '/api/admin/catalog/sync/run', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminCatalogChange']],
    ['POST', '/api/admin/email-ops/order-queue/:notificationId/retry', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminEmailOperation']],
    ['POST', '/api/admin/email-ops/test-send', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminEmailOperation']],
    ['POST', '/api/admin/emergency-controls/:key/activate', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/emergency-controls/:key/deactivate', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/emergency-controls/:key/extend', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['PATCH', '/api/admin/emergency-controls/:key/message', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['PATCH', '/api/admin/fraud/:decisionId/resolve', 'MODERATION_ACTION', ['sensitiveActions.adminFraudModeration']],
    ['PATCH', '/api/admin/notifications/read-all', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminNotificationChange']],
    ['PATCH', '/api/admin/notifications/:notificationId/read', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminNotificationChange']],
    ['POST', '/api/admin/ops/smoke', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/ops/maintenance', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/order-emails/:notificationId/retry', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminEmailOperation']],
    ['POST', '/api/admin/payments/ops/expire-stale', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['PATCH', '/api/admin/payments/refunds/ledger/:orderId/:requestId/reference', 'PAYMENT_REFUND', ['sensitiveActions.paymentRefund']],
    ['POST', '/api/admin/payments/:intentId/capture', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['POST', '/api/admin/payments/:intentId/retry-capture', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['POST', '/api/admin/products', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminProductChange']],
    ['PATCH', '/api/admin/products/:id/core', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminProductChange']],
    ['PATCH', '/api/admin/products/:id/pricing', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminProductChange']],
    ['DELETE', '/api/admin/products/:id', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminProductChange']],
    ['POST', '/api/admin/status/components', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['PATCH', '/api/admin/status/components/:id', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/status/incidents', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['PATCH', '/api/admin/status/incidents/:id', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/status/incidents/:id/updates', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/status/incidents/:id/resolve', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/status/incidents/:id/postmortem', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/status/maintenance', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/status/monitor/run', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/status/seed', 'ADMIN_SECURITY_CONFIG_CHANGE', ['sensitiveActions.adminSecurityConfigChange']],
    ['POST', '/api/admin/users/:userId/warn', 'ADMIN_USER_MANAGEMENT', ['sensitiveActions.adminUserMutation']],
    ['POST', '/api/admin/users/:userId/suspend', 'ADMIN_USER_MANAGEMENT', ['sensitiveActions.adminUserMutation']],
    ['POST', '/api/admin/users/:userId/dismiss-warning', 'ADMIN_USER_MANAGEMENT', ['sensitiveActions.adminUserMutation']],
    ['POST', '/api/admin/users/:userId/reactivate', 'ADMIN_USER_MANAGEMENT', ['sensitiveActions.adminUserMutation']],
    ['POST', '/api/admin/users/:userId/delete', 'ADMIN_USER_MANAGEMENT', ['sensitiveActions.adminUserMutation']],
    ['POST', '/api/auth/recovery-codes', 'ACCOUNT_RECOVERY_CHANGE', ['sensitiveActions.accountRecoveryChange']],
    ['POST', '/api/auth/mfa/totp/setup', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['GET', '/api/auth/mfa/totp/qr', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['POST', '/api/auth/mfa/totp/verify-setup', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['POST', '/api/auth/mfa/passkey/register/options', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['POST', '/api/auth/mfa/passkey/register/verify', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['POST', '/api/auth/complete-phone-factor-login', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['POST', '/api/auth/complete-phone-factor-verification', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['POST', '/api/auth/verify-device', 'PASSWORD_OR_AUTH_FACTOR_CHANGE', ['sensitiveActions.authFactorChange']],
    ['POST', '/api/auth/otp/reset-password', 'ACCOUNT_RECOVERY_CHANGE', ['resetPasswordLimiter', 'requireTurnstile']],
    ['POST', '/api/ai/chat', 'AI_TOOL_ACTION', ['requireAiToolActionPolicy']],
    ['POST', '/api/ai/chat/stream', 'AI_TOOL_ACTION', ['requireAiToolActionPolicy']],
    ['POST', '/api/ai/sessions', 'AI_TOOL_ACTION', ['sensitiveActions.aiSessionMutation']],
    ['POST', '/api/ai/sessions/:sessionId/reset', 'AI_TOOL_ACTION', ['sensitiveActions.aiSessionMutation']],
    ['POST', '/api/ai/sessions/:sessionId/archive', 'AI_TOOL_ACTION', ['sensitiveActions.aiSessionMutation']],
    ['POST', '/api/listings', 'UPLOAD_WRITE', ['sensitiveActions.listingWrite']],
    ['PUT', '/api/listings/:id', 'UPLOAD_WRITE', ['authorizeListingOwner', 'sensitiveActions.listingWrite']],
    ['PATCH', '/api/listings/:id/sold', 'UPLOAD_WRITE', ['authorizeListingOwner', 'sensitiveActions.listingWrite']],
    ['DELETE', '/api/listings/:id', 'UPLOAD_WRITE', ['authorizeListingOwner', 'sensitiveActions.listingWrite']],
    ['POST', '/api/listings/:id/escrow/intents', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.listingEscrowChange']],
    ['POST', '/api/listings/:id/escrow/intents/:intentId/confirm', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.listingEscrowChange']],
    ['PATCH', '/api/listings/:id/escrow/start', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.listingEscrowChange']],
    ['PATCH', '/api/listings/:id/escrow/confirm', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.listingEscrowChange']],
    ['PATCH', '/api/listings/:id/escrow/cancel', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.listingEscrowChange']],
    ['POST', '/api/orders', 'ORDER_STATUS_CHANGE', ['sensitiveActions.orderStatusChange']],
    ['GET', '/api/orders/:id/timeline', 'ZERO_TRUST_READ', ['authorizeOrderOwner']],
    ['GET', '/api/orders/:id/command-center', 'ZERO_TRUST_READ', ['authorizeOrderOwner']],
    ['POST', '/api/orders/:id/command-center/refund', 'PAYMENT_REFUND', ['authorizeOrderOwner', 'sensitiveActions.paymentRefund']],
    ['POST', '/api/orders/:id/command-center/replace', 'ORDER_STATUS_CHANGE', ['authorizeOrderOwner', 'sensitiveActions.orderStatusChange']],
    ['POST', '/api/orders/:id/command-center/support', 'ORDER_STATUS_CHANGE', ['authorizeOrderOwner', 'sensitiveActions.orderStatusChange']],
    ['POST', '/api/orders/:id/command-center/warranty', 'ORDER_STATUS_CHANGE', ['authorizeOrderOwner', 'sensitiveActions.orderStatusChange']],
    ['PATCH', '/api/orders/:id/command-center/refund/:requestId/admin', 'PAYMENT_REFUND', ['sensitiveActions.paymentRefund']],
    ['PATCH', '/api/orders/:id/command-center/replace/:requestId/admin', 'ORDER_STATUS_CHANGE', ['sensitiveActions.orderStatusChange']],
    ['POST', '/api/orders/:id/command-center/support/admin-reply', 'ORDER_STATUS_CHANGE', ['sensitiveActions.orderStatusChange']],
    ['PATCH', '/api/orders/:id/command-center/warranty/:claimId/admin', 'ORDER_STATUS_CHANGE', ['sensitiveActions.orderStatusChange']],
    ['POST', '/api/orders/:id/cancel', 'ORDER_STATUS_CHANGE', ['authorizeOrderOwner', 'sensitiveActions.orderStatusChange']],
    ['POST', '/api/orders/:id/admin-cancel', 'ORDER_STATUS_CHANGE', ['sensitiveActions.orderStatusChange']],
    ['PATCH', '/api/orders/:id/status', 'ORDER_STATUS_CHANGE', ['sensitiveActions.orderStatusChange']],
    ['POST', '/api/payments/webhooks/razorpay', 'PAYMENT_WEBHOOK_REPLAY_RISK', ['recordPaymentWebhookSecurityAudit']],
    ['POST', '/api/payments/webhooks/stripe', 'PAYMENT_WEBHOOK_REPLAY_RISK', ['recordPaymentWebhookSecurityAudit']],
    ['POST', '/api/payments/intents', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['POST', '/api/payments/intents/:intentId/challenge/complete', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['POST', '/api/payments/intents/:intentId/confirm', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['POST', '/api/payments/intents/:intentId/refunds', 'PAYMENT_REFUND', ['sensitiveActions.paymentRefund']],
    ['POST', '/api/payments/methods/setup-intent', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['POST', '/api/payments/methods', 'PAYMENT_PAYOUT_CHANGE', ['sensitiveActions.paymentPayoutChange']],
    ['PATCH', '/api/payments/methods/:methodId/default', 'PAYMENT_PAYOUT_CHANGE', ['authorizePaymentMethodOwner', 'sensitiveActions.paymentPayoutChange']],
    ['DELETE', '/api/payments/methods/:methodId', 'PAYMENT_PAYOUT_CHANGE', ['authorizePaymentMethodOwner', 'sensitiveActions.paymentPayoutChange']],
    ['POST', '/api/products', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminProductChange']],
    ['POST', '/api/products/:id/reviews', 'MODERATION_ACTION', ['sensitiveActions.moderationAction']],
    ['PUT', '/api/products/:id', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminProductChange']],
    ['DELETE', '/api/products/:id', 'ADMIN_STATE_CHANGE', ['sensitiveActions.adminProductChange']],
    ['PATCH', '/api/support/:id/status', 'MODERATION_ACTION', ['sensitiveActions.supportModeration']],
    ['POST', '/api/support/:id/video/start', 'MODERATION_ACTION', ['sensitiveActions.supportModeration']],
    ['POST', '/api/uploads/reviews/sign', 'UPLOAD_WRITE', ['sensitiveActions.uploadWrite']],
    ['POST', '/api/uploads/reviews/upload', 'UPLOAD_WRITE', ['sensitiveActions.uploadWrite']],
].map(([method, routePath, category, guards]) => ({
    method,
    path: routePath,
    category,
    guards,
    key: `${method} ${routePath}`,
}));

const coverageByKey = new Map(coverage.map((entry) => [entry.key, entry]));

const exclusions = new Map([
    ['POST /api/auth/bootstrap-device-challenge', 'Unauthenticated bootstrap proof request; covered by Turnstile and security-critical rate limiter.'],
    ['POST /api/auth/recovery-codes/verify', 'Unauthenticated recovery proof verification; covered by Turnstile, recovery limiter, and recovery-code verifier.'],
    ['POST /api/auth/logout', 'Session cleanup route; protected by session mutation limiter and CSRF for cookie sessions.'],
    ['POST /api/auth/exchange', 'Session establishment endpoint; protected by token verification and CSRF token generation.'],
    ['POST /api/auth/sync', 'Session sync endpoint; protected by token verification, CSRF, and auth sync limiter.'],
    ['POST /api/auth/desktop-handoff/custom-token', 'Desktop handoff token endpoint; protected by auth and security-critical handoff limiter.'],
    ['POST /api/orders/quote', 'Order quote calculation route; protected by auth and OTP, but it does not persist order/payment state.'],
    ['POST /api/ai/voice/session', 'Voice session creation is abuse-limited and does not execute tool mutations.'],
    ['POST /api/ai/voice/speak', 'Voice synthesis is abuse-limited and does not execute tool mutations.'],
    ['POST /api/listings/:id/messages', 'Marketplace messaging write; controller enforces participant access and chat length limits.'],
    ['POST /api/listings/:id/video/start', 'Live inspection setup; controller enforces buyer/seller participation.'],
    ['POST /api/listings/:id/video/join', 'Live inspection join; controller enforces buyer/seller participation.'],
    ['POST /api/listings/:id/video/connected', 'Live inspection status event; controller enforces buyer/seller participation.'],
    ['POST /api/listings/:id/video/end', 'Live inspection end event; controller enforces buyer/seller participation.'],
    ['POST /api/products/recommendations', 'Personalized recommendation read-like POST; no state mutation.'],
    ['POST /api/products/visual-search', 'Search request with upload validation, not a persistent write route.'],
    ['POST /api/products/bundles/build', 'Bundle calculation route; no persistent mutation.'],
    ['POST /api/products/telemetry/search-click', 'Telemetry event route outside sensitive action scope.'],
    ['POST /api/support', 'Support ticket creation; authenticated user workflow, not admin/moderation state.'],
    ['POST /api/support/:id/messages', 'Support thread message; controller checks ticket access.'],
    ['POST /api/support/:id/video/request', 'User live-call request; controller checks ticket access.'],
    ['POST /api/support/:id/video/join', 'Support live-call join; controller checks ticket access.'],
    ['POST /api/support/:id/video/connected', 'Support live-call status event; controller checks ticket access.'],
    ['POST /api/support/:id/video/end', 'Support live-call end event; controller checks ticket access.'],
]);

const joinExpressPaths = (base, routePath) => {
    const cleanBase = String(base || '').replace(/\/+$/, '');
    const cleanRoute = String(routePath || '').replace(/^\/+/, '');
    if (!cleanRoute || cleanRoute === '/') return cleanBase || '/';
    return `${cleanBase}/${cleanRoute}`.replace(/\/+/g, '/');
};

const discoverRoutesFromSource = (relativeFile, mountPath) => {
    const absoluteFile = path.join(repoRoot, relativeFile);
    const source = fs.readFileSync(absoluteFile, 'utf8');
    const routes = [];
    const directRegex = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
    const chainRegex = /router\.route\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?);/g;

    for (const match of source.matchAll(directRegex)) {
        routes.push({
            method: match[1].toUpperCase(),
            path: joinExpressPaths(mountPath, match[2]),
            file: relativeFile,
        });
    }

    for (const match of source.matchAll(chainRegex)) {
        const routePath = joinExpressPaths(mountPath, match[1]);
        const chain = match[2] || '';
        for (const methodMatch of chain.matchAll(/\.(get|post|put|patch|delete)\s*\(/gi)) {
            routes.push({
                method: methodMatch[1].toUpperCase(),
                path: routePath,
                file: relativeFile,
            });
        }
    }

    return routes;
};

const isDangerousDiscoveredRoute = ({ method, path: routePath }) => {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (routePath === '/api/admin/analytics/export') return true;
    if (routePath.startsWith('/api/admin/') && mutating) return true;
    if (routePath.startsWith('/api/payments/webhooks/')) return mutating;
    if (routePath.startsWith('/api/payments/intents') && mutating) return true;
    if (routePath.startsWith('/api/payments/methods') && mutating) return true;
    if (routePath.startsWith('/api/orders/') && mutating) return true;
    if (routePath === '/api/orders' && mutating) return true;
    if (routePath.startsWith('/api/uploads/') && mutating) return true;
    if (routePath.startsWith('/api/auth/recovery') && mutating) return true;
    if (routePath === '/api/auth/mfa/totp/qr') return true;
    if ([
        '/api/auth/mfa/totp/setup',
        '/api/auth/mfa/totp/verify-setup',
        '/api/auth/mfa/passkey/register/options',
        '/api/auth/mfa/passkey/register/verify',
    ].includes(routePath) && mutating) return true;
    if (routePath.startsWith('/api/auth/complete-phone-factor') && mutating) return true;
    if (routePath === '/api/auth/verify-device' && mutating) return true;
    if (routePath === '/api/auth/otp/reset-password' && mutating) return true;
    if (routePath.startsWith('/api/ai/') && mutating) return true;
    if (routePath === '/api/listings' && mutating) return true;
    if (/^\/api\/listings\/:id(\/sold|\/escrow\/|$)/.test(routePath) && mutating) return true;
    if (routePath === '/api/products' && mutating) return true;
    if (/^\/api\/products\/:id(\/reviews)?$/.test(routePath) && mutating) return true;
    if (/^\/api\/support\/:id\/(status|video\/start)$/.test(routePath) && mutating) return true;
    return false;
};

const discoveredRoutes = routeMounts.flatMap(([relativeFile, mountPath]) => discoverRoutesFromSource(relativeFile, mountPath));
const dangerousDiscovered = discoveredRoutes
    .filter(isDangerousDiscoveredRoute)
    .map((route) => ({ ...route, key: `${route.method} ${route.path}` }));

const securitySource = [
    'server/routes',
    'server/controllers',
    'server/middleware',
].flatMap((relativeDir) => {
    const absoluteDir = path.join(repoRoot, relativeDir);
    return fs.readdirSync(absoluteDir)
        .filter((fileName) => fileName.endsWith('.js'))
        .map((fileName) => fs.readFileSync(path.join(absoluteDir, fileName), 'utf8'));
}).join('\n');

const routeIssues = dangerousDiscovered
    .filter((route) => !coverageByKey.has(route.key) && !exclusions.has(route.key));

const codeIssues = coverage.flatMap((entry) => {
    const route = discoveredRoutes
        .map((candidate) => ({ ...candidate, key: `${candidate.method} ${candidate.path}` }))
        .find((candidate) => candidate.key === entry.key);
    if (!route) {
        return [{ key: entry.key, issue: 'route_not_discovered' }];
    }
    const source = fs.readFileSync(path.join(repoRoot, route.file), 'utf8');
    return entry.guards
        .filter((guard) => !source.includes(guard) && !securitySource.includes(guard))
        .map((guard) => ({ key: entry.key, issue: `missing_guard:${guard}`, file: route.file }));
});

const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
const docIssues = strict
    ? coverage
        .filter((entry) => !doc.includes(entry.key) || !doc.includes(entry.category))
        .map((entry) => ({ key: entry.key, issue: 'missing_doc_matrix_entry' }))
    : [];

const report = {
    generatedAt: new Date().toISOString(),
    strict,
    coverageCount: coverage.length,
    discoveredDangerousCount: dangerousDiscovered.length,
    coveredRoutes: coverage.map(({ method, path: routePath, category, guards }) => ({
        method,
        path: routePath,
        category,
        guards,
    })),
    exclusions: [...exclusions.entries()].map(([key, reason]) => ({ key, reason })),
    issues: [
        ...routeIssues.map((route) => ({ key: route.key, issue: 'dangerous_route_missing_from_matrix', file: route.file })),
        ...codeIssues,
        ...docIssues,
    ],
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
fs.writeFileSync(reportMarkdownPath, [
    '# Route Enforcement Coverage Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Strict mode: ${strict ? 'yes' : 'no'}`,
    `Covered routes: ${report.coverageCount}`,
    `Dangerous discovered routes: ${report.discoveredDangerousCount}`,
    `Issues: ${report.issues.length}`,
    '',
    '| Route | Category | Guards |',
    '| --- | --- | --- |',
    ...coverage.map((entry) => `| ${entry.key} | ${entry.category} | ${entry.guards.join(', ')} |`),
    '',
].join('\n'));

if (report.issues.length > 0) {
    console.error(`Route enforcement coverage failed with ${report.issues.length} issue(s).`);
    for (const issue of report.issues) {
        console.error(`- ${issue.key}: ${issue.issue}${issue.file ? ` (${issue.file})` : ''}`);
    }
    process.exit(1);
}

console.log(`Route enforcement coverage passed for ${coverage.length} route entries.`);
console.log(`Wrote ${path.relative(repoRoot, reportJsonPath)} and ${path.relative(repoRoot, reportMarkdownPath)}.`);
