const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getOtpChallenge, sendOtp, verifyOtp, resetPasswordWithOtp, checkUserExists } = require('../controllers/otpController');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireTurnstile } = require('../middleware/turnstileMiddleware');

const RESET_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const RESET_PASSWORD_FLOW_MAX = 5;
const RESET_PASSWORD_NETWORK_MAX = 40;

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
router.post('/send', requireTurnstile({ routeName: 'otp_send' }), otpLimiter, sendOtp);
router.post('/verify', requireTurnstile({ routeName: 'otp_verify' }), verifyLimiter, verifyOtp);
router.post('/reset-password', requireTurnstile({ routeName: 'otp_reset_password' }), resetPasswordNetworkLimiter, resetPasswordLimiter, resetPasswordWithOtp);
router.post('/check-user', requireTurnstile({ routeName: 'otp_check_user' }), checkUserLimiter, checkUserExists);

module.exports = router;
