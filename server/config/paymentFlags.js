const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const asLower = (value, fallback) => String(value || fallback).trim().toLowerCase();

const nodeEnv = asLower(process.env.NODE_ENV, 'development');
const isProduction = nodeEnv === 'production';
const SUPPORTED_PAYMENT_PROVIDERS = new Set(['razorpay', 'stripe']);

const flags = {
    nodeEnv,
    isProduction,
    paymentsEnabled: parseBoolean(process.env.PAYMENTS_ENABLED, true),
    paymentProvider: asLower(process.env.PAYMENT_PROVIDER, 'razorpay'),
    paymentRiskMode: asLower(process.env.PAYMENT_RISK_MODE, 'shadow'),
    paymentCaptureMode: asLower(process.env.PAYMENT_CAPTURE_MODE, 'post_order_auth_capture'),
    paymentSavedMethodsEnabled: parseBoolean(process.env.PAYMENT_SAVED_METHODS_ENABLED, true),
    paymentRefundsEnabled: parseBoolean(process.env.PAYMENT_REFUNDS_ENABLED, true),
    paymentChallengeEnabled: parseBoolean(process.env.PAYMENT_CHALLENGE_ENABLED, true),
    paymentDynamicRoutingEnabled: parseBoolean(process.env.PAYMENT_DYNAMIC_ROUTING_ENABLED, true),
    paymentWebhooksEnabled: parseBoolean(process.env.PAYMENT_WEBHOOKS_ENABLED, true),
};

const assertWebhookConfig = () => {
    if (!flags.paymentsEnabled || !flags.paymentWebhooksEnabled) return;
    const stripeRoutingEnabled = flags.paymentDynamicRoutingEnabled
        && parseBoolean(process.env.PAYMENT_STRIPE_ROUTING_ENABLED, false);

    if (!SUPPORTED_PAYMENT_PROVIDERS.has(flags.paymentProvider)) {
        throw new Error(`Unsupported PAYMENT_PROVIDER=${flags.paymentProvider}. Supported providers: razorpay, stripe.`);
    }

    if (flags.paymentProvider === 'razorpay' && !process.env.RAZORPAY_WEBHOOK_SECRET) {
        throw new Error('Missing RAZORPAY_WEBHOOK_SECRET for Razorpay webhook mode');
    }

    if ((flags.paymentProvider === 'stripe' || stripeRoutingEnabled) && !process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error('Missing STRIPE_WEBHOOK_SECRET for Stripe webhook mode');
    }
};

const assertProductionPaymentConfig = () => {
    if (flags.paymentChallengeEnabled && !String(process.env.OTP_CHALLENGE_SECRET || '').trim()) {
        throw new Error('Missing OTP_CHALLENGE_SECRET for payment challenge mode');
    }

    if (!flags.isProduction || !flags.paymentsEnabled) return;
    const stripeRoutingEnabled = flags.paymentDynamicRoutingEnabled
        && parseBoolean(process.env.PAYMENT_STRIPE_ROUTING_ENABLED, false);

    if (!SUPPORTED_PAYMENT_PROVIDERS.has(flags.paymentProvider)) {
        throw new Error(`Production requires a supported PAYMENT_PROVIDER when payments are enabled. Supported providers: razorpay, stripe.`);
    }

    if (flags.paymentProvider === 'razorpay' && (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_WEBHOOK_SECRET)) {
        throw new Error('Missing Razorpay credentials for production payment mode');
    }

    if ((flags.paymentProvider === 'stripe' || stripeRoutingEnabled) && (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY || !process.env.STRIPE_WEBHOOK_SECRET)) {
        throw new Error('Missing Stripe credentials for production payment mode');
    }
};

module.exports = {
    flags,
    parseBoolean,
    assertWebhookConfig,
    assertProductionPaymentConfig,
};
