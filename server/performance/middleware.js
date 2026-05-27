const logger = require('../utils/logger');
const { recordSpan } = require('./otel');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
};

const isPerformanceStackEnabled = () => parseBoolean(process.env.PERFORMANCE_STACK_ENABLED, false);

const isStaticAssetPath = (path = '') =>
    /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|svg|webp|ico|json|txt|woff2?|ttf|otf)$/i.test(path);

const isSafePublicPath = (path = '') =>
    path === '/status'
    || path.startsWith('/status/')
    || path === '/api/status/public'
    || path.startsWith('/api/status/components')
    || path.startsWith('/api/status/incidents')
    || path.startsWith('/api/status/history')
    || path.startsWith('/api/status/maintenance')
    || path.startsWith('/api/status/rss')
    || path.startsWith('/api/products');

const shouldAddPublicCacheHeader = (req, res) => {
    if (!isPerformanceStackEnabled()) return false;
    if (!['GET', 'HEAD'].includes(String(req.method || '').toUpperCase())) return false;
    if (req.headers.authorization || req.headers.cookie) return false;
    if (res.getHeader('Cache-Control')) return false;
    if (res.statusCode >= 400) return false;
    return isSafePublicPath(req.path || req.originalUrl || '');
};

const performanceMiddleware = () => (req, res, next) => {
    if (!isPerformanceStackEnabled()) return next();

    const start = process.hrtime.bigint();
    const slowRequestMs = parseNumber(process.env.SLOW_REQUEST_MS, 1000, { min: 50, max: 60000 });
    const originalWriteHead = res.writeHead;

    res.writeHead = function writeHeadWithPerformanceHeaders(...args) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        if (!res.getHeader('Server-Timing')) {
            res.setHeader('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
        }

        if (shouldAddPublicCacheHeader(req, res)) {
            const ttl = parseNumber(process.env.CACHE_PUBLIC_GET_TTL_SECONDS, 120, { min: 1, max: 86400 });
            const swr = parseNumber(process.env.CACHE_STALE_WHILE_REVALIDATE_SECONDS, 30, { min: 0, max: 86400 });
            res.setHeader('Cache-Control', `public, max-age=${ttl}, stale-while-revalidate=${swr}`);
        }

        return originalWriteHead.apply(this, args);
    };

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        void recordSpan({
            name: 'http.request',
            durationMs,
            attributes: {
                method: req.method,
                path: req.path || req.originalUrl || '',
                status: res.statusCode,
            },
            error: res.statusCode >= 500 ? new Error(`HTTP ${res.statusCode}`) : null,
        });
        if (durationMs >= slowRequestMs) {
            logger.warn('performance.slow_request', {
                method: req.method,
                path: req.originalUrl || req.url,
                status: res.statusCode,
                durationMs: Math.round(durationMs),
                requestId: req.requestId || '',
            });
        }
    });

    return next();
};

const staticAssetHeaders = (res, filePath = '') => {
    if (!isPerformanceStackEnabled()) return;
    const normalizedPath = String(filePath || '');
    if (isStaticAssetPath(normalizedPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
};

module.exports = {
    isPerformanceStackEnabled,
    performanceMiddleware,
    staticAssetHeaders,
};
