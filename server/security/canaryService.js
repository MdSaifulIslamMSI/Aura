const { applyContainment } = require('./containmentService');
const { writeSecurityEvent } = require('./securityEventLogger');
const { hashSecurityValue } = require('./redactSecurityMetadata');

const CANARY_ROUTES = Object.freeze([
    '/admin-super-secret',
    '/internal/debug',
    '/api/v1/export-all-users',
    '/api/v1/admin/token-dump',
    '/.env',
    '/config/secrets',
]);

const canaryTouches = new Map();
const WINDOW_MS = 15 * 60 * 1000;

const isCanaryEnabled = (env = process.env) => String(env.SECURITY_CANARY_ROUTES_ENABLED || 'true').trim().toLowerCase() !== 'false';

const normalizePath = (value = '') => {
    const path = String(value || '').split('?')[0].replace(/\/+$/, '') || '/';
    return path.toLowerCase();
};

const isCanaryRoute = (path = '') => {
    const normalized = normalizePath(path);
    return CANARY_ROUTES.map(normalizePath).includes(normalized);
};

const keyForRequest = (req = {}) => {
    const ip = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const ua = req.headers?.['user-agent'] || '';
    const userId = req.user?._id || req.authSession?.userId || '';
    return hashSecurityValue(`${ip}:${ua}:${userId}`);
};

const recordCanaryTouch = (req = {}) => {
    const now = Date.now();
    const key = keyForRequest(req);
    const current = canaryTouches.get(key) || { count: 0, firstSeenAt: now, lastSeenAt: now };
    const fresh = now - current.firstSeenAt <= WINDOW_MS
        ? current
        : { count: 0, firstSeenAt: now, lastSeenAt: now };
    fresh.count += 1;
    fresh.lastSeenAt = now;
    canaryTouches.set(key, fresh);

    const route = req.originalUrl || req.path || '';
    writeSecurityEvent({
        event: 'canary.touched',
        req,
        userId: req.user?._id || req.authSession?.userId || '',
        tenantId: req.user?.tenantId || '',
        action: 'canary.route_touched',
        route,
        method: req.method,
        riskScore: Math.min(100, 50 + fresh.count * 15),
        decision: fresh.count >= 3 ? 'CONTAIN' : 'DENY',
        reasonCode: 'canary.route_touched',
        metadata: {
            canaryRoute: normalizePath(route),
            touchCount: fresh.count,
        },
    }, { level: 'warn' });

    if (fresh.count >= 3) {
        applyContainment({
            req,
            context: {
                userId: req.user?._id || req.authSession?.userId || '',
                ipHash: hashSecurityValue(req.ip || ''),
                userAgentHash: hashSecurityValue(req.headers?.['user-agent'] || ''),
                action: 'canary.route_touched',
                route,
                method: req.method,
            },
            decision: {
                riskScore: Math.min(100, 50 + fresh.count * 15),
                reason: 'canary_repeat_touch',
                containmentActions: ['require_step_up', 'increase_rate_limit_severity', 'emit_incident_event'],
            },
        });
    }

    return {
        key,
        count: fresh.count,
        contained: fresh.count >= 3,
    };
};

module.exports = {
    CANARY_ROUTES,
    isCanaryEnabled,
    isCanaryRoute,
    recordCanaryTouch,
    __resetCanaryTouches: () => canaryTouches.clear(),
};
