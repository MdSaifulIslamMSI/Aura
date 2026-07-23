const express = require('express');
const { establishSessionCookie } = require('../controllers/authController');
const {
    completeAdminPasskeyChallenge,
    completeAdminPasskeyEnrollment,
    exchangeRecoveryGrant,
    getAdminSecurityStatus,
    startAdminPasskeyChallenge,
    startAdminPasskeyEnrollment,
} = require('../controllers/adminSecurityController');
const { protect } = require('../middleware/authMiddleware');
const { csrfTokenGenerator } = require('../middleware/csrfMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { startTrafficBudgetCommit } = require('../middleware/requestTimeouts');
const { buildRateLimitKey } = require('../services/adminRecoveryGrantService');

const router = express.Router();

const beginAtomicAuthResponse = (req, res, next) => {
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    return next();
};

const statusLimiter = createDistributedRateLimit({
    name: 'admin_security_status',
    windowMs: 60 * 1000,
    max: 30,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('status', req),
});

const recoveryExchangeLimiter = createDistributedRateLimit({
    name: 'admin_recovery_exchange',
    windowMs: 15 * 60 * 1000,
    max: 5,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('recovery_exchange', req),
    message: {
        success: false,
        code: 'ADMIN_RECOVERY_RATE_LIMITED',
        message: 'Too many recovery attempts. Wait before trying again.',
    },
});

const passkeyOptionsLimiter = createDistributedRateLimit({
    name: 'admin_security_passkey_options',
    windowMs: 5 * 60 * 1000,
    max: 10,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('passkey_options', req),
});

const passkeyVerifyLimiter = createDistributedRateLimit({
    name: 'admin_security_passkey_verify',
    windowMs: 15 * 60 * 1000,
    max: 8,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('passkey_verify', req),
});

router.get('/status', protect, statusLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenGenerator, getAdminSecurityStatus);
router.post('/recovery/exchange', protect, recoveryExchangeLimiter, beginAtomicAuthResponse, establishSessionCookie, exchangeRecoveryGrant);
router.post('/passkeys/enrollment/options', protect, passkeyOptionsLimiter, beginAtomicAuthResponse, establishSessionCookie, startAdminPasskeyEnrollment);
router.post('/passkeys/enrollment/verify', protect, passkeyVerifyLimiter, beginAtomicAuthResponse, establishSessionCookie, completeAdminPasskeyEnrollment);
router.post('/passkeys/challenge/options', protect, passkeyOptionsLimiter, beginAtomicAuthResponse, establishSessionCookie, startAdminPasskeyChallenge);
router.post('/passkeys/challenge/verify', protect, passkeyVerifyLimiter, beginAtomicAuthResponse, establishSessionCookie, completeAdminPasskeyChallenge);

module.exports = router;
