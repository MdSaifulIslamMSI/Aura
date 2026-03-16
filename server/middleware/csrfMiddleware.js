const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * CSRF Protection Middleware
 * 
 * Simple token-based CSRF protection without external dependencies.
 * - Generates CSRF tokens and stores in session/memory (can be Redis-backed)
 * - Validates tokens on state-changing operations (POST, PUT, DELETE)
 * - Compatible with SameSite=Strict cookies
 */

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// In-memory token storage (in production, use Redis)
const tokenStore = new Map();

const generateCsrfToken = () => {
    const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
    return token;
};

const storeCsrfToken = (token, metadata = {}) => {
    const createdAt = Date.now();
    const expiresAt = createdAt + CSRF_TOKEN_TTL_MS;
    
    tokenStore.set(token, {
        createdAt,
        expiresAt,
        metadata,
    });
    
    // Cleanup expired tokens periodically
    if (tokenStore.size > 10000) {
        for (const [key, value] of tokenStore.entries()) {
            if (value.expiresAt < Date.now()) {
                tokenStore.delete(key);
            }
        }
    }
    
    return token;
};

const verifyCsrfToken = (token) => {
    if (!token || typeof token !== 'string') {
        return false;
    }
    
    const stored = tokenStore.get(token);
    if (!stored) {
        return false;
    }
    
    if (stored.expiresAt < Date.now()) {
        tokenStore.delete(token);
        return false;
    }
    
    // Consume token (one-time use)
    tokenStore.delete(token);
    return true;
};

/**
 * Middleware to generate and attach CSRF token to requests (e.g., GET endpoints)
 */
const csrfTokenGenerator = (req, res, next) => {
    const token = generateCsrfToken();
    storeCsrfToken(token, {
        uid: req.user?.id || req.authUid || 'anonymous',
        email: req.user?.email || req.authToken?.email || null,
        ip: req.ip,
    });
    
    // Attach token to response headers and request object
    res.setHeader('X-CSRF-Token', token);
    req.csrfToken = token;
    
    logger.debug('csrf.token_generated', {
        uid: req.authUid || 'anonymous',
        ip: req.ip,
        path: req.path,
        timestamp: new Date().toISOString()
    });
    
    next();
};

/**
 * Middleware to validate CSRF token on state-changing operations
 */
const csrfTokenValidator = (req, res, next) => {
    // CSRF validation only needed for state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    
    // Get token from request
    // Priority: header > body > query
    const token =
        req.headers['x-csrf-token'] ||
        req.body?.csrfToken ||
        req.query?.csrfToken;
    
    if (!token) {
        logger.warn('csrf.token_missing', {
            method: req.method,
            path: req.path,
            ip: req.ip,
            uid: req.authUid || 'anonymous',
            timestamp: new Date().toISOString()
        });
        return next({
            statusCode: 403,
            message: 'CSRF token is missing',
            code: 'CSRF_TOKEN_MISSING',
        });
    }
    
    if (!verifyCsrfToken(token)) {
        logger.warn('csrf.token_invalid', {
            method: req.method,
            path: req.path,
            ip: req.ip,
            uid: req.authUid || 'anonymous',
            tokenLength: token.length,
            timestamp: new Date().toISOString()
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
        timestamp: new Date().toISOString()
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
};
