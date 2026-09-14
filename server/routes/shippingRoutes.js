const express = require('express');
const asyncHandler = require('express-async-handler');
const { processShippingWebhook } = require('../services/shippingWebhookService');

const router = express.Router();

// Inbound courier webhooks. Posture: 'webhook' in the route security matrix —
// signature-verified, eventId-deduped, rawBody captured by the global JSON
// verify hook for this mount.
router.post('/webhooks/:provider', asyncHandler(async (req, res) => {
    const provider = String(req.params.provider || '').trim().toLowerCase();
    const result = await processShippingWebhook({
        provider,
        signature: req.headers['x-shipping-signature'] || '',
        rawBody: req.rawBody || JSON.stringify(req.body || {}),
    });
    res.json(result);
}));

module.exports = router;
