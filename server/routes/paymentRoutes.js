const express = require('express');
const router = express.Router();
const { protect, requireOtpAssurance, requireActiveAccount } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    createIntent,
    completeChallenge,
    confirmIntent,
    getIntent,
    createRefund,
    handleRazorpayWebhook,
    handleStripeWebhook,
    getPaymentMethods,
    getPaymentCapabilitiesCatalog,
    getNetbankingBanks,
    createMethodSetupIntent,
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
    paymentMethodSetupIntentSchema,
    methodIdParamSchema,
} = require('../validators/paymentValidators');

router.post('/webhooks/razorpay', handleRazorpayWebhook);
router.post('/webhooks/stripe', handleStripeWebhook);

router.post('/intents', protect, requireActiveAccount, requireOtpAssurance, validate(createIntentSchema), createIntent);
router.post('/intents/:intentId/challenge/complete', protect, requireActiveAccount, requireOtpAssurance, validate(completeChallengeSchema), completeChallenge);
router.post('/intents/:intentId/confirm', protect, requireActiveAccount, requireOtpAssurance, validate(confirmIntentSchema), confirmIntent);
router.get('/intents/:intentId', protect, validate(getIntentSchema), getIntent);
router.post('/intents/:intentId/refunds', protect, requireActiveAccount, requireOtpAssurance, validate(refundSchema), createRefund);

router.get('/methods', protect, getPaymentMethods);
router.get('/capabilities', protect, getPaymentCapabilitiesCatalog);
router.get('/netbanking/banks', protect, getNetbankingBanks);
router.post('/methods/setup-intent', protect, requireActiveAccount, requireOtpAssurance, validate(paymentMethodSetupIntentSchema), createMethodSetupIntent);
router.post('/methods', protect, requireActiveAccount, requireOtpAssurance, validate(paymentMethodSchema), addPaymentMethod);
router.patch('/methods/:methodId/default', protect, requireActiveAccount, requireOtpAssurance, validate(methodIdParamSchema), makeDefaultPaymentMethod);
router.delete('/methods/:methodId', protect, requireActiveAccount, requireOtpAssurance, validate(methodIdParamSchema), removePaymentMethod);

module.exports = router;

