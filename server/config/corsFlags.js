const parseOrigins = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
};

const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProduction = nodeEnv === 'production';
const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const allowedOrigins = (() => {
    const parsed = parseOrigins(process.env.CORS_ORIGIN);
    if (parsed.length > 0) return parsed;
    return isProduction ? [] : defaultDevOrigins;
})();

const assertProductionCorsConfig = () => {
    if (!isProduction) return;
    if (allowedOrigins.length === 0) {
        throw new Error('CORS_ORIGIN must be configured in production');
    }
    if (allowedOrigins.includes('*')) {
        throw new Error('CORS_ORIGIN cannot contain wildcard (*) in production');
    }
};

const isOriginAllowed = (origin) => {
    if (!origin) return true;
    return allowedOrigins.includes(origin);
};

module.exports = {
    nodeEnv,
    isProduction,
    allowedOrigins,
    assertProductionCorsConfig,
    isOriginAllowed,
};
