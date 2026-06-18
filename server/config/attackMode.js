const { ROUTE_CLASSES, isStateChangingMethod, normalizeRoutePath } = require('./trafficBudgets');

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const getAttackModeConfig = (env = process.env) => ({
    trafficFortressEnabled: parseBoolean(env.TRAFFIC_FORTRESS_ENABLED, true),
    attackMode: parseBoolean(env.ATTACK_MODE, false),
    blockAi: parseBoolean(env.ATTACK_MODE_BLOCK_AI, true),
    blockUploads: parseBoolean(env.ATTACK_MODE_BLOCK_UPLOADS, true),
    strictAuth: parseBoolean(env.ATTACK_MODE_STRICT_AUTH, true),
    publicReadOnly: parseBoolean(env.ATTACK_MODE_PUBLIC_READ_ONLY, true),
    statusCacheOnly: parseBoolean(env.ATTACK_MODE_STATUS_CACHE_ONLY, true),
});

const isEmergencyAdminPath = (path = '') => {
    const normalized = normalizeRoutePath(path);
    return normalized.startsWith('/api/admin/emergency-controls') || normalized.startsWith('/admin/emergency-controls');
};

const shouldBlockForAttackMode = ({
    routeClass,
    method,
    path,
    config = getAttackModeConfig(),
} = {}) => {
    if (!config.trafficFortressEnabled || !config.attackMode) return false;
    const routePath = normalizeRoutePath(path);
    if (isEmergencyAdminPath(routePath)) return false;
    if (routeClass === ROUTE_CLASSES.HEALTH) return false;
    if (routeClass === ROUTE_CLASSES.WEBHOOK) return false;
    if (config.statusCacheOnly && routeClass === ROUTE_CLASSES.STATUS_PUBLIC && isStateChangingMethod(method)) return true;
    if (config.blockAi && routeClass === ROUTE_CLASSES.AI_EXPENSIVE) return true;
    if (config.blockUploads && routeClass === ROUTE_CLASSES.UPLOAD && isStateChangingMethod(method)) return true;
    if (config.strictAuth && [ROUTE_CLASSES.AUTH_LOGIN, ROUTE_CLASSES.OTP, ROUTE_CLASSES.OTP_RESET].includes(routeClass)) return true;
    if (config.publicReadOnly && isStateChangingMethod(method)) {
        return [
            ROUTE_CLASSES.PUBLIC_READ,
            ROUTE_CLASSES.PUBLIC_SEARCH,
            ROUTE_CLASSES.AUTHENTICATED_WRITE,
            ROUTE_CLASSES.PAYMENT,
        ].includes(routeClass);
    }
    return false;
};

module.exports = {
    getAttackModeConfig,
    isEmergencyAdminPath,
    shouldBlockForAttackMode,
};
