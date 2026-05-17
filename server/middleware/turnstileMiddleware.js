const AppError = require('../utils/AppError');
const { getTurnstileFlags } = require('../config/turnstileFlags');
const logger = require('../utils/logger');

const TOKEN_BODY_FIELDS = [
    'turnstileToken',
    'cfTurnstileResponse',
    'cf-turnstile-response',
];

const getRequestToken = (req) => {
    for (const field of TOKEN_BODY_FIELDS) {
        const value = req.body?.[field];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    const headerValue = req.headers?.['cf-turnstile-response'] || req.headers?.['x-turnstile-token'];
    return typeof headerValue === 'string' ? headerValue.trim() : '';
};

const shouldBypassInTest = (token, flags) => (
    process.env.NODE_ENV === 'test'
    && flags.testBypassToken
    && token === flags.testBypassToken
);

const verifyTurnstileToken = async ({ token, remoteIp, flags = getTurnstileFlags() }) => {
    if (!flags.enabled) {
        return { success: true, skipped: true };
    }

    if (!flags.secretKey) {
        return {
            success: !flags.failClosed,
            errorCodes: ['missing-secret'],
        };
    }

    if (!token) {
        return {
            success: false,
            errorCodes: ['missing-input-response'],
        };
    }

    if (shouldBypassInTest(token, flags)) {
        return { success: true, testBypass: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(flags.timeoutMs || 3000, 250));

    try {
        const body = new URLSearchParams();
        body.set('secret', flags.secretKey);
        body.set('response', token);
        if (remoteIp) body.set('remoteip', remoteIp);

        const response = await fetch(flags.siteverifyUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
            signal: controller.signal,
        });

        const result = await response.json().catch(() => ({}));
        return {
            success: Boolean(response.ok && result.success),
            status: response.status,
            errorCodes: Array.isArray(result['error-codes']) ? result['error-codes'] : [],
            challengeTs: result.challenge_ts,
            hostname: result.hostname,
        };
    } catch (error) {
        return {
            success: !flags.failClosed,
            errorCodes: [error?.name === 'AbortError' ? 'siteverify-timeout' : 'siteverify-error'],
        };
    } finally {
        clearTimeout(timeout);
    }
};

const requireTurnstile = (options = {}) => async (req, res, next) => {
    const flags = getTurnstileFlags();
    if (!flags.enabled) return next();

    const token = getRequestToken(req);
    const verification = await verifyTurnstileToken({
        token,
        remoteIp: req.ip,
        flags,
    });

    if (verification.success) return next();

    logger.warn('turnstile.verification_failed', {
        route: options.routeName || req.originalUrl || req.path,
        errorCodes: verification.errorCodes || [],
        status: verification.status,
    });

    return next(new AppError('Human verification failed. Please refresh and try again.', 403));
};

module.exports = {
    requireTurnstile,
    verifyTurnstileToken,
    getRequestToken,
};
