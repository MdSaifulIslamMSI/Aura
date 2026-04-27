const express = require('express');
const {
    establishSessionCookie,
    generateBackupRecoveryCodes,
    getSession,
    logoutSession,
    requestBootstrapDeviceChallenge,
    syncSession,
    completePhoneFactorLogin,
    completePhoneFactorVerification,
    verifyBackupRecoveryCode,
    verifyDeviceChallenge,
} = require('../controllers/authController');
const { protect, protectOptional, protectPhoneFactorProof } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { loginSchema } = require('../validators/userValidators');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    csrfTokenGenerator,
    csrfTokenValidator,
    csrfTokenValidatorUnlessBearerAuth,
} = require('../middleware/csrfMiddleware');
const otpRoutes = require('./otpRoutes');

const router = express.Router();

const csrfTokenValidatorForCookieSession = (req, res, next) => {
    if (!req.authSession?.sessionId) {
        return next();
    }
    return csrfTokenValidator(req, res, next);
};

const authSyncLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_sync',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 600 : 200,
    message: 'Too many session sync requests, please try again after 15 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email || req.ip;
    },
});

const recoveryCodeLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_recovery_code',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 20,
    message: 'Too many recovery code attempts, please try again after 15 minutes',
    keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email || req.ip;
    },
});

const bootstrapDeviceChallengeLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_bootstrap_device_challenge',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many trusted device challenge requests, please try again after 5 minutes',
    keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const deviceId = typeof req.headers?.['x-aura-device-id'] === 'string'
            ? req.headers['x-aura-device-id'].trim()
            : '';
        return [email, deviceId, req.ip].filter(Boolean).join(':');
    },
});

const phoneFactorCompletionLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_phone_factor_completion',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many phone verification attempts, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const deviceId = typeof req.headers?.['x-aura-device-id'] === 'string'
            ? req.headers['x-aura-device-id'].trim()
            : '';
        return [email, deviceId, req.ip].filter(Boolean).join(':');
    },
});

const trustedDeviceVerificationLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_verify_device',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many trusted device verification attempts, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        const deviceId = typeof req.headers?.['x-aura-device-id'] === 'string'
            ? req.headers['x-aura-device-id'].trim()
            : '';
        return [deviceId, req.ip].filter(Boolean).join(':');
    },
});

router.post('/exchange', protect, establishSessionCookie, csrfTokenGenerator, getSession);
router.get('/session', protect, establishSessionCookie, csrfTokenGenerator, getSession);
router.post('/sync', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, authSyncLimiter, validate(loginSchema), syncSession);
router.post('/logout', protectOptional, csrfTokenValidatorForCookieSession, logoutSession);
router.post('/bootstrap-device-challenge', bootstrapDeviceChallengeLimiter, requestBootstrapDeviceChallenge);
router.post('/recovery-codes', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, generateBackupRecoveryCodes);
router.post('/recovery-codes/verify', recoveryCodeLimiter, verifyBackupRecoveryCode);
router.post('/complete-phone-factor-login', protect, phoneFactorCompletionLimiter, completePhoneFactorLogin);
router.post('/complete-phone-factor-verification', protectPhoneFactorProof, phoneFactorCompletionLimiter, completePhoneFactorVerification);
router.post('/verify-device', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, trustedDeviceVerificationLimiter, verifyDeviceChallenge);
router.use('/otp', otpRoutes);

module.exports = router;
