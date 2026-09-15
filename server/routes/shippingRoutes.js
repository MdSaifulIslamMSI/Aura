const express = require('express');
const asyncHandler = require('express-async-handler');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { processShippingWebhook } = require('../services/shippingWebhookService');

const router = express.Router();

// Inbound courier webhooks. Posture: 'webhook' in the route security matrix —
// signature-verified, eventId-deduped, rawBody captured by the global JSON
// verify hook for this mount. A per-IP limiter runs before signature
// verification so unsigned retry storms cannot saturate the checkpoint path.
const shippingWebhookLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'shipping_webhook',
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 240 : 60,
    keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
    message: { status: 'error', message: 'Too many shipping webhook events, please slow down.' },
});

router.post('/webhooks/:provider', shippingWebhookLimiter, asyncHandler(async (req, res) => {
    const provider = String(req.params.provider || '').trim().toLowerCase();
    const result = await processShippingWebhook({
        provider,
        signature: req.headers['x-shipping-signature'] || '',
        rawBody: req.rawBody || JSON.stringify(req.body || {}),
    });
    res.json(result);
}));

module.exports = router;
