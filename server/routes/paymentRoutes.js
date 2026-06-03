const express = require('express');
const router = express.Router();
const { protect, requireOtpAssurance, requireActiveAccount } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    authorizePaymentMethodOwner,
    sensitiveActions,
} = require('../middleware/routeSecurityGuards');
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

router.post('/intents', protect, requireActiveAccount, requireOtpAssurance, validate(createIntentSchema), sensitiveActions.paymentPayoutChange, createIntent);
router.post('/intents/:intentId/challenge/complete', protect, requireActiveAccount, requireOtpAssurance, validate(completeChallengeSchema), sensitiveActions.paymentPayoutChange, completeChallenge);
router.post('/intents/:intentId/confirm', protect, requireActiveAccount, requireOtpAssurance, validate(confirmIntentSchema), sensitiveActions.paymentPayoutChange, confirmIntent);
router.get('/intents/:intentId', protect, validate(getIntentSchema), getIntent);
router.post('/intents/:intentId/refunds', protect, requireActiveAccount, requireOtpAssurance, validate(refundSchema), sensitiveActions.paymentRefund, createRefund);

router.get('/methods', protect, getPaymentMethods);
router.get('/capabilities', protect, getPaymentCapabilitiesCatalog);
router.get('/netbanking/banks', protect, getNetbankingBanks);
router.post('/methods/setup-intent', protect, requireActiveAccount, requireOtpAssurance, validate(paymentMethodSetupIntentSchema), sensitiveActions.paymentPayoutChange, createMethodSetupIntent);
router.post('/methods', protect, requireActiveAccount, requireOtpAssurance, validate(paymentMethodSchema), sensitiveActions.paymentPayoutChange, addPaymentMethod);
router.patch('/methods/:methodId/default', protect, requireActiveAccount, requireOtpAssurance, validate(methodIdParamSchema), authorizePaymentMethodOwner('payment_method.default'), sensitiveActions.paymentPayoutChange, makeDefaultPaymentMethod);
router.delete('/methods/:methodId', protect, requireActiveAccount, requireOtpAssurance, validate(methodIdParamSchema), authorizePaymentMethodOwner('payment_method.delete'), sensitiveActions.paymentPayoutChange, removePaymentMethod);

module.exports = router;
