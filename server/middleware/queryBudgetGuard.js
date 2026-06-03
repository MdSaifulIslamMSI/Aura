const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');
const { recordTrafficBudgetDenied } = require('../metrics/trafficResilienceMetrics');
const logger = require('../utils/logger');

const SEARCH_CLASSES = new Set([ROUTE_CLASSES.PUBLIC_SEARCH, ROUTE_CLASSES.AUTHENTICATED_READ, ROUTE_CLASSES.ADMIN_READ]);

const parseLimit = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const queryBudgetGuard = () => (req, res, next) => {
    if (String(req.method || '').toUpperCase() !== 'GET') return next();
    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    if (!SEARCH_CLASSES.has(budget.routeClass)) return next();

    const maxPageSize = budget.routeClass === ROUTE_CLASSES.ADMIN_READ ? 200 : 100;
    const limit = parseLimit(req.query?.limit ?? req.query?.pageSize);
    const search = String(req.query?.search || req.query?.q || req.query?.query || '').trim();
    const unsafeLimit = limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > maxPageSize);
    const unsafeSearch = search.length > 160;

    if (!unsafeLimit && !unsafeSearch) return next();

    const reason = unsafeLimit ? 'query_limit' : 'query_search_length';
    recordTrafficBudgetDenied({ routeClass: budget.routeClass, reason });
    logger.warn('traffic.query_budget_denied', {
        requestId: req.requestId || '',
        routeClass: budget.routeClass,
        reason,
        path: req.originalUrl || req.path,
    });
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({
        success: false,
        code: 'QUERY_BUDGET_EXCEEDED',
        message: 'Query budget exceeded for this route.',
        requestId: req.requestId || '',
    });
};

module.exports = { queryBudgetGuard };
