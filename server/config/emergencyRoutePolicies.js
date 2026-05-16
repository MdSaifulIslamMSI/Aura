const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const normalizeRequestPath = (req = {}) => String(req.originalUrl || req.url || req.path || '/')
    .split('?')[0]
    .replace(/\/+$/, '') || '/';

const normalizeMethod = (req = {}) => String(req.method || 'GET').trim().toUpperCase();

const isStateChangingRequest = (req = {}) => STATE_CHANGING_METHODS.has(normalizeMethod(req));

const hasStaticAssetExtension = (path = '') => /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|svg|webp|ico|json|txt|woff2?|ttf|otf)$/i.test(path);

const isPaymentWebhookPath = (path = '') => path.startsWith('/api/payments/webhooks');
const isEmailWebhookPath = (path = '') => path.startsWith('/api/email-webhooks');
const isExternalWebhookPath = (path = '') => isPaymentWebhookPath(path) || isEmailWebhookPath(path);

const isEmergencyAdminPath = (path = '') => path.startsWith('/api/admin/emergency-controls');

const isMaintenanceAllowedPath = (req = {}) => {
    const path = normalizeRequestPath(req);
    const method = normalizeMethod(req);
    if (path.startsWith('/health') || path === '/metrics') return true;
    if (path === '/api/emergency/status') return true;
    if (isEmergencyAdminPath(path)) return true;
    if (isExternalWebhookPath(path)) return true;
    if (path === '/admin/emergency-controls' || path.startsWith('/admin/emergency-controls/')) return true;
    if (path.startsWith('/assets/') || path.startsWith('/static/')) return true;
    if (['GET', 'HEAD'].includes(method) && hasStaticAssetExtension(path)) return true;
    if (['/api/auth/session', '/api/auth/logout', '/api/auth/verify-device'].includes(path)) return true;
    return false;
};

const isReadOnlyExemptPath = (req = {}) => {
    const path = normalizeRequestPath(req);
    return isEmergencyAdminPath(path) || isExternalWebhookPath(path);
};

const purposeMatches = (req = {}, expected = []) => {
    const purpose = String(req.body?.purpose || req.query?.purpose || '').trim().toLowerCase();
    return expected.includes(purpose);
};

const policy = (flagKey, feature, message, matcher, failClosed = true) => ({
    flagKey,
    feature,
    message,
    matcher,
    failClosed,
});

const EMERGENCY_ROUTE_POLICIES = [
    policy(
        'DISABLE_LOGIN',
        'login',
        'Login is temporarily unavailable. Existing sessions may continue.',
        (req) => {
            if (normalizeMethod(req) !== 'POST') return false;
            const path = normalizeRequestPath(req);
            return path === '/api/auth/exchange'
                || path === '/api/auth/sync'
                || path === '/api/auth/complete-phone-factor-login'
                || purposeMatches(req, ['login']);
        }
    ),
    policy(
        'DISABLE_SIGNUP',
        'signup',
        'Signup is temporarily unavailable. Please try again later.',
        (req) => {
            if (normalizeMethod(req) !== 'POST') return false;
            const path = normalizeRequestPath(req);
            return path === '/api/auth/register'
                || purposeMatches(req, ['signup']);
        }
    ),
    policy(
        'DISABLE_PAYMENT',
        'payment',
        'Payments are temporarily unavailable. Please try again later.',
        (req) => {
            const path = normalizeRequestPath(req);
            if (!isStateChangingRequest(req)) return false;
            if (isExternalWebhookPath(path)) return false;
            return path.startsWith('/api/payments') || path.startsWith('/api/admin/payments');
        }
    ),
    policy(
        'DISABLE_CHECKOUT',
        'checkout',
        'Checkout is temporarily unavailable. You can continue browsing products.',
        (req) => {
            if (!isStateChangingRequest(req)) return false;
            const path = normalizeRequestPath(req);
            return path === '/api/orders' || path === '/api/orders/quote';
        }
    ),
    policy(
        'DISABLE_OTP_SEND',
        'otp',
        'Verification is temporarily unavailable. Please try again later.',
        (req) => {
            if (normalizeMethod(req) !== 'POST') return false;
            const path = normalizeRequestPath(req);
            return path === '/api/otp/send'
                || path === '/api/auth/otp/send'
                || purposeMatches(req, ['payment-challenge', 'signup', 'login', 'forgot-password']);
        }
    ),
    policy(
        'DISABLE_PASSWORD_RESET',
        'password_reset',
        'Password reset is temporarily unavailable. Please try again later.',
        (req) => {
            if (normalizeMethod(req) !== 'POST') return false;
            const path = normalizeRequestPath(req);
            return path.endsWith('/reset-password') || purposeMatches(req, ['forgot-password']);
        }
    ),
    policy(
        'DISABLE_AI_ASSISTANT',
        'ai',
        'The assistant is temporarily unavailable. Please contact support if you need help.',
        (req) => {
            const path = normalizeRequestPath(req);
            return path.startsWith('/api/ai') || path.startsWith('/api/internal/ai');
        },
        true
    ),
    policy(
        'DISABLE_ADMIN_MUTATIONS',
        'admin',
        'Administrative changes are temporarily unavailable.',
        (req) => {
            if (!isStateChangingRequest(req)) return false;
            const path = normalizeRequestPath(req);
            if (isEmergencyAdminPath(path)) return false;
            return path.startsWith('/api/admin/')
                || /^\/api\/orders\/[^/]+\/(?:admin-cancel|status)$/.test(path)
                || /^\/api\/orders\/[^/]+\/command-center\/(?:refund|replace|warranty)\/[^/]+\/admin$/.test(path)
                || /^\/api\/orders\/[^/]+\/command-center\/support\/admin-reply$/.test(path);
        }
    ),
    policy(
        'DISABLE_REFUNDS',
        'refunds',
        'Refund actions are temporarily unavailable. Existing requests remain safe.',
        (req) => {
            if (!isStateChangingRequest(req)) return false;
            const path = normalizeRequestPath(req);
            return path.includes('/refund')
                || path.includes('/refunds')
                || path.includes('/refund-ledger');
        }
    ),
    policy(
        'DISABLE_ORDER_CANCELLATION',
        'order_cancellation',
        'Order cancellation is temporarily unavailable. Please contact support.',
        (req) => {
            if (!isStateChangingRequest(req)) return false;
            const path = normalizeRequestPath(req);
            return /^\/api\/orders\/[^/]+\/(?:cancel|admin-cancel)$/.test(path);
        }
    ),
    policy(
        'DISABLE_PUBLIC_API_MUTATIONS',
        'public_api_mutations',
        'Some account and marketplace actions are temporarily unavailable.',
        (req) => {
            if (!isStateChangingRequest(req)) return false;
            const path = normalizeRequestPath(req);
            if (path.startsWith('/api/admin/') || path.startsWith('/api/internal/')) return false;
            if (path.startsWith('/api/auth/') || path.startsWith('/api/otp/')) return false;
            if (path === '/api/emergency/status' || isPaymentWebhookPath(path)) return false;
            return [
                '/api/cart',
                '/api/users',
                '/api/orders',
                '/api/listings',
                '/api/trade-in',
                '/api/price-alerts',
                '/api/support',
                '/api/uploads',
                '/api/intelligence',
            ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
        }
    ),
];

const getEmergencyPoliciesForRequest = (req = {}) => EMERGENCY_ROUTE_POLICIES
    .filter((entry) => entry.matcher(req));

module.exports = {
    EMERGENCY_ROUTE_POLICIES,
    getEmergencyPoliciesForRequest,
    isEmergencyAdminPath,
    isEmailWebhookPath,
    isExternalWebhookPath,
    isMaintenanceAllowedPath,
    isPaymentWebhookPath,
    isReadOnlyExemptPath,
    isStateChangingRequest,
    normalizeRequestPath,
};
