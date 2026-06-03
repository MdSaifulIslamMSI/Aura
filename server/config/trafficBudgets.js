const { trafficResiliencePolicy } = require('./trafficResiliencePolicy');

const ROUTE_CLASSES = Object.freeze({
    STATIC_PUBLIC: 'STATIC_PUBLIC',
    PUBLIC_READ: 'PUBLIC_READ',
    PUBLIC_SEARCH: 'PUBLIC_SEARCH',
    AUTH_LOGIN: 'AUTH_LOGIN',
    OTP: 'OTP',
    AUTHENTICATED_READ: 'AUTHENTICATED_READ',
    AUTHENTICATED_WRITE: 'AUTHENTICATED_WRITE',
    UPLOAD: 'UPLOAD',
    AI_EXPENSIVE: 'AI_EXPENSIVE',
    PAYMENT: 'PAYMENT',
    WEBHOOK: 'WEBHOOK',
    ADMIN_READ: 'ADMIN_READ',
    ADMIN_WRITE: 'ADMIN_WRITE',
    STATUS_PUBLIC: 'STATUS_PUBLIC',
    HEALTH: 'HEALTH',
});

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MB = 1024 * 1024;
const KB = 1024;

const category = (name) => trafficResiliencePolicy.categories[name] || trafficResiliencePolicy.defaults || {};

const defineBudget = ({
    routeClass,
    categoryName,
    maxBodyBytes,
    timeoutMs,
    perIp,
    perAccount,
    perSession,
    dbQueryCostBudget,
    challengeAllowed,
    canDegrade,
    emergencyFlag,
    description,
    cacheMode = 'no-store',
}) => {
    const policy = category(categoryName);
    return Object.freeze({
        routeClass,
        categoryName,
        maxBodyBytes,
        timeoutMs,
        perIp,
        perAccount,
        perSession,
        burst: policy.burst,
        sustained: policy.maxRequests,
        windowSeconds: policy.windowSeconds,
        productionFailMode: policy.productionFailMode,
        auditOnDeny: policy.auditOnDeny,
        userMessageCode: policy.userMessageCode,
        rolloutFlag: policy.rolloutFlag,
        costRisk: policy.costRisk,
        dbQueryCostBudget,
        challengeAllowed,
        canDegrade,
        emergencyFlag,
        description,
        cacheMode,
    });
};

const TRAFFIC_BUDGETS = Object.freeze({
    [ROUTE_CLASSES.STATIC_PUBLIC]: defineBudget({
        routeClass: ROUTE_CLASSES.STATIC_PUBLIC,
        categoryName: 'searchRequests',
        maxBodyBytes: 8 * KB,
        timeoutMs: 5000,
        perIp: 2400,
        perAccount: 0,
        perSession: 0,
        dbQueryCostBudget: 0,
        challengeAllowed: false,
        canDegrade: false,
        emergencyFlag: '',
        cacheMode: 'public-static',
        description: 'Immutable frontend/static assets and safe public files.',
    }),
    [ROUTE_CLASSES.PUBLIC_READ]: defineBudget({
        routeClass: ROUTE_CLASSES.PUBLIC_READ,
        categoryName: 'searchRequests',
        maxBodyBytes: 32 * KB,
        timeoutMs: 6000,
        perIp: 300,
        perAccount: 0,
        perSession: 0,
        dbQueryCostBudget: 3,
        challengeAllowed: true,
        canDegrade: true,
        emergencyFlag: 'ATTACK_MODE_PUBLIC_READ_ONLY',
        cacheMode: 'public-short',
        description: 'Public read APIs that should remain cheap and cacheable where safe.',
    }),
    [ROUTE_CLASSES.PUBLIC_SEARCH]: defineBudget({
        routeClass: ROUTE_CLASSES.PUBLIC_SEARCH,
        categoryName: 'searchRequests',
        maxBodyBytes: 96 * KB,
        timeoutMs: 4500,
        perIp: 120,
        perAccount: 0,
        perSession: 90,
        dbQueryCostBudget: 6,
        challengeAllowed: true,
        canDegrade: true,
        emergencyFlag: 'ATTACK_MODE_PUBLIC_READ_ONLY',
        cacheMode: 'public-short',
        description: 'Search/listing/catalog routes that can pressure MongoDB.',
    }),
    [ROUTE_CLASSES.AUTH_LOGIN]: defineBudget({
        routeClass: ROUTE_CLASSES.AUTH_LOGIN,
        categoryName: 'loginAttempts',
        maxBodyBytes: 64 * KB,
        timeoutMs: 7000,
        perIp: 40,
        perAccount: 20,
        perSession: 20,
        dbQueryCostBudget: 3,
        challengeAllowed: true,
        canDegrade: false,
        emergencyFlag: 'ATTACK_MODE_STRICT_AUTH',
        description: 'Login, session, recovery, and device challenge routes.',
    }),
    [ROUTE_CLASSES.OTP]: defineBudget({
        routeClass: ROUTE_CLASSES.OTP,
        categoryName: 'otpRequests',
        maxBodyBytes: 64 * KB,
        timeoutMs: 7000,
        perIp: 12,
        perAccount: 8,
        perSession: 8,
        dbQueryCostBudget: 2,
        challengeAllowed: true,
        canDegrade: false,
        emergencyFlag: 'DISABLE_OTP_SEND',
        description: 'OTP send, verify, account check, and reset routes.',
    }),
    [ROUTE_CLASSES.AUTHENTICATED_READ]: defineBudget({
        routeClass: ROUTE_CLASSES.AUTHENTICATED_READ,
        categoryName: 'searchRequests',
        maxBodyBytes: 96 * KB,
        timeoutMs: 8000,
        perIp: 240,
        perAccount: 300,
        perSession: 240,
        dbQueryCostBudget: 4,
        challengeAllowed: false,
        canDegrade: true,
        emergencyFlag: '',
        description: 'Authenticated read routes with bounded query cost.',
    }),
    [ROUTE_CLASSES.AUTHENTICATED_WRITE]: defineBudget({
        routeClass: ROUTE_CLASSES.AUTHENTICATED_WRITE,
        categoryName: 'orderMutations',
        maxBodyBytes: 256 * KB,
        timeoutMs: 10000,
        perIp: 120,
        perAccount: 120,
        perSession: 80,
        dbQueryCostBudget: 5,
        challengeAllowed: false,
        canDegrade: true,
        emergencyFlag: 'DISABLE_PUBLIC_API_MUTATIONS',
        description: 'Authenticated user writes that can shed during attack mode.',
    }),
    [ROUTE_CLASSES.UPLOAD]: defineBudget({
        routeClass: ROUTE_CLASSES.UPLOAD,
        categoryName: 'uploadWrites',
        maxBodyBytes: 9 * MB,
        timeoutMs: 20000,
        perIp: 20,
        perAccount: 20,
        perSession: 12,
        dbQueryCostBudget: 3,
        challengeAllowed: false,
        canDegrade: true,
        emergencyFlag: 'ATTACK_MODE_BLOCK_UPLOADS',
        description: 'Upload signing/media write paths and review upload assets.',
    }),
    [ROUTE_CLASSES.AI_EXPENSIVE]: defineBudget({
        routeClass: ROUTE_CLASSES.AI_EXPENSIVE,
        categoryName: 'aiRequests',
        maxBodyBytes: 9 * MB,
        timeoutMs: 25000,
        perIp: 30,
        perAccount: 50,
        perSession: 30,
        dbQueryCostBudget: 8,
        challengeAllowed: true,
        canDegrade: true,
        emergencyFlag: 'ATTACK_MODE_BLOCK_AI',
        description: 'AI chat, voice, visual search, and intelligence routes.',
    }),
    [ROUTE_CLASSES.PAYMENT]: defineBudget({
        routeClass: ROUTE_CLASSES.PAYMENT,
        categoryName: 'paymentIntents',
        maxBodyBytes: 128 * KB,
        timeoutMs: 12000,
        perIp: 60,
        perAccount: 80,
        perSession: 40,
        dbQueryCostBudget: 4,
        challengeAllowed: false,
        canDegrade: false,
        emergencyFlag: 'DISABLE_PAYMENT',
        description: 'Payment intent, payment method, refund, and checkout routes.',
    }),
    [ROUTE_CLASSES.WEBHOOK]: defineBudget({
        routeClass: ROUTE_CLASSES.WEBHOOK,
        categoryName: 'webhookEvents',
        maxBodyBytes: 256 * KB,
        timeoutMs: 8000,
        perIp: 300,
        perAccount: 0,
        perSession: 0,
        dbQueryCostBudget: 3,
        challengeAllowed: false,
        canDegrade: false,
        emergencyFlag: '',
        description: 'Provider webhook paths rely on signature and replay/idempotency checks.',
    }),
    [ROUTE_CLASSES.ADMIN_READ]: defineBudget({
        routeClass: ROUTE_CLASSES.ADMIN_READ,
        categoryName: 'adminSensitiveActions',
        maxBodyBytes: 96 * KB,
        timeoutMs: 10000,
        perIp: 80,
        perAccount: 120,
        perSession: 80,
        dbQueryCostBudget: 5,
        challengeAllowed: false,
        canDegrade: true,
        emergencyFlag: '',
        description: 'Admin read routes protected by admin auth.',
    }),
    [ROUTE_CLASSES.ADMIN_WRITE]: defineBudget({
        routeClass: ROUTE_CLASSES.ADMIN_WRITE,
        categoryName: 'adminSensitiveActions',
        maxBodyBytes: 128 * KB,
        timeoutMs: 10000,
        perIp: 40,
        perAccount: 40,
        perSession: 30,
        dbQueryCostBudget: 4,
        challengeAllowed: false,
        canDegrade: false,
        emergencyFlag: 'DISABLE_ADMIN_MUTATIONS',
        description: 'Admin mutations requiring sensitive-action controls.',
    }),
    [ROUTE_CLASSES.STATUS_PUBLIC]: defineBudget({
        routeClass: ROUTE_CLASSES.STATUS_PUBLIC,
        categoryName: 'searchRequests',
        maxBodyBytes: 16 * KB,
        timeoutMs: 3000,
        perIp: 600,
        perAccount: 0,
        perSession: 0,
        dbQueryCostBudget: 1,
        challengeAllowed: false,
        canDegrade: false,
        emergencyFlag: 'ATTACK_MODE_STATUS_CACHE_ONLY',
        cacheMode: 'status-public',
        description: 'Public status and lightweight readiness surfaces.',
    }),
    [ROUTE_CLASSES.HEALTH]: defineBudget({
        routeClass: ROUTE_CLASSES.HEALTH,
        categoryName: 'searchRequests',
        maxBodyBytes: 8 * KB,
        timeoutMs: 1500,
        perIp: 1200,
        perAccount: 0,
        perSession: 0,
        dbQueryCostBudget: 0,
        challengeAllowed: false,
        canDegrade: false,
        emergencyFlag: '',
        cacheMode: 'no-store',
        description: 'Minimal liveness/readiness endpoints.',
    }),
});

const normalizeRoutePath = (value = '/') => {
    const routePath = String(value || '/').split('?')[0].replace(/\/+$/, '') || '/';
    return routePath.startsWith('/') ? routePath : `/${routePath}`;
};

const normalizeMethod = (method = 'GET') => String(method || 'GET').trim().toUpperCase();
const isStateChangingMethod = (method = 'GET') => STATE_CHANGING_METHODS.has(normalizeMethod(method));
const hasStaticExtension = (routePath = '') => /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|svg|webp|ico|json|txt|woff2?|ttf|otf)$/i.test(routePath);

const classifyRoute = ({ method = 'GET', path = '/', originalUrl = '' } = {}) => {
    const routePath = normalizeRoutePath(path || originalUrl);
    const normalizedMethod = normalizeMethod(method);
    const mutating = isStateChangingMethod(normalizedMethod);

    if (routePath === '/health' || routePath.startsWith('/health/') || routePath.startsWith('/api/health')) return ROUTE_CLASSES.HEALTH;
    if (routePath === '/metrics') return ROUTE_CLASSES.HEALTH;
    if (routePath === '/api/status' || routePath.startsWith('/api/status/') || routePath.startsWith('/status')) return ROUTE_CLASSES.STATUS_PUBLIC;
    if (routePath.startsWith('/uploads') || routePath.startsWith('/api/uploads')) return ROUTE_CLASSES.UPLOAD;
    if (!routePath.startsWith('/api/') && (hasStaticExtension(routePath) || routePath.startsWith('/assets/'))) return ROUTE_CLASSES.STATIC_PUBLIC;
    if (routePath.startsWith('/api/payments/webhooks') || routePath.startsWith('/api/email-webhooks')) return ROUTE_CLASSES.WEBHOOK;
    if (routePath.startsWith('/api/admin/')) return mutating ? ROUTE_CLASSES.ADMIN_WRITE : ROUTE_CLASSES.ADMIN_READ;
    if (routePath.startsWith('/api/otp') || routePath.startsWith('/api/auth/otp')) return ROUTE_CLASSES.OTP;
    if (routePath.startsWith('/api/auth')) return ROUTE_CLASSES.AUTH_LOGIN;
    if (routePath.startsWith('/api/ai') || routePath.startsWith('/api/intelligence') || routePath.includes('/visual-search')) return ROUTE_CLASSES.AI_EXPENSIVE;
    if (routePath.startsWith('/api/payments') || routePath.startsWith('/api/checkout')) return ROUTE_CLASSES.PAYMENT;
    if (routePath.startsWith('/api/products') || routePath.startsWith('/api/listings') || routePath.startsWith('/api/recommendations')) {
        return mutating ? ROUTE_CLASSES.AUTHENTICATED_WRITE : ROUTE_CLASSES.PUBLIC_SEARCH;
    }
    if (routePath.startsWith('/api/orders') || routePath.startsWith('/api/cart') || routePath.startsWith('/api/support')) {
        return mutating ? ROUTE_CLASSES.AUTHENTICATED_WRITE : ROUTE_CLASSES.AUTHENTICATED_READ;
    }
    if (routePath.startsWith('/api/')) return mutating ? ROUTE_CLASSES.AUTHENTICATED_WRITE : ROUTE_CLASSES.PUBLIC_READ;
    return ROUTE_CLASSES.STATIC_PUBLIC;
};

const getTrafficBudget = (routeClass = ROUTE_CLASSES.PUBLIC_READ) => TRAFFIC_BUDGETS[routeClass] || TRAFFIC_BUDGETS[ROUTE_CLASSES.PUBLIC_READ];

const buildTrafficBudgetSummary = () => Object.values(TRAFFIC_BUDGETS).map((budget) => ({
    routeClass: budget.routeClass,
    categoryName: budget.categoryName,
    maxBodyBytes: budget.maxBodyBytes,
    timeoutMs: budget.timeoutMs,
    perIp: budget.perIp,
    perAccount: budget.perAccount,
    perSession: budget.perSession,
    productionFailMode: budget.productionFailMode,
    costRisk: budget.costRisk,
    canDegrade: budget.canDegrade,
    emergencyFlag: budget.emergencyFlag,
}));

module.exports = {
    ROUTE_CLASSES,
    STATE_CHANGING_METHODS,
    TRAFFIC_BUDGETS,
    buildTrafficBudgetSummary,
    classifyRoute,
    getTrafficBudget,
    hasStaticExtension,
    isStateChangingMethod,
    normalizeMethod,
    normalizeRoutePath,
};
