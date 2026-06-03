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
    completeDuoLogin,
    completeEnterpriseLogin,
    verifyBackupRecoveryCode,
    verifyDeviceChallenge,
    issueDesktopHandoffToken,
    startEnterpriseLogin,
    startDuoLogin,
    startDuoStepUp,
} = require('../controllers/authController');
const { protect, protectOptional, protectPhoneFactorProof } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { loginSchema } = require('../validators/userValidators');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    csrfTokenGenerator,
    csrfTokenValidator,
    csrfTokenValidatorUnlessBearerAuth,
} = require('../middleware/csrfMiddleware');
const { requireTurnstile } = require('../middleware/turnstileMiddleware');
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

const duoOidcLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_duo_oidc',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many Duo login attempts, please try again after 5 minutes',
    keyGenerator: (req) => req.ip,
});

const enterpriseOidcLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_enterprise_oidc',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many enterprise login attempts, please try again after 5 minutes',
    keyGenerator: (req) => req.ip,
});

const desktopHandoffLimiter = createDistributedRateLimit({
    securityCritical: true,
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'auth_desktop_handoff',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many desktop sign-in handoff requests, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        return req.ip;
    },
});

const authenticatedSessionMutationLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_session_mutation',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many session mutation requests, please try again after 5 minutes',
    keyGenerator: (req) => req.authUid || req.user?.email || req.ip,
});

router.get('/duo/start', duoOidcLimiter, startDuoLogin);
router.get('/duo/step-up', protect, establishSessionCookie, duoOidcLimiter, startDuoStepUp);
router.get('/duo/callback', duoOidcLimiter, completeDuoLogin);
router.get('/enterprise/start', enterpriseOidcLimiter, startEnterpriseLogin);
router.get('/enterprise/callback', enterpriseOidcLimiter, completeEnterpriseLogin);
router.post('/desktop-handoff/custom-token', protect, desktopHandoffLimiter, issueDesktopHandoffToken);
router.post('/exchange', protect, establishSessionCookie, csrfTokenGenerator, getSession);
router.get('/session', protect, establishSessionCookie, csrfTokenGenerator, getSession);
router.post('/sync', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, authSyncLimiter, validate(loginSchema), syncSession);
router.post('/logout', protectOptional, authenticatedSessionMutationLimiter, csrfTokenValidatorForCookieSession, logoutSession);
router.post('/bootstrap-device-challenge', requireTurnstile({ routeName: 'auth_bootstrap_device_challenge' }), bootstrapDeviceChallengeLimiter, requestBootstrapDeviceChallenge);
router.post('/recovery-codes', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, authenticatedSessionMutationLimiter, sensitiveActions.accountRecoveryChange, generateBackupRecoveryCodes);
router.post('/recovery-codes/verify', requireTurnstile({ routeName: 'auth_recovery_code_verify' }), recoveryCodeLimiter, verifyBackupRecoveryCode);
router.post('/complete-phone-factor-login', protect, phoneFactorCompletionLimiter, sensitiveActions.authFactorChange, completePhoneFactorLogin);
router.post('/complete-phone-factor-verification', protectPhoneFactorProof, phoneFactorCompletionLimiter, sensitiveActions.authFactorChange, completePhoneFactorVerification);
router.post('/verify-device', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, trustedDeviceVerificationLimiter, sensitiveActions.authFactorChange, verifyDeviceChallenge);
router.use('/otp', otpRoutes);

module.exports = router;
