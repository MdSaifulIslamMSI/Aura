const express = require('express');
const { getSession, syncSession } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { loginSchema } = require('../validators/userValidators');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const otpRoutes = require('./otpRoutes');

const router = express.Router();

const authSyncLimiter = createDistributedRateLimit({
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

router.get('/session', protect, getSession);
router.post('/sync', protect, authSyncLimiter, validate(loginSchema), syncSession);
router.use('/otp', otpRoutes);

module.exports = router;
