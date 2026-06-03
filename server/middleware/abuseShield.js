const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');
const { recordTrafficAbuseEvent, recordTrafficBudgetDenied } = require('../metrics/trafficResilienceMetrics');
const { isDenied, scoreRequest } = require('../services/abuseScoreService');
const { getTrustedRequestIp } = require('../utils/requestIdentity');
const logger = require('../utils/logger');

const blockingEnabled = () => String(process.env.ABUSE_SHIELD_BLOCKING_ENABLED || 'false').trim().toLowerCase() === 'true';
const denylistEnabled = () => String(process.env.ABUSE_SHIELD_DENYLIST_ENABLED || 'true').trim().toLowerCase() !== 'false';

const abuseShield = () => async (req, res, next) => {
    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    if (budget.routeClass === ROUTE_CLASSES.HEALTH) return next();
    const identity = getTrustedRequestIp(req);
    if (denylistEnabled() && await isDenied(identity)) {
        recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason: 'abuse_denylist' });
        logger.warn('traffic.abuse_denylist_denied', {
            requestId: req.requestId || '',
            routeClass: budget.routeClass,
            path: req.originalUrl || req.path,
        });
        res.set('Cache-Control', 'no-store');
        return res.status(403).json({
            success: false,
            code: 'TEMPORARY_ABUSE_BLOCK',
            message: 'Request blocked by temporary traffic protection.',
            requestId: req.requestId || '',
        });
    }

    const result = scoreRequest(req);
    req.abuseScore = result.score;
    req.abuseAction = result.action;
    if (result.score > 0) {
        recordTrafficAbuseEvent({ routeClass: budget.routeClass, action: result.action });
        logger.warn('traffic.abuse_score_observed', {
            requestId: req.requestId || '',
            routeClass: budget.routeClass,
            action: result.action,
            score: result.score,
            reasons: result.reasons,
        });
    }

    if (blockingEnabled() && result.action === 'block') {
        recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason: 'abuse_score' });
        res.set('Cache-Control', 'no-store');
        return res.status(403).json({
            success: false,
            code: 'ABUSE_SHIELD_BLOCKED',
            message: 'Request blocked by traffic protection.',
            requestId: req.requestId || '',
        });
    }

    return next();
};

module.exports = { abuseShield };
