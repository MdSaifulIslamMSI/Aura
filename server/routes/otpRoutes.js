const express = require('express');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const { getOtpChallenge, sendOtp, verifyOtp, resetPasswordWithOtp, checkUserExists } = require('../controllers/otpController');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireTurnstile } = require('../middleware/turnstileMiddleware');
const { startTrafficBudgetCommit } = require('../middleware/requestTimeouts');

const RESET_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const RESET_PASSWORD_FLOW_MAX = 5;
const RESET_PASSWORD_NETWORK_MAX = 40;

// Turnstile and abuse limiters must finish before OTP/password state can own
// the response. Once admitted, do not emit a timeout while that state commits.
const beginAtomicOtpResponse = (req, res, next) => {
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    return next();
};

const parseRateLimitKeyPart = (value) => String(value || '').trim();

const hashRateLimitKeyPart = (value) => crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 32);

const getRequestIp = (req) => parseRateLimitKeyPart(req.ip || req.socket?.remoteAddress || 'unknown');

const resetPasswordFlowRateLimitKey = (req) => {
    const flowToken = parseRateLimitKeyPart(req.body?.flowToken);
    if (flowToken) {
        return `flow:${hashRateLimitKeyPart(flowToken)}`;
    }

    return `ip:${hashRateLimitKeyPart(getRequestIp(req))}`;
};

const resetPasswordNetworkRateLimitKey = (req) => `ip:${hashRateLimitKeyPart(getRequestIp(req))}`;

const otpLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    securityCritical: true,
    name: 'otp_send',
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 3, // Max 3 OTP requests per minute per IP
    message: 'Too many OTP requests. Please wait a minute before trying again.',
});

const verifyLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    securityCritical: true,
    name: 'otp_verify',
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Max 5 verification attempts per 5 minutes per IP
    message: 'Too many verification attempts. Please wait before trying again.',
});

const resetPasswordNetworkLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    securityCritical: true,
    name: 'otp_reset_password_ip_abuse',
    windowMs: RESET_PASSWORD_WINDOW_MS,
    max: RESET_PASSWORD_NETWORK_MAX,
    keyGenerator: resetPasswordNetworkRateLimitKey,
    message: 'Too many password reset attempts from this network. Please wait before trying again.',
});

const resetPasswordScannerRateLimit = rateLimit({
    windowMs: RESET_PASSWORD_WINDOW_MS,
    limit: process.env.NODE_ENV === 'development' ? 1000 : RESET_PASSWORD_NETWORK_MAX * 2,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many password reset attempts. Please wait before trying again.' },
});

const resetPasswordLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    securityCritical: true,
    name: 'otp_reset_password',
    windowMs: RESET_PASSWORD_WINDOW_MS,
    max: RESET_PASSWORD_FLOW_MAX,
    keyGenerator: resetPasswordFlowRateLimitKey,
    message: 'Too many password reset attempts. Please wait before trying again.',
});

const checkUserLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    securityCritical: true,
    name: 'otp_check_user',
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // Max 20 account checks per 5 minutes per IP
    message: 'Too many account checks. Please wait before trying again.',
});

router.post('/challenge', checkUserLimiter, getOtpChallenge);
router.post('/send', requireTurnstile({ routeName: 'otp_send' }), otpLimiter, beginAtomicOtpResponse, sendOtp);
router.post('/verify', requireTurnstile({ routeName: 'otp_verify' }), verifyLimiter, beginAtomicOtpResponse, verifyOtp);
router.post('/reset-password', resetPasswordScannerRateLimit, requireTurnstile({ routeName: 'otp_reset_password' }), resetPasswordNetworkLimiter, resetPasswordLimiter, beginAtomicOtpResponse, resetPasswordWithOtp);
router.post('/check-user', requireTurnstile({ routeName: 'otp_check_user' }), checkUserLimiter, checkUserExists);

module.exports = router;
