const crypto = require('crypto');
const packageJson = require('../package.json');

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

const buildHealthMetadata = () => ({
    service: normalizeText(
        process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME,
        'aura-marketplace-api'
    ),
    version: normalizeText(
        process.env.SERVICE_VERSION || packageJson.version,
        packageJson.version
    ),
    environment: normalizeText(
        process.env.APP_ENV || process.env.NODE_ENV,
        'production'
    ),
});

// `detailed: false` is the anonymous production shape. Service/version/
// environment name the deployable and its exact version, and db/redis disclose
// the backing datastores — all of it useful for fingerprinting a target and
// none of it needed by the liveness/banner callers. `/health` previously
// returned the full payload on the unauthenticated branch while `/health/live`
// was gated, so the two disagreed on what counts as public.
const buildPublicHealthPayload = ({
    status = 'degraded',
    core = {},
    uptime = 0,
    timestamp = new Date().toISOString(),
    detailed = true,
} = {}) => {
    if (!detailed) {
        return { status, timestamp };
    }

    return {
        status,
        ...buildHealthMetadata(),
        db: core.dbConnected ? 'connected' : 'disconnected',
        uptime,
        timestamp,
        redis: {
            connected: Boolean(core.redisConnected),
        },
    };
};

module.exports = {
    buildHealthMetadata,
    buildPublicHealthPayload,
    hasDetailedHealthTokenAccess,
    isProductionRuntime,
    shouldFailClosedMissingHealthReadyToken,
    shouldExposeDetailedHealth,
};
