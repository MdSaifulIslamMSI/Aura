/**
 * requestTimeout.js — Per-request timeout middleware
 *
 * Aborts hanging requests after a configurable timeout and returns 503.
 * Prevents slow upstream calls (Mongo, AI providers, email) from holding
 * connections open indefinitely and exhausting the event loop.
 *
 * Config:
 *   REQUEST_TIMEOUT_MS  — default 30000 (30 seconds)
 *
 * Routes that legitimately need longer (streaming, bulk exports) should
 * call req.clearTimeout() or pass a custom timeout via the factory.
 */

const logger = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30000;

// Routes exempted from the global timeout (streaming / long-running uploads).
const EXEMPT_PATH_PREFIXES = [
    '/api/ai/stream',
    '/api/uploads',
    '/api/observability',
    '/metrics',
    '/health',
];

const isExempt = (path = '') =>
    EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));

/**
 * createRequestTimeout(ms?) → Express middleware
 */
const createRequestTimeout = (timeoutMs = DEFAULT_TIMEOUT_MS) => (req, res, next) => {
    if (isExempt(req.path)) return next();

    let timedOut = false;

    const timer = setTimeout(() => {
        timedOut = true;
        logger.warn('request.timeout', {
            requestId: req.requestId || '',
            method: req.method,
            path: req.originalUrl,
            timeoutMs,
        });

        if (res.headersSent) return;

        res.status(503).json({
            status: 'error',
            message: 'Request timed out. Please try again.',
            code: 'REQUEST_TIMEOUT',
        });
    }, timeoutMs);

    // Allow downstream handlers to clear the timeout for long operations.
    req.clearTimeout = () => clearTimeout(timer);

    const cleanup = () => {
        clearTimeout(timer);
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);

    next();
};

module.exports = { createRequestTimeout, DEFAULT_TIMEOUT_MS };
