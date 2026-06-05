const path = require('path');

const ROUTE_CLASSIFICATIONS = Object.freeze({
    PUBLIC: 'public',
    AUTHENTICATED: 'authenticated',
    ADMIN: 'admin',
    INTERNAL: 'internal',
    WEBHOOK: 'webhook',
    HEALTH: 'health',
    HONEYPOT: 'honeypot',
    DISABLED: 'disabled',
});

const routeMounts = Object.freeze([
    ['server/routes/healthRoutes.js', '/api/health'],
    ['server/routes/emergencyRoutes.js', '/api/emergency'],
    ['server/routes/productRoutes.js', '/api/products'],
    ['server/routes/recommendationRoutes.js', '/api/recommendations'],
    ['server/routes/recommendationEventRoutes.js', '/api/recommendation-events'],
    ['server/routes/authRoutes.js', '/api/auth'],
    ['server/routes/securityRoutes.js', '/api/security'],
    ['server/routes/userRoutes.js', '/api/users'],
    ['server/routes/cartRoutes.js', '/api/cart'],
    ['server/routes/orderRoutes.js', '/api/orders'],
    ['server/routes/checkoutRoutes.js', '/api/checkout'],
    ['server/routes/aiRoutes.js', '/api/ai'],
    ['server/routes/otpRoutes.js', '/api/otp'],
    ['server/routes/listingRoutes.js', '/api/listings'],
    ['server/routes/tradeInRoutes.js', '/api/trade-in'],
    ['server/routes/priceAlertRoutes.js', '/api/price-alerts'],
    ['server/routes/paymentRoutes.js', '/api/payments'],
    ['server/routes/i18nRoutes.js', '/api/i18n'],
    ['server/routes/marketRoutes.js', '/api/markets'],
    ['server/routes/statusRoutes.js', '/api/status'],
    ['server/routes/adminEmergencyControlRoutes.js', '/api/admin/emergency-controls'],
    ['server/routes/adminPaymentRoutes.js', '/api/admin/payments'],
    ['server/routes/adminOrderEmailRoutes.js', '/api/admin/order-emails'],
    ['server/routes/adminEmailOpsRoutes.js', '/api/admin/email-ops'],
    ['server/routes/adminNotificationRoutes.js', '/api/admin/notifications'],
    ['server/routes/adminAnalyticsRoutes.js', '/api/admin/analytics'],
    ['server/routes/adminCatalogRoutes.js', '/api/admin/catalog'],
    ['server/routes/adminUserRoutes.js', '/api/admin/users'],
    ['server/routes/adminProductRoutes.js', '/api/admin/products'],
    ['server/routes/adminOpsRoutes.js', '/api/admin/ops'],
    ['server/routes/adminFraudRoutes.js', '/api/admin/fraud'],
    ['server/routes/adminAbuseRoutes.js', '/api/admin/abuse'],
    ['server/routes/adminStatusRoutes.js', '/api/admin/status'],
    ['server/routes/internalOpsRoutes.js', '/api/internal'],
    ['server/routes/observabilityRoutes.js', '/api/observability'],
    ['server/routes/emailWebhookRoutes.js', '/api/email-webhooks'],
    ['server/routes/uploadRoutes.js', '/api/uploads'],
    ['server/routes/intelligenceRoutes.js', '/api/intelligence'],
    ['server/routes/supportRoutes.js', '/api/support'],
    ['server/routes/userNotificationRoutes.js', '/api/notifications'],
]);

const extraRoutes = Object.freeze([
    { method: 'GET', path: '/health/live', file: 'server/index.js' },
    { method: 'GET', path: '/health', file: 'server/index.js' },
    { method: 'GET', path: '/health/ready', file: 'server/index.js' },
    { method: 'GET', path: '/metrics', file: 'server/index.js' },
    { method: 'GET', path: '/uploads/:path', file: 'server/index.js' },
    { method: 'GET', path: '/.env', file: 'server/middleware/invisibleFabricMiddleware.js' },
    { method: 'GET', path: '/.git/config', file: 'server/middleware/invisibleFabricMiddleware.js' },
    { method: 'GET', path: '/wp-admin', file: 'server/middleware/invisibleFabricMiddleware.js' },
    { method: 'GET', path: '/admin-old', file: 'server/middleware/invisibleFabricMiddleware.js' },
    { method: 'GET', path: '/debug', file: 'server/middleware/invisibleFabricMiddleware.js' },
    { method: 'GET', path: '/server-status', file: 'server/middleware/invisibleFabricMiddleware.js' },
    { method: 'GET', path: '/phpmyadmin', file: 'server/middleware/invisibleFabricMiddleware.js' },
]);

const routeExposureRules = Object.freeze([
    {
        pattern: /^\/(?:\.env|\.git\/config|wp-admin|admin-old|debug|server-status|phpmyadmin)$/i,
        classification: ROUTE_CLASSIFICATIONS.HONEYPOT,
        publiclyDiscoverable: false,
        notes: 'Defensive honeypot path; returns generic response and audit event.',
    },
    {
        pattern: /^\/health(?:\/|$)|^\/api\/health(?:\/|$)/i,
        classification: ROUTE_CLASSIFICATIONS.HEALTH,
        publiclyDiscoverable: true,
        notes: 'Health route; detailed readiness is separately token-gated.',
    },
    {
        pattern: /^\/api\/payments\/webhooks(?:\/|$)|^\/api\/email-webhooks(?:\/|$)|^\/api\/status\/webhooks(?:\/|$)/i,
        classification: ROUTE_CLASSIFICATIONS.WEBHOOK,
        authRequired: false,
        signatureVerificationRequired: true,
        rateLimitRequired: true,
        publiclyDiscoverable: false,
        notes: 'Provider webhook; public ingress but signature or token verification is required.',
    },
    {
        pattern: /^\/api\/admin(?:\/|$)/i,
        classification: ROUTE_CLASSIFICATIONS.ADMIN,
        authRequired: true,
        adminRequired: true,
        mfaRequired: true,
        csrfRequired: true,
        replayGuardRequired: true,
        rateLimitRequired: true,
        resourceAuthorizationRequired: true,
        publiclyDiscoverable: false,
        notes: 'Admin control-plane route protected by protect/admin and sensitive action policies.',
    },
    {
        pattern: /^\/api\/(?:internal|observability)(?:\/|$)|^\/metrics$/i,
        classification: ROUTE_CLASSIFICATIONS.INTERNAL,
        authRequired: true,
        rateLimitRequired: true,
        publiclyDiscoverable: false,
        notes: 'Internal or observability route; public anonymous discovery is cloaked when fabric is enabled.',
    },
    {
        pattern: /^\/uploads(?:\/|$)/i,
        classification: ROUTE_CLASSIFICATIONS.PUBLIC,
        rateLimitRequired: true,
        publiclyDiscoverable: true,
        notes: 'Public review media asset serving with static asset limiter.',
    },
    {
        pattern: /^\/api\/(?:products|recommendations|i18n|markets|status|emergency)(?:\/|$)/i,
        methods: ['GET', 'HEAD', 'OPTIONS'],
        classification: ROUTE_CLASSIFICATIONS.PUBLIC,
        rateLimitRequired: false,
        publiclyDiscoverable: true,
        notes: 'Public product, market, status, emergency, or localization read route.',
    },
    {
        pattern: /^\/api\/(?:recommendations|recommendation-events)(?:\/|$)/i,
        methods: ['POST'],
        classification: ROUTE_CLASSIFICATIONS.PUBLIC,
        rateLimitRequired: true,
        publiclyDiscoverable: true,
        notes: 'Read-like recommendation/telemetry POST route; no privileged resource exposure.',
    },
    {
        pattern: /^\/api\/(?:auth|otp)(?:\/|$)/i,
        classification: ROUTE_CLASSIFICATIONS.PUBLIC,
        rateLimitRequired: true,
        publiclyDiscoverable: true,
        notes: 'Authentication bootstrap route; individual sensitive auth endpoints carry additional middleware.',
    },
    {
        pattern: /^\/api\/(?:cart|orders|checkout|users|security|ai|listings|trade-in|price-alerts|payments|uploads|intelligence|support|notifications)(?:\/|$)/i,
        classification: ROUTE_CLASSIFICATIONS.AUTHENTICATED,
        authRequired: true,
        csrfRequired: true,
        rateLimitRequired: true,
        resourceAuthorizationRequired: true,
        publiclyDiscoverable: false,
        notes: 'Authenticated product workflow route; sensitive mutations are covered by routeSecurityGuards.',
    },
    {
        pattern: /^\/api\//i,
        classification: ROUTE_CLASSIFICATIONS.AUTHENTICATED,
        authRequired: true,
        rateLimitRequired: true,
        publiclyDiscoverable: false,
        notes: 'Fallback API route classification; add an explicit rule for new public surfaces.',
    },
]);

const joinExpressPaths = (base, routePath) => {
    const cleanBase = String(base || '').replace(/\/+$/, '');
    const cleanRoute = String(routePath || '').replace(/^\/+/, '');
    if (!cleanRoute || cleanRoute === '/') return cleanBase || '/';
    return `${cleanBase}/${cleanRoute}`.replace(/\/+/g, '/');
};

const routeKey = ({ method = '', path: routePath = '' } = {}) => (
    `${String(method || '').toUpperCase()} ${String(routePath || '').trim() || '/'}`
);

const methodApplies = (rule = {}, method = '') => (
    !Array.isArray(rule.methods)
    || rule.methods.map((entry) => String(entry).toUpperCase()).includes(String(method || '').toUpperCase())
);

const classifyRoute = (route = {}) => {
    const routePath = String(route.path || '').trim() || '/';
    const method = String(route.method || 'GET').toUpperCase();
    const rule = routeExposureRules.find((candidate) => (
        methodApplies(candidate, method)
        && candidate.pattern.test(routePath)
    ));
    if (!rule) return null;

    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const classification = rule.classification;
    return {
        route: routePath,
        method,
        classification,
        authRequired: Boolean(rule.authRequired),
        adminRequired: Boolean(rule.adminRequired),
        mfaRequired: Boolean(rule.mfaRequired),
        csrfRequired: Boolean(rule.csrfRequired && mutating),
        replayGuardRequired: Boolean(rule.replayGuardRequired && mutating),
        rateLimitRequired: Boolean(rule.rateLimitRequired || mutating || classification === ROUTE_CLASSIFICATIONS.WEBHOOK),
        resourceAuthorizationRequired: Boolean(rule.resourceAuthorizationRequired && (mutating || classification === ROUTE_CLASSIFICATIONS.ADMIN)),
        publiclyDiscoverable: Boolean(rule.publiclyDiscoverable),
        signatureVerificationRequired: Boolean(rule.signatureVerificationRequired),
        notes: rule.notes || '',
        file: route.file ? path.normalize(route.file).replace(/\\/g, '/') : '',
    };
};

module.exports = {
    ROUTE_CLASSIFICATIONS,
    classifyRoute,
    extraRoutes,
    joinExpressPaths,
    routeExposureRules,
    routeKey,
    routeMounts,
};
