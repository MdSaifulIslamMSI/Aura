// Declarative route-security matrix data.
//
// Consumed by tests/routeSecurityMatrix.security.test.js through
// @aurasec/route-security-matrix (source: packages/route-security-matrix).
// The derivation/probe machinery is generic; everything app-specific —
// mounts, postures, overrides — lives here. A new route cannot merge
// without a posture decision recorded in this file.

// Route variable names that resolve to a file in server/routes/. Derived from
// the `app.use('/api/...', xRoutes)` mounts and `router.use('...', yRoutes)`
// nested mounts in the route files themselves.
const mountPrefixes = {
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
    shippingRoutes: ['/api/shipping'],
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
    adminPrivilegedAccessRoutes: ['/api/admin/privileged-access'],
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
const variableMountRouters = ['metricsRoute', 'securityCanaryRoutes'];

// Postures (vocabulary owned by @aurasec/route-security-matrix):
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
const routePostures = {
    adminAbuseRoutes: 'admin',
    adminAnalyticsRoutes: 'admin',
    adminCatalogRoutes: 'admin',
    adminEmailOpsRoutes: 'admin',
    adminEmergencyControlRoutes: 'admin',
    adminFraudRoutes: 'admin',
    adminNotificationRoutes: 'admin',
    adminOrderEmailRoutes: 'admin',
    adminOpsRoutes: 'admin',
    adminPrivilegedAccessRoutes: 'admin',
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
    // Courier checkpoint webhooks: HMAC-verified per provider and deduped on
    // the ShippingEvent ledger (shippingWebhookService suite).
    shippingRoutes: 'webhook',
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
const routePostureOverrides = {
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

module.exports = {
    mountPrefixes,
    variableMountRouters,
    routePostures,
    routePostureOverrides,
};
