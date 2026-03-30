const express = require('express');
const {
    getSession,
    syncSession,
    completePhoneFactorLogin,
    completePhoneFactorVerification,
    verifyDeviceChallenge,
    verifyLatticeChallenge,
    verifyQuantumChallenge,
} = require('../controllers/authController');
const { protect, protectPhoneFactorProof } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { loginSchema } = require('../validators/userValidators');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { csrfTokenGenerator, csrfTokenValidator } = require('../middleware/csrfMiddleware');
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

router.get('/session', protect, csrfTokenGenerator, getSession);
router.post('/sync', protect, csrfTokenValidator, authSyncLimiter, validate(loginSchema), syncSession);
router.post('/complete-phone-factor-login', protect, completePhoneFactorLogin);
router.post('/complete-phone-factor-verification', protectPhoneFactorProof, completePhoneFactorVerification);
router.post('/verify-device', protect, csrfTokenValidator, verifyDeviceChallenge);
router.post('/verify-lattice', protect, csrfTokenValidator, verifyLatticeChallenge);
router.post('/verify-quantum', protect, csrfTokenValidator, verifyQuantumChallenge);
router.use('/otp', otpRoutes);

module.exports = router;
