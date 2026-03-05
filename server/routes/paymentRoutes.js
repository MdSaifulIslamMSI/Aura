const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
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

router.post('/intents', protect, validate(createIntentSchema), createIntent);
router.post('/intents/:intentId/challenge/complete', protect, validate(completeChallengeSchema), completeChallenge);
router.post('/intents/:intentId/confirm', protect, validate(confirmIntentSchema), confirmIntent);
router.get('/intents/:intentId', protect, validate(getIntentSchema), getIntent);
router.post('/intents/:intentId/refunds', protect, validate(refundSchema), createRefund);

router.get('/methods', protect, getPaymentMethods);
router.post('/methods', protect, validate(paymentMethodSchema), addPaymentMethod);
router.patch('/methods/:methodId/default', protect, validate(methodIdParamSchema), makeDefaultPaymentMethod);
router.delete('/methods/:methodId', protect, validate(methodIdParamSchema), removePaymentMethod);

module.exports = router;

