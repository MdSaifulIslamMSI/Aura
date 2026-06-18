const crypto = require('crypto');
const { createDistributedRateLimit } = require('./distributedRateLimit');
const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');
const { recordTrafficBudgetDenied } = require('../metrics/trafficResilienceMetrics');
const { getAuthenticatedRateLimitIdentity, getTrustedRequestIp } = require('../utils/requestIdentity');
const logger = require('../utils/logger');

const limiterCache = new Map();
const SKIP_CLASSES = new Set([ROUTE_CLASSES.HEALTH, ROUTE_CLASSES.STATIC_PUBLIC]);

const isEnabled = () => String(process.env.TRAFFIC_BUDGET_LIMITS_ENABLED || 'true').trim().toLowerCase() !== 'false';
const isProduction = () => String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const isSensitiveBudget = (budget) => budget.productionFailMode === 'fail-closed' || budget.costRisk === 'critical';
const RESET_PASSWORD_PATHS = new Set(['/api/otp/reset-password', '/api/auth/otp/reset-password']);

const normalizeRequestPath = (req = {}) => {
    const routePath = String(req.path || req.originalUrl || '').split('?')[0].replace(/\/+$/, '') || '/';
    return routePath.startsWith('/') ? routePath : `/${routePath}`;
};

const hashBudgetKeyPart = (value) => crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 32);

const getResetPasswordFlowBudgetIdentity = (req = {}) => {
    if (String(req.method || '').trim().toUpperCase() !== 'POST') return '';
    if (!RESET_PASSWORD_PATHS.has(normalizeRequestPath(req))) return '';

    const flowToken = String(req.body?.flowToken || '').trim();
    if (!flowToken) return '';

    return `reset-flow:${hashBudgetKeyPart(flowToken)}`;
};

const limiterMessage = (budget) => ({
    success: false,
    code: budget.userMessageCode || 'TRAFFIC_BUDGET_DENIED',
    message: 'Too many requests for this route. Please slow down and try again.',
});

const getLimiter = (budget, dimension) => {
    const max = Number(budget[dimension] || 0);
    if (!max) return null;
    const cacheKey = `${budget.routeClass}:${dimension}:${max}:${budget.windowSeconds}`;
    if (limiterCache.has(cacheKey)) return limiterCache.get(cacheKey);

    const critical = isSensitiveBudget(budget);
    const limiter = createDistributedRateLimit({
        allowInMemoryFallback: !critical || !isProduction(),
        securityCritical: critical,
        name: `traffic_${dimension}_${String(budget.routeClass).toLowerCase()}`,
        windowMs: Number(budget.windowSeconds || 60) * 1000,
        max,
        message: limiterMessage(budget),
        keyGenerator: (req) => {
            const resetPasswordFlowIdentity = budget.routeClass === ROUTE_CLASSES.OTP
                ? getResetPasswordFlowBudgetIdentity(req)
                : '';
            if (resetPasswordFlowIdentity && (dimension === 'perIp' || dimension === 'perSession')) {
                return `${dimension}:${resetPasswordFlowIdentity}`;
            }

            if (dimension === 'perAccount') return getAuthenticatedRateLimitIdentity(req);
            if (dimension === 'perSession') return `session:${String(req.headers?.['x-client-session-id'] || req.authSession?.sessionId || getTrustedRequestIp(req)).slice(0, 120)}`;
            return `ip:${getTrustedRequestIp(req)}`;
        },
    });
    limiterCache.set(cacheKey, limiter);
    return limiter;
};

const runLimiter = (limiter, req, res) => new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
        res.off?.('finish', resolveOnce);
        res.off?.('close', resolveOnce);
        res.off?.('error', rejectOnce);
    };
    const resolveOnce = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
    };
    const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
    };

    res.once?.('finish', resolveOnce);
    res.once?.('close', resolveOnce);
    res.once?.('error', rejectOnce);

    try {
        const maybePromise = limiter(req, res, (error) => (error ? rejectOnce(error) : resolveOnce()));
        if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.catch(rejectOnce);
        }
        if (res.headersSent) resolveOnce();
    } catch (error) {
        rejectOnce(error);
    }
});

const trafficBudgetPolicy = () => async (req, res, next) => {
    if (!isEnabled()) return next();
    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    if (SKIP_CLASSES.has(budget.routeClass)) return next();

    const limiters = ['perIp', 'perAccount', 'perSession']
        .map((dimension) => getLimiter(budget, dimension))
        .filter(Boolean);

    try {
        for (const limiter of limiters) {
            await runLimiter(limiter, req, res);
            if (res.headersSent) {
                recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason: 'rate_limit' });
                return;
            }
        }
        return next();
    } catch (error) {
        logger.error('traffic.rate_limit_failed', {
            requestId: req.requestId || '',
            routeClass: budget.routeClass,
            error: error?.message || 'unknown',
        });
        return next(error);
    }
};

module.exports = { trafficBudgetPolicy };
