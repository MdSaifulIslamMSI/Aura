const { getAttackModeConfig, shouldBlockForAttackMode } = require('../config/attackMode');
const { getTrafficBudget } = require('../config/trafficBudgets');
const { recordTrafficBudgetDenied } = require('../metrics/trafficResilienceMetrics');
const logger = require('../utils/logger');

const attackModeGuard = () => (req, res, next) => {
    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    const blocked = shouldBlockForAttackMode({
        routeClass: budget.routeClass,
        method: req.method,
        path: req.originalUrl || req.path,
        config: getAttackModeConfig(),
    });
    if (!blocked) return next();

    recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason: 'attack_mode' });
    logger.warn('traffic.attack_mode_denied', {
        requestId: req.requestId || '',
        routeClass: budget.routeClass,
        method: req.method,
        path: req.originalUrl || req.path,
    });
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({
        success: false,
        code: 'ATTACK_MODE_ROUTE_DISABLED',
        message: 'This feature is temporarily unavailable while traffic protection is active.',
        requestId: req.requestId || '',
    });
};

module.exports = { attackModeGuard };
