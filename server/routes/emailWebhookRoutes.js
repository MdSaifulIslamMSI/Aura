const express = require('express');
const { handleResendWebhook } = require('../controllers/emailWebhookController');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');

const router = express.Router();

const emailWebhookLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'email_webhook_resend',
    securityCritical: true,
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
    message: 'Too many email webhook requests. Please slow down.',
});

router.post('/resend', emailWebhookLimiter, handleResendWebhook);

module.exports = router;
