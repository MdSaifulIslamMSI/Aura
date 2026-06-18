const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');

const PRIVATE_CLASSES = new Set([
    ROUTE_CLASSES.AUTH_LOGIN,
    ROUTE_CLASSES.OTP,
    ROUTE_CLASSES.OTP_RESET,
    ROUTE_CLASSES.AUTHENTICATED_READ,
    ROUTE_CLASSES.AUTHENTICATED_WRITE,
    ROUTE_CLASSES.PAYMENT,
    ROUTE_CLASSES.WEBHOOK,
    ROUTE_CLASSES.ADMIN_READ,
    ROUTE_CLASSES.ADMIN_WRITE,
    ROUTE_CLASSES.UPLOAD,
    ROUTE_CLASSES.AI_EXPENSIVE,
    ROUTE_CLASSES.HEALTH,
]);

const cachePolicy = () => (req, res, next) => {
    const budget = req.trafficBudget || getTrafficBudget(req.trafficRouteClass);
    if (PRIVATE_CLASSES.has(budget.routeClass)) {
        res.set('Cache-Control', 'no-store');
        return next();
    }
    if (budget.cacheMode === 'public-static') {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return next();
    }
    if (budget.cacheMode === 'status-public') {
        res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
        return next();
    }
    if (budget.cacheMode === 'public-short') {
        res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    }
    return next();
};

module.exports = { cachePolicy };
