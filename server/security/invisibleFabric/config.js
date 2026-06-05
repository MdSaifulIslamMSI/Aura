const HTTP_HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/i;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const normalizeText = (value = '') => String(value || '').trim();

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value).toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
};

const hasEnv = (env = {}, key = '') => Object.prototype.hasOwnProperty.call(env, key)
    && env[key] !== undefined
    && env[key] !== '';

const isProductionRuntime = (env = process.env) => {
    const nodeEnv = normalizeText(env.NODE_ENV).toLowerCase();
    const appEnv = normalizeText(env.APP_ENV || env.SMOKE_TARGET_ENV).toLowerCase();
    return nodeEnv === 'production' || appEnv === 'production';
};

const normalizeHeaderName = (value = 'x-aura-edge-secret') => (
    normalizeText(value || 'x-aura-edge-secret').toLowerCase()
);

const getInvisibleFabricConfig = (env = process.env) => {
    const production = isProductionRuntime(env);
    const enabled = parseBoolean(env.INVISIBLE_FABRIC_ENABLED, production);
    const requireTrustedEdge = parseBoolean(env.INVISIBLE_REQUIRE_TRUSTED_EDGE, false);

    return {
        enabled,
        production,
        requireTrustedEdge,
        trustedEdgeHeader: normalizeHeaderName(env.INVISIBLE_TRUSTED_EDGE_HEADER),
        trustedEdgeSecret: normalizeText(env.INVISIBLE_TRUSTED_EDGE_SECRET),
        cloakAdmin: parseBoolean(env.INVISIBLE_CLOAK_ADMIN, enabled && production),
        cloakInternalRoutes: parseBoolean(env.INVISIBLE_CLOAK_INTERNAL_ROUTES, enabled && production),
        blockProdDebug: parseBoolean(env.INVISIBLE_BLOCK_PROD_DEBUG, true),
        routeClassificationRequired: parseBoolean(env.INVISIBLE_ROUTE_CLASSIFICATION_REQUIRED, enabled && production),
        honeypotsEnabled: parseBoolean(env.INVISIBLE_HONEYPOTS_ENABLED, enabled && production),
        replayGuardEnabled: parseBoolean(
            env.INVISIBLE_REPLAY_GUARD_ENABLED,
            parseBoolean(env.AUTH_SHIELD_REPLAY_GUARD_ENABLED, true)
        ),
        responseMinimization: parseBoolean(env.INVISIBLE_RESPONSE_MINIMIZATION, enabled && production),
        publicRouteManifestRequired: parseBoolean(env.INVISIBLE_PUBLIC_ROUTE_MANIFEST_REQUIRED, enabled && production),
        auditEnabled: parseBoolean(env.INVISIBLE_AUDIT_ENABLED, true),
        explicitTrustedEdgeRequirement: hasEnv(env, 'INVISIBLE_REQUIRE_TRUSTED_EDGE'),
    };
};

const assertInvisibleFabricConfig = (env = process.env) => {
    const config = getInvisibleFabricConfig(env);
    if (!config.enabled) return config;

    if (!HTTP_HEADER_TOKEN.test(config.trustedEdgeHeader)) {
        throw new Error('INVISIBLE_TRUSTED_EDGE_HEADER must be a valid HTTP header token.');
    }

    if (config.requireTrustedEdge && !config.trustedEdgeSecret) {
        throw new Error('INVISIBLE_TRUSTED_EDGE_SECRET is required when INVISIBLE_REQUIRE_TRUSTED_EDGE=true.');
    }

    if (config.requireTrustedEdge && config.production && config.trustedEdgeSecret.length < 16) {
        throw new Error('INVISIBLE_TRUSTED_EDGE_SECRET must be at least 16 characters in production.');
    }

    if (config.production && config.blockProdDebug) {
        const debugSignals = [
            env.NODE_OPTIONS,
            env.DEBUG,
            env.EXPRESS_DEBUG,
        ].map(normalizeText).filter(Boolean);
        if (debugSignals.some((value) => /--inspect|express:|\*/i.test(value))) {
            throw new Error('Production debug flags are not allowed while INVISIBLE_BLOCK_PROD_DEBUG=true.');
        }
    }

    return config;
};

module.exports = {
    assertInvisibleFabricConfig,
    getInvisibleFabricConfig,
    isProductionRuntime,
    normalizeHeaderName,
    parseBoolean,
};
