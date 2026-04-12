const crypto = require('crypto');
const logger = require('../utils/logger');
const { getRedisClient, flags: redisFlags } = require('../config/redis');

/**
 * CSRF Protection Middleware
 *
 * Simple token-based CSRF protection without external dependencies.
 * - Generates CSRF tokens and stores in Redis for multi-instance consistency
 * - Validates tokens on state-changing operations (POST, PUT, DELETE)
 * - Compatible with SameSite=Strict cookies
 */

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const CSRF_TOKEN_PREFIX = `${redisFlags.redisPrefix}:csrf:token:`;
const CSRF_STRICT_CLIENT_SIGNALS = ['1', 'true', 'yes', 'on']
    .includes(String(process.env.CSRF_STRICT_CLIENT_SIGNALS || '').trim().toLowerCase());
const buildTokenKey = (token) => `${CSRF_TOKEN_PREFIX}${token}`;

const getStrictOrigin = (req) => {
    const explicitOrigin = req.headers?.origin;
    if (explicitOrigin) return explicitOrigin;

    const referer = req.headers?.referer;
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch (_) {
            return null;
        }
    }

    const host = req.headers?.host;
    if (!host) return null;
    const protocol = req.protocol || 'https';
    return `${protocol}://${host}`;
};

const getRequestContext = (req) => ({
    uid: req.user?.id || req.user?._id || req.authUid || 'anonymous',
    sessionId: req.authSession?.sessionId || req.sessionID || req.headers?.['x-session-id'] || null,
    deviceFingerprint: req.headers?.['x-device-fingerprint'] || null,
    strictOrigin: getStrictOrigin(req),
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
});

const normalizeUserAgent = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const generateCsrfToken = () => {
    const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
    return token;
};

const storeCsrfToken = async (token, metadata = {}) => {
    const createdAt = Date.now();
    const expiresAt = createdAt + CSRF_TOKEN_TTL_MS;

    const record = {
        createdAt,
        expiresAt,
        metadata: {
            ...metadata,
            uid: metadata.uid || 'anonymous',
        },
    };

    const client = getRedisClient();
    if (!client) {
        logger.warn('csrf.redis_unavailable_store', { uid: record.metadata.uid });
        return token;
    }

    await client.setEx(buildTokenKey(token), Math.ceil(CSRF_TOKEN_TTL_MS / 1000), JSON.stringify(record));

    return token;
};

const verifyCsrfToken = async (token, requestContext = {}) => {
    if (!token || typeof token !== 'string') {
        return false;
    }

    const client = getRedisClient();
    if (!client) {
        logger.warn('csrf.redis_unavailable_verify');
        return false;
    }

    const storedRaw = await client.get(buildTokenKey(token));
    if (!storedRaw) {
        return false;
    }

    let stored;
    try {
        stored = JSON.parse(storedRaw);
    } catch (_) {
        await client.del(buildTokenKey(token));
        return false;
    }

    if (stored.expiresAt < Date.now()) {
        await client.del(buildTokenKey(token));
        return false;
    }

    const metadata = stored.metadata || {};
    const context = requestContext || {};

    const expectedUid = metadata.uid || 'anonymous';
    const currentUid = context.uid || 'anonymous';

    if (currentUid !== expectedUid) {
        logger.warn('csrf.principal_mismatch', {
            requestUid: currentUid,
            tokenOwnerUid: expectedUid,
            ip: context.ip || null,
            timestamp: new Date().toISOString(),
        });
        return false;
    }

    if (metadata.strictOrigin && context.strictOrigin !== metadata.strictOrigin) {
        return false;
    }

    if (metadata.sessionId && context.sessionId !== metadata.sessionId) {
        return false;
    }

    if (metadata.deviceFingerprint && context.deviceFingerprint !== metadata.deviceFingerprint) {
        return false;
    }

    // IP and UserAgent check (respecting CSRF_STRICT_CLIENT_SIGNALS)
    const storedIp = metadata.ip || '';
    const storedUserAgent = normalizeUserAgent(metadata.userAgent);
    const requestIp = context.ip || '';
    const requestUserAgent = normalizeUserAgent(context.userAgent);

    const ipMismatch = Boolean(storedIp && requestIp && storedIp !== requestIp);
    const userAgentMismatch = Boolean(
        storedUserAgent &&
        requestUserAgent &&
        storedUserAgent !== requestUserAgent
    );

    if (ipMismatch || userAgentMismatch) {
        const signalPayload = {
            strictMode: CSRF_STRICT_CLIENT_SIGNALS,
            ipMismatch,
            userAgentMismatch,
            storedIp,
            requestIp,
            storedUserAgent,
            requestUserAgent,
        };

        if (CSRF_STRICT_CLIENT_SIGNALS) {
            logger.warn('csrf.client_signal_mismatch_rejected', signalPayload);
            return false;
        }

        logger.warn('csrf.client_signal_mismatch_detected', signalPayload);
    }

    // Consume token (one-time use)
    await client.del(buildTokenKey(token));
    return true;
};

/**
 * Middleware to generate and attach CSRF token to requests (e.g., GET endpoints)
 */
const csrfTokenGenerator = async (req, res, next) => {
    const token = generateCsrfToken();
    const context = getRequestContext(req);
    await storeCsrfToken(token, context);
    // Attach token to response headers and request object
    res.setHeader('X-CSRF-Token', token);
    req.csrfToken = token;

    logger.debug('csrf.token_generated', {
        uid: context.uid,
        ip: context.ip,
        path: req.path,
        timestamp: new Date().toISOString(),
    });

    next();
};

/**
 * Middleware to validate CSRF token on state-changing operations
 */
const csrfTokenValidator = async (req, res, next) => {
    // CSRF validation only needed for state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const headerToken = req.headers['x-csrf-token'];
    const bodyToken = req.body?.csrfToken;
    const queryToken = req.query?.csrfToken;
    const isAuthenticated = Boolean(req.user?.id || req.authUid);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const accepts = String(req.headers.accept || '').toLowerCase();
    const isJsonRequest = contentType.includes('application/json') || accepts.includes('application/json');

    if (isAuthenticated && isJsonRequest && !headerToken && (bodyToken || queryToken)) {
        logger.warn('csrf.token_transport_rejected', {
            method: req.method,
            path: req.path,
            uid: req.authUid || req.user?.id || 'anonymous',
            transport: bodyToken ? 'body' : 'query',
        });
        return next({
            statusCode: 403,
            message: 'CSRF token must be sent via X-CSRF-Token header',
            code: 'CSRF_TOKEN_HEADER_REQUIRED',
        });
    }

    // Priority: header > body > query
    const token = headerToken || bodyToken || queryToken;

    if (!token) {
        logger.warn('csrf.token_missing', {
            method: req.method,
            path: req.path,
            ip: req.ip,
            uid: req.authUid || 'anonymous',
            timestamp: new Date().toISOString(),
        });
        return next({
            statusCode: 403,
            message: 'CSRF token is missing',
            code: 'CSRF_TOKEN_MISSING',
        });
    }

    const context = getRequestContext(req);
    if (!await verifyCsrfToken(token, context)) {
        logger.warn('csrf.token_invalid', {
            method: req.method,
            path: req.path,
            ip: req.ip,
            uid: context.uid,
            tokenLength: token.length,
            timestamp: new Date().toISOString(),
        });
        return next({
            statusCode: 403,
            message: 'CSRF token is invalid or expired',
            code: 'CSRF_TOKEN_INVALID',
        });
    }

    // Token validated successfully
    logger.debug('csrf.token_valid', {
        method: req.method,
        path: req.path,
        uid: req.authUid || 'anonymous',
        timestamp: new Date().toISOString(),
    });

    req.csrfValidated = true;
    next();
};

/**
 * Middleware to apply CSRF protection to specific routes
 * Returns both generator and validator for flexibility
 */
const csrf = (options = {}) => {
    const requireToken = options.requireToken !== false;

    return [
        csrfTokenGenerator,
        ...(requireToken ? [csrfTokenValidator] : []),
    ];
};

module.exports = {
    csrf,
    csrfTokenGenerator,
    csrfTokenValidator,
    generateCsrfToken,
    storeCsrfToken,
    verifyCsrfToken,
    __resetCsrfTokenStore: () => {
        // In-memory store was removed in favor of Redis.
    },
};
