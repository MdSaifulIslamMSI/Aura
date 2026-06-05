const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createAlienOtpChallenge } = require('../controllers/alienOtpController');
const { protect } = require('../middleware/authMiddleware');
const { csrfTokenValidatorUnlessBearerAuth } = require('../middleware/csrfMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');

const router = express.Router();

const alienOtpRouteRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: process.env.NODE_ENV === 'development' ? 1000 : 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many ALIEN OTP challenge requests. Please try again shortly.' },
});

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
    alienOtpRouteRateLimit,
    alienOtpLimiter,
    protect,
    csrfTokenValidatorUnlessBearerAuth,
    createAlienOtpChallenge
);

module.exports = router;
