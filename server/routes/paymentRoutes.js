const express = require('express');
const router = express.Router();
const { protect, requireOtpAssurance } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    createIntent,
    completeChallenge,
    confirmIntent,
    getIntent,
    createRefund,
    handleRazorpayWebhook,
    getPaymentMethods,
    addPaymentMethod,
    makeDefaultPaymentMethod,
    removePaymentMethod,
} = require('../controllers/paymentController');
const {
    createIntentSchema,
    completeChallengeSchema,
    confirmIntentSchema,
    getIntentSchema,
    refundSchema,
    paymentMethodSchema,
    methodIdParamSchema,
} = require('../validators/paymentValidators');

router.post('/webhooks/razorpay', handleRazorpayWebhook);

router.post('/intents', protect, requireOtpAssurance, validate(createIntentSchema), createIntent);
router.post('/intents/:intentId/challenge/complete', protect, requireOtpAssurance, validate(completeChallengeSchema), completeChallenge);
router.post('/intents/:intentId/confirm', protect, requireOtpAssurance, validate(confirmIntentSchema), confirmIntent);
router.get('/intents/:intentId', protect, validate(getIntentSchema), getIntent);
router.post('/intents/:intentId/refunds', protect, requireOtpAssurance, validate(refundSchema), createRefund);

router.get('/methods', protect, getPaymentMethods);
router.post('/methods', protect, requireOtpAssurance, validate(paymentMethodSchema), addPaymentMethod);
router.patch('/methods/:methodId/default', protect, requireOtpAssurance, validate(methodIdParamSchema), makeDefaultPaymentMethod);
router.delete('/methods/:methodId', protect, requireOtpAssurance, validate(methodIdParamSchema), removePaymentMethod);

module.exports = router;

