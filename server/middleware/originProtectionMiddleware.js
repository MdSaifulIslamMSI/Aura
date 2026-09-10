const crypto = require('crypto');
const logger = require('../utils/logger');
const { getTrustedRequestIp } = require('../utils/requestIdentity');

const ORIGIN_VERIFY_HEADER = 'x-aura-origin-verify';

const DEFAULT_BYPASS_PATHS = [
    /^\/health(?:\/|$)/i,
    /^\/metrics(?:\/|$)/i,
    /^\/api\/payments\/webhooks\/(?:razorpay|stripe)(?:\/|$)/i,
    /^\/api\/email-webhooks\/resend(?:\/|$)/i,
    // Status webhooks authenticate via their own per-source HMAC or the
    // shared bearer token, and internal callers (Alertmanager on the same
    // host) never traverse CloudFront, so they cannot present the
    // origin-verify header. Same contract as the payment/email webhooks.
    /^\/api\/status\/webhooks\/(?:uptime-kuma|gatus|alertmanager|github-actions)(?:\/|$)/i,
];

const normalizeText = (value = '') => String(value || '').trim();

const getOriginVerifySecret = () => normalizeText(
    process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET
    || process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET
);

const timingSafeEqualText = (candidate = '', expected = '') => {
    const candidateBuffer = Buffer.from(String(candidate));
    const expectedBuffer = Buffer.from(String(expected));
    return candidateBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
};

const shouldBypassOriginProtection = (req = {}) => {
    const path = normalizeText(req.path || req.originalUrl || '').split('?')[0] || '/';
    return DEFAULT_BYPASS_PATHS.some((pattern) => pattern.test(path));
};

const originProtectionMiddleware = (req, res, next) => {
    const expectedSecret = getOriginVerifySecret();
    if (!expectedSecret || shouldBypassOriginProtection(req)) {
        return next();
    }

    const providedSecret = normalizeText(req.get?.(ORIGIN_VERIFY_HEADER) || req.headers?.[ORIGIN_VERIFY_HEADER]);
    if (providedSecret && timingSafeEqualText(providedSecret, expectedSecret)) {
        return next();
    }

    const requestId = req.requestId || req.headers?.['x-request-id'] || '';
    logger.warn('origin_protection.rejected', {
        requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        ip: getTrustedRequestIp(req),
    });

    res.set('Cache-Control', 'no-store');
    return res.status(403).json({
        success: false,
        code: 'ORIGIN_PROTECTION_REQUIRED',
        message: 'Forbidden',
        requestId,
    });
};

module.exports = {
    ORIGIN_VERIFY_HEADER,
    getOriginVerifySecret,
    originProtectionMiddleware,
    shouldBypassOriginProtection,
};
