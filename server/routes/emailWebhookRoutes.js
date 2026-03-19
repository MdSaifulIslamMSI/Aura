const express = require('express');
const { handleResendWebhook } = require('../controllers/emailWebhookController');

const router = express.Router();

router.post('/resend', handleResendWebhook);

module.exports = router;
