const { getTrafficBudget, normalizeRoutePath } = require('../config/trafficBudgets');
const { getTrafficPolicyForRoute } = require('../config/trafficPolicyRegistry');

const routeCostClassifier = (req, _res, next) => {
    const trafficPolicy = getTrafficPolicyForRoute({
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl,
    });
    req.trafficPolicy = trafficPolicy;
    req.trafficRouteClass = trafficPolicy.routeClass;
    req.trafficBudget = getTrafficBudget(trafficPolicy.routeClass);
    req.trafficNormalizedPath = normalizeRoutePath(req.path || req.originalUrl || '/');
    return next();
};

module.exports = { routeCostClassifier };
