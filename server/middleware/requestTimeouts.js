const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');
const { recordTrafficBudgetDenied } = require('../metrics/trafficResilienceMetrics');
const logger = require('../utils/logger');

const budgetRequestTimeout = () => (req, res, next) => {
    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    if (budget.routeClass === ROUTE_CLASSES.HEALTH) return next();
    const timeoutMs = Number(budget.timeoutMs || 0);
    if (!timeoutMs) return next();

    const timer = setTimeout(() => {
        if (res.headersSent) return;
        recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason: 'timeout' });
        logger.warn('traffic.timeout_denied', {
            requestId: req.requestId || '',
            routeClass: budget.routeClass,
            method: req.method,
            path: req.originalUrl || req.path,
            timeoutMs,
        });
        res.set('Cache-Control', 'no-store');
        res.status(503).json({
            success: false,
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            message: 'This route is temporarily overloaded. Please try again shortly.',
            requestId: req.requestId || '',
        });
    }, timeoutMs);

    if (typeof timer.unref === 'function') timer.unref();
    req.clearTrafficBudgetTimeout = () => clearTimeout(timer);

    const cleanup = () => clearTimeout(timer);
    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return next();
};

module.exports = { budgetRequestTimeout };
