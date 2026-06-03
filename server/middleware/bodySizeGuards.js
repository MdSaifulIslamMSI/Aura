const { getTrafficBudget } = require('../config/trafficBudgets');
const { recordTrafficBudgetDenied } = require('../metrics/trafficResilienceMetrics');
const logger = require('../utils/logger');

const parseContentLength = (req = {}) => {
    const raw = req.headers?.['content-length'];
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const bodySizeGuard = () => (req, res, next) => {
    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    const maxBodyBytes = Number(budget.maxBodyBytes || 0);
    if (!maxBodyBytes) return next();
    const contentLength = parseContentLength(req);
    if (!contentLength || contentLength <= maxBodyBytes) return next();

    recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason: 'body_size' });
    logger.warn('traffic.body_size_denied', {
        requestId: req.requestId || '',
        routeClass: budget.routeClass,
        method: req.method,
        path: req.originalUrl || req.path,
    });
    res.set('Cache-Control', 'no-store');
    return res.status(413).json({
        success: false,
        code: 'TRAFFIC_BODY_TOO_LARGE',
        message: 'Request body is too large for this route.',
        requestId: req.requestId || '',
    });
};

module.exports = { bodySizeGuard, parseContentLength };
