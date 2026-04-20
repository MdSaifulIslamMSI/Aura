const express = require('express');
const {
    establishSessionCookie,
    getSession,
    logoutSession,
    requestBootstrapDeviceChallenge,
    syncSession,
    completePhoneFactorLogin,
    completePhoneFactorVerification,
    verifyDeviceChallenge,
} = require('../controllers/authController');
const { protect, protectPhoneFactorProof } = require('../middleware/authMiddleware');
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

router.post('/exchange', protect, establishSessionCookie, csrfTokenGenerator, getSession);
router.get('/session', protect, establishSessionCookie, csrfTokenGenerator, getSession);
router.post('/sync', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, authSyncLimiter, validate(loginSchema), syncSession);
router.post('/logout', logoutSession);
router.post('/bootstrap-device-challenge', requestBootstrapDeviceChallenge);
router.post('/complete-phone-factor-login', protect, completePhoneFactorLogin);
router.post('/complete-phone-factor-verification', protectPhoneFactorProof, completePhoneFactorVerification);
router.post('/verify-device', protect, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, verifyDeviceChallenge);
router.use('/otp', otpRoutes);

module.exports = router;
