// Central route-security matrix (audit 2026-06-01 "fix this month" item).
//
// Route security middleware is composed per route file, so coverage is hard
// to prove by reading code. This suite derives every route directly from
// server/routes/*.js plus the mounts in server/index.js and enforces two
// guarantees:
//   1. Coverage — every derived state-changing route must be declared in the
//      inventory below. A new mutating route cannot merge without an explicit
//      security posture decision.
//   2. Behavior — every declared guarded route must actually reject an
//      unauthenticated request; declared-public/webhook routes must not 5xx.
//
// Maintenance: run with ROUTE_MATRIX_REPORT=<path> to dump derived routes and
// observed unauthenticated statuses as JSON for inventory review.

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const previousTrafficFortressEnabled = process.env.TRAFFIC_FORTRESS_ENABLED;
process.env.TRAFFIC_FORTRESS_ENABLED = 'false';

const app = require('../index');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const INDEX_FILE = path.join(__dirname, '..', 'index.js');
const HTTP_METHODS = ['post', 'patch', 'put', 'delete'];
const ROUTE_METHODS = [...HTTP_METHODS, 'get'];
const PATH_PARAM_ID = '507f1f77bcf86cd799439011';

// Route variable names that resolve to a file in server/routes/. Derived from
// the `app.use('/api/...', xRoutes)` mounts and `router.use('...', yRoutes)`
// nested mounts in the route files themselves.
const MOUNT_PREFIXES = {
    healthRoutes: ['/api/health'],
    emergencyRoutes: ['/api/emergency'],
    productRoutes: ['/api/products'],
    recommendationRoutes: ['/api/recommendations'],
    recommendationEventRoutes: ['/api/recommendation-events'],
    authRoutes: ['/api/auth'],
    accountRoutes: ['/api/account'],
    securityRoutes: ['/api/security'],
    userRoutes: ['/api/users'],
    cartRoutes: ['/api/cart'],
    orderRoutes: ['/api/orders'],
    checkoutRoutes: ['/api/checkout'],
    aiRoutes: ['/api/ai'],
    otpRoutes: ['/api/otp', '/api/auth/otp'],
    listingRoutes: ['/api/listings'],
    tradeInRoutes: ['/api/trade-in'],
    priceAlertRoutes: ['/api/price-alerts'],
    paymentRoutes: ['/api/payments'],
    i18nRoutes: ['/api/i18n'],
    marketRoutes: ['/api/markets'],
    statusRoutes: ['/api/status'],
    adminSecurityRoutes: ['/api/admin/security'],
    adminEmergencyControlRoutes: ['/api/admin/emergency-controls'],
    adminPaymentRoutes: ['/api/admin/payments'],
    adminOrderEmailRoutes: ['/api/admin/order-emails'],
    adminEmailOpsRoutes: ['/api/admin/email-ops'],
    adminNotificationRoutes: ['/api/admin/notifications'],
    adminAnalyticsRoutes: ['/api/admin/analytics'],
    adminCatalogRoutes: ['/api/admin/catalog'],
    adminUserRoutes: ['/api/admin/users'],
    adminProductRoutes: ['/api/admin/products'],
    adminOpsRoutes: ['/api/admin/ops'],
    adminFraudRoutes: ['/api/admin/fraud'],
    adminAbuseRoutes: ['/api/admin/abuse'],
    adminStatusRoutes: ['/api/admin/status'],
    internalOpsRoutes: ['/api/internal'],
    observabilityRoutes: ['/api/observability'],
    emailWebhookRoutes: ['/api/email-webhooks'],
    uploadRoutes: ['/api/uploads'],
    intelligenceRoutes: ['/api/intelligence'],
    supportRoutes: ['/api/support'],
    userNotificationRoutes: ['/api/notifications'],
};

// Routers mounted with variable or zero prefixes, exempt from the quoted-mount
// sync check: metricsRoute mounts at an env-configured path (GET-only,
// auth-gated) and securityCanaryRoutes mounts prefix-less and defines its
// honeypot routes dynamically via router.all (no derivable literals).
const VARIABLE_MOUNT_ROUTERS = ['metricsRoute', 'securityCanaryRoutes'];

// Postures:
//   auth    — requires an authenticated session/bearer; unauthenticated probe
//             must return 401 or 403.
//   admin   — auth plus an admin gate; unauthenticated probe must return 401
//             or 403.
//   public  — intentionally open; probe must not return a 5xx.
//   preauth — part of the pre-authentication journey (OTP send/verify,
//             recovery-code verify, device bootstrap); validation and abuse
//             controls run before any session exists, so a 4xx rejection is
//             the expected unauthenticated outcome.
//   env-gated-public — runs unauthenticated only when AI_PUBLIC_*_ACCESS_ENABLED
//             turns the surface on (defaults off in production via
//             infra compose and the NODE_ENV fallback in aiRoutes.js; the
//             production gate is regression-tested in productionGateRoutes.test.js).
//             Probe must not return a 5xx.
//   signed-assertion — trust comes from a cryptographic request assertion
//             (desktop owner access), not a session; garbage input must be
//             rejected with a 4xx.
//   webhook — signature/secret verified; unauthenticated probe must return a
//             4xx rejection, or 503 when the receiver is deliberately
//             unconfigured (fail-closed).
//   skip    — excluded from probing; requires a justification comment.
//
// File-level defaults apply to every derived state-changing route in the file;
// per-route entries (keyed "METHOD <path>") override where behavior differs.
const ROUTE_POSTURES = {
    adminAbuseRoutes: 'admin',
    adminAnalyticsRoutes: 'admin',
    adminCatalogRoutes: 'admin',
    adminEmailOpsRoutes: 'admin',
    adminEmergencyControlRoutes: 'admin',
    adminFraudRoutes: 'admin',
    adminNotificationRoutes: 'admin',
    adminOrderEmailRoutes: 'admin',
    adminOpsRoutes: 'admin',
    adminPaymentRoutes: 'admin',
    adminProductRoutes: 'admin',
    adminSecurityRoutes: 'admin',
    adminStatusRoutes: 'admin',
    adminUserRoutes: 'admin',
    accountRoutes: 'auth',
    aiRoutes: 'auth',
    authRoutes: 'auth',
    cartRoutes: 'auth',
    checkoutRoutes: 'auth',
    emergencyRoutes: 'auth',
    intelligenceRoutes: 'auth',
    internalOpsRoutes: 'auth',
    listingRoutes: 'auth',
    marketRoutes: 'auth',
    metricsRoute: 'auth',
    orderRoutes: 'auth',
    otpRoutes: 'preauth',
    paymentRoutes: 'auth',
    priceAlertRoutes: 'auth',
    // Anonymous telemetry ingestion; a dedicated per-IP limiter plus schema
    // validation run before any session exists (proven by the
    // recommendationEventRateLimit.security suite).
    recommendationEventRoutes: 'preauth',
    securityCanaryRoutes: 'auth',
    securityRoutes: 'auth',
    supportRoutes: 'auth',
    tradeInRoutes: 'auth',
    uploadRoutes: 'auth',
    userNotificationRoutes: 'auth',
    // Files with intentionally mixed or open surfaces declare per-route
    // postures below; the file default only fills undeclared leftovers.
    emailWebhookRoutes: 'webhook',
    healthRoutes: 'public',
    i18nRoutes: 'public',
    observabilityRoutes: 'public',
    productRoutes: 'public',
    recommendationRoutes: 'public',
    statusRoutes: 'public',
    userRoutes: 'auth',
};

// Per-route posture overrides for the mixed/open files. Key format:
// "METHOD <mount-prefix><route-path>".
const ROUTE_POSTURE_OVERRIDES = {
    // AI chat/voice fall back to optional-auth in non-production when the
    // public-access env gates are on; production defaults are off
    // (productionGateRoutes.test.js proves the production gate).
    'POST /api/ai/chat': 'env-gated-public',
    'POST /api/ai/chat/stream': 'env-gated-public',
    'POST /api/ai/voice/session': 'env-gated-public',
    'POST /api/ai/voice/speak': 'env-gated-public',

    // Anonymous-but-idempotent logout: protectOptional by design so a stale
    // client can always clear its cookie without erroring.
    'POST /api/auth/logout': 'public',

    // Desktop bootstraps trust via a signed request assertion, not a session.
    'POST /api/auth/desktop-handoff/owner-access-token': 'signed-assertion',

    // Pre-authentication journeys: abuse controls (Turnstile, lockout gate,
    // distributed limiters) run before any session exists.
    'POST /api/auth/bootstrap-device-challenge': 'preauth',
    'POST /api/auth/recovery-codes/verify': 'preauth',

    // Status-page webhooks verify a shared secret; 401 unauthenticated.
    'POST /api/status/webhooks/uptime-kuma': 'webhook',
    'POST /api/status/webhooks/gatus': 'webhook',
    'POST /api/status/webhooks/alertmanager': 'webhook',
    'POST /api/status/webhooks/github-actions': 'webhook',
};

const deriveRoutesFromFile = (fileName) => {
    const source = fs.readFileSync(path.join(ROUTES_DIR, fileName), 'utf8');
    const routes = [];
    const routePattern = new RegExp(
        `router\\.(${ROUTE_METHODS.join('|')})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`,
        'g'
    );
    let match;
    while ((match = routePattern.exec(source)) !== null) {
        routes.push({ method: match[1].toUpperCase(), routePath: match[2] });
    }
    return routes;
};

const deriveAllRoutes = () => {
    const derived = [];
    const routeFiles = fs
        .readdirSync(ROUTES_DIR)
        .filter((name) => name.endsWith('.js') && name !== 'index.js');

    for (const fileName of routeFiles) {
        const variableName = fileName.replace(/\.js$/, '');
        const prefixes = MOUNT_PREFIXES[variableName];
        if (!prefixes) {
            continue; // Not mounted in index.js (or a helper module).
        }
        for (const route of deriveRoutesFromFile(fileName)) {
            for (const prefix of prefixes) {
                derived.push({ file: variableName, ...route, path: `${prefix}${route.routePath}` });
            }
        }
    }
    return derived;
};

const mutatingRoutes = () => deriveAllRoutes().filter((route) => HTTP_METHODS.includes(route.method.toLowerCase()));

const postureFor = (route) => ROUTE_POSTURE_OVERRIDES[`${route.method} ${route.path}`]
    || ROUTE_POSTURES[route.file]
    || 'undeclared';

const resolveProbePath = (routePath) => routePath.replace(/:[^/]+/g, PATH_PARAM_ID);

const probeRoute = async (route) => {
    const lower = route.method.toLowerCase();
    let req = request(app)[lower](resolveProbePath(route.path));
    if (HTTP_METHODS.includes(lower)) {
        req = req.send({});
    }
    const res = await req;
    return res.statusCode;
};

const reportPath = process.env.ROUTE_MATRIX_REPORT;

describe('Route security matrix', () => {
    jest.setTimeout(60000);

    afterAll(async () => {
        if (previousTrafficFortressEnabled === undefined) {
            delete process.env.TRAFFIC_FORTRESS_ENABLED;
        } else {
            process.env.TRAFFIC_FORTRESS_ENABLED = previousTrafficFortressEnabled;
        }
        if (reportPath) {
            const report = [];
            for (const route of mutatingRoutes()) {
                const status = await probeRoute(route);
                report.push({ ...route, posture: postureFor(route), observedStatus: status });
            }
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        }
    });

    test('every state-changing route is declared in the security posture inventory', () => {
        const undeclared = mutatingRoutes().filter((route) => postureFor(route) === 'undeclared');
        if (undeclared.length > 0) {
            const message = undeclared
                .map((route) => `${route.method} ${route.path} (${route.file}.js)`)
                .join('\n  ');
            throw new Error(
                `Undeclared state-changing routes — add a posture in routeSecurityMatrix.security.test.js:\n  ${message}`
            );
        }
        expect(undeclared).toHaveLength(0);
    });

    test('declared mount prefixes cover every mounted route file', () => {
        const indexSource = fs.readFileSync(INDEX_FILE, 'utf8');
        const mounted = new Map();
        const mountPattern = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
        let match;
        while ((match = mountPattern.exec(indexSource)) !== null) {
            // Only routers are tracked; middleware mounts (e.g. the invisible
            // fabric probe rate limiter on /api/admin) are not route files.
            if (match[1].startsWith('/api') && /Routes?$/.test(match[2])) {
                mounted.set(match[2], match[1]);
            }
        }
        const untracked = [...mounted.keys()].filter((variableName) => !MOUNT_PREFIXES[variableName]);
        const stale = Object.keys(MOUNT_PREFIXES)
            .filter((variableName) => !mounted.has(variableName))
            .filter((variableName) => !VARIABLE_MOUNT_ROUTERS.includes(variableName));
        if (untracked.length > 0 || stale.length > 0) {
            throw new Error(
                `Mount drift — untracked: ${untracked.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'}`
            );
        }
        expect({ untracked, stale }).toEqual({ untracked: [], stale: [] });
    });

    test.each(
        mutatingRoutes()
            .filter((route) => postureFor(route) !== 'skip')
            .map((route) => [`${route.method} ${route.path}`, route])
    )('%s rejects or safely handles unauthenticated requests', async (_label, route) => {
        const status = await probeRoute(route);
        const posture = postureFor(route);
        // 503 is the deliberate fail-closed answer when a guard's downstream
        // dependency (Redis, signature verifier, internal-auth secret) is
        // absent from the runtime environment — a stricter rejection than
        // 401, never a pass-through.
        const failClosed = status === 503;
        if (posture === 'public' || posture === 'env-gated-public') {
            expect(failClosed || status < 500).toBe(true);
            return;
        }
        if (
            posture === 'webhook'
            || posture === 'preauth'
            || posture === 'signed-assertion'
        ) {
            expect(failClosed || (status >= 400 && status < 500)).toBe(true);
            return;
        }
        // auth / admin
        expect(status === 401 || status === 403 || failClosed).toBe(true);
    });
});
