const { classifyRoute, getTrafficBudget, normalizeRoutePath } = require('../config/trafficBudgets');

const routeCostClassifier = (req, _res, next) => {
    const routeClass = classifyRoute({
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl,
    });
    req.trafficRouteClass = routeClass;
    req.trafficBudget = getTrafficBudget(routeClass);
    req.trafficNormalizedPath = normalizeRoutePath(req.path || req.originalUrl || '/');
    return next();
};

module.exports = { routeCostClassifier };
