const normalizeOrigin = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
        return new URL(raw.includes('://') ? raw : `https://${raw}`).origin;
    } catch {
        return raw.replace(/\/+$/, '');
    }
};

const parseOrigins = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return [];

    return Array.from(new Set(
        raw
            .split(',')
            .map((origin) => normalizeOrigin(origin))
            .filter(Boolean)
    ));
};

const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProduction = nodeEnv === 'production';
const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const hostedProductionOrigins = [
    'https://aurapilot.vercel.app',
    'https://aurapilot.netlify.app',
];

const collectConfiguredOrigins = () => {
    const configuredOrigins = [
        ...parseOrigins(process.env.CORS_ORIGIN),
        normalizeOrigin(process.env.FRONTEND_URL),
        normalizeOrigin(process.env.APP_PUBLIC_URL),
        normalizeOrigin(process.env.VERCEL_FRONTEND_URL),
        normalizeOrigin(process.env.NETLIFY_FRONTEND_URL),
    ].filter(Boolean);

    const fallbackOrigins = isProduction ? hostedProductionOrigins : defaultDevOrigins;
    return Array.from(new Set([
        ...configuredOrigins,
        ...fallbackOrigins.map((origin) => normalizeOrigin(origin)).filter(Boolean),
    ]));
};

const allowedOrigins = collectConfiguredOrigins();

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
    return allowedOrigins.includes(normalizeOrigin(origin));
};

module.exports = {
    nodeEnv,
    isProduction,
    allowedOrigins,
    assertProductionCorsConfig,
    isOriginAllowed,
};
