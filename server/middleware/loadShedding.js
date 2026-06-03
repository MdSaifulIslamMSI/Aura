const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');
const { recordTrafficBudgetDenied, setTrafficLoadSheddingState } = require('../metrics/trafficResilienceMetrics');
const logger = require('../utils/logger');

let activeRequests = 0;
let lastEventLoopLagMs = 0;

const parseNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const monitorIntervalMs = 1000;
let expectedTick = Date.now() + monitorIntervalMs;
const lagTimer = setInterval(() => {
    const now = Date.now();
    lastEventLoopLagMs = Math.max(0, now - expectedTick);
    expectedTick = now + monitorIntervalMs;
}, monitorIntervalMs);
if (typeof lagTimer.unref === 'function') lagTimer.unref();

const getLoadSheddingState = (env = process.env) => {
    const maxActiveRequests = parseNumber(env.TRAFFIC_FORTRESS_MAX_ACTIVE_REQUESTS, 500);
    const maxEventLoopLagMs = parseNumber(env.TRAFFIC_FORTRESS_MAX_EVENT_LOOP_LAG_MS, 250);
    const forceOverload = String(env.TRAFFIC_FORTRESS_FORCE_OVERLOAD || '').trim().toLowerCase() === 'yes';
    const enabled = String(env.TRAFFIC_FORTRESS_ENABLED || 'true').trim().toLowerCase() !== 'false';
    const overloaded = enabled && (forceOverload || activeRequests > maxActiveRequests || lastEventLoopLagMs > maxEventLoopLagMs);
    return { activeRequests, enabled, forceOverload, lastEventLoopLagMs, maxActiveRequests, maxEventLoopLagMs, overloaded };
};

const canShedRoute = (routeClass, budget) => {
    if (routeClass === ROUTE_CLASSES.HEALTH || routeClass === ROUTE_CLASSES.STATUS_PUBLIC) return false;
    if (routeClass === ROUTE_CLASSES.WEBHOOK || routeClass === ROUTE_CLASSES.ADMIN_WRITE) return false;
    return Boolean(budget.canDegrade);
};

const loadShedding = () => (req, res, next) => {
    activeRequests += 1;
    const cleanup = () => {
        activeRequests = Math.max(0, activeRequests - 1);
    };
    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);

    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    const state = getLoadSheddingState();
    setTrafficLoadSheddingState(state.overloaded);
    if (!state.overloaded || !canShedRoute(req.trafficRouteClass, budget)) return next();

    recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason: 'load_shedding' });
    logger.warn('traffic.load_shedding_denied', {
        requestId: req.requestId || '',
        routeClass: budget.routeClass,
        method: req.method,
        path: req.originalUrl || req.path,
        activeRequests: state.activeRequests,
        eventLoopLagMs: state.lastEventLoopLagMs,
    });
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({
        success: false,
        code: 'TRAFFIC_LOAD_SHEDDING',
        message: 'This feature is temporarily degraded to protect core availability.',
        requestId: req.requestId || '',
    });
};

module.exports = { getLoadSheddingState, loadShedding };
