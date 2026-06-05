const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { protect, requireOtpAssurance, requireActiveAccount } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const validate = require('../middleware/validate');
const {
    authorizePaymentMethodOwner,
    sensitiveActions,
} = require('../middleware/routeSecurityGuards');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const {
    loadPaymentIntentResource,
    loadPaymentWebhookResource,
} = require('../trust/adapters/paymentAdapter');
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

const actorRateLimitKey = (req) => (
    req.authUid
    || req.user?._id?.toString()
    || req.user?.id
    || req.user?.email
    || req.ip
);

const paymentIntentRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: process.env.NODE_ENV === 'development' ? 1000 : 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many payment intent requests. Please try again shortly.' },
});

const paymentIntentLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'payment_intent_mutation',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 80,
    keyGenerator: actorRateLimitKey,
    message: 'Too many payment intent requests. Please try again shortly.',
});

const paymentMethodMutationRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: process.env.NODE_ENV === 'development' ? 1000 : 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many payment method changes. Please try again shortly.' },
});

const paymentMethodMutationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'payment_method_mutation',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    keyGenerator: actorRateLimitKey,
    message: 'Too many payment method changes. Please try again shortly.',
});

router.post('/webhooks/razorpay', requireTrustDecision('payment.webhook.process', loadPaymentWebhookResource('razorpay'), { actor: { actorType: 'payment_webhook', role: 'payment_webhook' } }), handleRazorpayWebhook);
router.post('/webhooks/stripe', requireTrustDecision('payment.webhook.process', loadPaymentWebhookResource('stripe'), { actor: { actorType: 'payment_webhook', role: 'payment_webhook' } }), handleStripeWebhook);

router.post('/intents', protect, requireActiveAccount, requireOtpAssurance, paymentIntentRateLimit, paymentIntentLimiter, validate(createIntentSchema), sensitiveActions.paymentPayoutChange, createIntent);
router.post('/intents/:intentId/challenge/complete', protect, requireActiveAccount, requireOtpAssurance, paymentIntentRateLimit, paymentIntentLimiter, validate(completeChallengeSchema), sensitiveActions.paymentPayoutChange, completeChallenge);
router.post('/intents/:intentId/confirm', protect, requireActiveAccount, requireOtpAssurance, paymentIntentRateLimit, paymentIntentLimiter, validate(confirmIntentSchema), sensitiveActions.paymentPayoutChange, confirmIntent);
router.get('/intents/:intentId', protect, validate(getIntentSchema), getIntent);
router.post('/intents/:intentId/refunds', protect, requireActiveAccount, requireOtpAssurance, paymentIntentRateLimit, paymentIntentLimiter, validate(refundSchema), requireTrustDecision('payment.refund.create', loadPaymentIntentResource), sensitiveActions.paymentRefund, createRefund);

router.get('/methods', protect, getPaymentMethods);
router.get('/capabilities', protect, getPaymentCapabilitiesCatalog);
router.get('/netbanking/banks', protect, getNetbankingBanks);
router.post('/methods/setup-intent', protect, requireActiveAccount, requireOtpAssurance, paymentMethodMutationRateLimit, paymentMethodMutationLimiter, validate(paymentMethodSetupIntentSchema), sensitiveActions.paymentPayoutChange, createMethodSetupIntent);
router.post('/methods', protect, requireActiveAccount, requireOtpAssurance, paymentMethodMutationRateLimit, paymentMethodMutationLimiter, validate(paymentMethodSchema), sensitiveActions.paymentPayoutChange, addPaymentMethod);
router.patch('/methods/:methodId/default', protect, requireActiveAccount, requireOtpAssurance, paymentMethodMutationRateLimit, paymentMethodMutationLimiter, validate(methodIdParamSchema), authorizePaymentMethodOwner('payment_method.default'), sensitiveActions.paymentPayoutChange, makeDefaultPaymentMethod);
router.delete('/methods/:methodId', protect, requireActiveAccount, requireOtpAssurance, paymentMethodMutationRateLimit, paymentMethodMutationLimiter, validate(methodIdParamSchema), authorizePaymentMethodOwner('payment_method.delete'), sensitiveActions.paymentPayoutChange, removePaymentMethod);

module.exports = router;
