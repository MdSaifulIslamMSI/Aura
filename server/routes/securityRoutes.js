const express = require('express');
const { createAlienOtpChallenge } = require('../controllers/alienOtpController');
const { protect } = require('../middleware/authMiddleware');
const { csrfTokenValidatorUnlessBearerAuth } = require('../middleware/csrfMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');

const router = express.Router();

const alienOtpLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'alien_otp_challenge',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many ALIEN OTP challenge requests, please try again after 5 minutes',
    keyGenerator: (req) => req.authUid || req.user?.email || req.ip,
});

router.post(
    '/alien-otp/challenge',
    alienOtpLimiter,
    protect,
    csrfTokenValidatorUnlessBearerAuth,
    createAlienOtpChallenge
);

module.exports = router;
