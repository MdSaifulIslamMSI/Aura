const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, checkUserExists } = require('../controllers/otpController');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');

const otpLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'otp_send',
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 3, // Max 3 OTP requests per minute per IP
    message: 'Too many OTP requests. Please wait a minute before trying again.',
});

const verifyLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'otp_verify',
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Max 5 verification attempts per 5 minutes per IP
    message: 'Too many verification attempts. Please wait before trying again.',
});

const checkUserLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'otp_check_user',
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // Max 20 account checks per 5 minutes per IP
    message: 'Too many account checks. Please wait before trying again.',
});

router.post('/send', otpLimiter, sendOtp);
router.post('/verify', verifyLimiter, verifyOtp);
router.post('/check-user', checkUserLimiter, checkUserExists);

module.exports = router;

