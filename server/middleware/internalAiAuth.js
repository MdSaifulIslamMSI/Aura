const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    hasInternalAiTokenConfig,
    shouldAllowLegacySecret,
    verifyInternalAiServiceToken,
} = require('../services/internalAiTokenService');

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const requireInternalAiAuth = (req, res, next) => {
    const legacySecret = String(
        process.env.AI_INTERNAL_TOOL_SECRET
        || process.env.CRON_SECRET
        || ''
    ).trim();
    const authHeader = String(req.headers.authorization || '').trim();
    const hasSignedTokenConfig = hasInternalAiTokenConfig();
    const allowLegacySecret = shouldAllowLegacySecret();

    if (!hasSignedTokenConfig && !legacySecret) {
        logger.error('internal_ai_auth.misconfigured', {
            path: req.originalUrl,
            requestId: req.requestId || '',
        });
        return next(new AppError('Internal AI authentication is not configured', 503));
    }

    const bearerPrefix = 'Bearer ';
    if (!authHeader.startsWith(bearerPrefix)) {
        logger.warn('internal_ai_auth.rejected', {
            path: req.originalUrl,
            requestId: req.requestId || '',
            userAgent: req.headers['user-agent'] || '',
            reason: 'missing_bearer_token',
        });
        return next(new AppError('Unauthorized internal AI request', 401));
    }

    const bearerToken = authHeader.slice(bearerPrefix.length).trim();
    let internalAiContext = null;
    let signedTokenError = null;

    if (hasSignedTokenConfig) {
        try {
            const verification = verifyInternalAiServiceToken(bearerToken);
            internalAiContext = {
                authMode: 'signed_token',
                source: verification.source,
                issuer: verification.issuer,
                audience: verification.audience,
                keyVersion: verification.keyVersion,
                tokenVersion: verification.version,
                scope: verification.scope,
            };
        } catch (error) {
            signedTokenError = error;
        }
    }

    if (!internalAiContext && allowLegacySecret && legacySecret && safeEqual(authHeader, `Bearer ${legacySecret}`)) {
        internalAiContext = {
            authMode: 'legacy_secret',
            source: String(req.headers['x-intelligence-service'] || 'authorized_client'),
            issuer: 'legacy_secret',
            audience: '',
            keyVersion: '',
            tokenVersion: 'legacy',
            scope: 'internal:ai',
        };
    }

    if (!internalAiContext) {
        logger.warn('internal_ai_auth.rejected', {
            path: req.originalUrl,
            requestId: req.requestId || '',
            userAgent: req.headers['user-agent'] || '',
            reason: signedTokenError?.message || 'invalid_credentials',
        });
        return next(new AppError('Unauthorized internal AI request', 401));
    }

    req.internalAi = internalAiContext;

    return next();
};

module.exports = {
    requireInternalAiAuth,
};
