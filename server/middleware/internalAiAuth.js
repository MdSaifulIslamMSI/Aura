const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const requireInternalAiAuth = (req, res, next) => {
    const expectedSecret = String(
        process.env.AI_INTERNAL_TOOL_SECRET
        || process.env.CRON_SECRET
        || ''
    ).trim();
    const authHeader = String(req.headers.authorization || '').trim();

    if (!expectedSecret) {
        logger.error('internal_ai_auth.misconfigured', {
            path: req.originalUrl,
            requestId: req.requestId || '',
        });
        return next(new AppError('Internal AI authentication is not configured', 503));
    }

    if (!safeEqual(authHeader, `Bearer ${expectedSecret}`)) {
        logger.warn('internal_ai_auth.rejected', {
            path: req.originalUrl,
            requestId: req.requestId || '',
            userAgent: req.headers['user-agent'] || '',
        });
        return next(new AppError('Unauthorized internal AI request', 401));
    }

    req.internalAi = {
        source: String(req.headers['x-intelligence-service'] || 'authorized_client'),
    };

    return next();
};

module.exports = {
    requireInternalAiAuth,
};
