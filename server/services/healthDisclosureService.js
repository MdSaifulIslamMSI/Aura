const crypto = require('crypto');

const normalizeText = (value, fallback = '') => String(
    value === undefined || value === null ? fallback : value
).trim();

const safeTimingEqual = (candidate = '', expected = '') => {
    const candidateBuffer = Buffer.from(String(candidate), 'utf8');
    const expectedBuffer = Buffer.from(String(expected), 'utf8');
    return candidateBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
};

const isProductionRuntime = (runtimeNodeEnv = process.env.NODE_ENV || 'production') => (
    normalizeText(runtimeNodeEnv, 'production').toLowerCase() === 'production'
);

const getHeader = (req, headerName) => {
    if (!req) return '';
    if (typeof req.get === 'function') return normalizeText(req.get(headerName));
    const headers = req.headers || {};
    return normalizeText(headers[headerName] || headers[headerName.toLowerCase()]);
};

const hasDetailedHealthTokenAccess = ({ req, healthReadyToken = '' } = {}) => {
    const expectedToken = normalizeText(healthReadyToken);
    if (!expectedToken) return false;
    const providedToken = getHeader(req, 'x-health-token');
    return Boolean(providedToken) && safeTimingEqual(providedToken, expectedToken);
};

const shouldExposeDetailedHealth = ({
    req = null,
    healthReadyToken = '',
    runtimeNodeEnv = process.env.NODE_ENV || 'production',
} = {}) => {
    if (!isProductionRuntime(runtimeNodeEnv)) return true;
    return hasDetailedHealthTokenAccess({ req, healthReadyToken });
};

const shouldFailClosedMissingHealthReadyToken = ({
    healthReadyToken = '',
    runtimeNodeEnv = process.env.NODE_ENV || 'production',
} = {}) => (
    isProductionRuntime(runtimeNodeEnv)
    && !normalizeText(healthReadyToken)
);

const buildPublicHealthPayload = ({
    status = 'degraded',
    core = {},
    uptime = 0,
    timestamp = new Date().toISOString(),
} = {}) => ({
    status,
    db: core.dbConnected ? 'connected' : 'disconnected',
    uptime,
    timestamp,
    redis: {
        connected: Boolean(core.redisConnected),
    },
});

module.exports = {
    buildPublicHealthPayload,
    hasDetailedHealthTokenAccess,
    isProductionRuntime,
    shouldFailClosedMissingHealthReadyToken,
    shouldExposeDetailedHealth,
};
