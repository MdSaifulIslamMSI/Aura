const { z } = require('zod');

const asOptionalString = z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    return String(value);
}, z.string().optional());

const paymentEnvSchema = z.object({
    PAYMENT_PROVIDER: z.enum(['mock', 'hyperswitch', 'razorpay', 'stripe']).default('mock'),
    PAYMENT_MODE: z.enum(['test', 'live']).default('test'),
    PAYMENT_WEBHOOK_SECRET: asOptionalString,
    HYPERSWITCH_BASE_URL: asOptionalString,
    HYPERSWITCH_API_KEY: asOptionalString,
    HYPERSWITCH_PROFILE_ID: asOptionalString,
    HYPERSWITCH_MERCHANT_ID: asOptionalString,
    PAYMENT_SUCCESS_URL: asOptionalString,
    PAYMENT_CANCEL_URL: asOptionalString,
    BILLING_PROVIDER: z.enum(['mock', 'lago', 'killbill']).default('mock'),
    LAGO_BASE_URL: asOptionalString,
    LAGO_API_KEY: asOptionalString,
    KILLBILL_BASE_URL: asOptionalString,
    KILLBILL_API_KEY: asOptionalString,
    KILLBILL_API_SECRET: asOptionalString,
    EVENT_BUS: z.enum(['local', 'kafka']).default('local'),
    KAFKA_BROKERS: asOptionalString,
    KAFKA_CLIENT_ID: asOptionalString,
    KAFKA_PAYMENT_TOPIC: z.string().default('payments.events'),
    KAFKA_BILLING_TOPIC: z.string().default('billing.events'),
    KAFKA_LEDGER_TOPIC: z.string().default('ledger.events'),
    SECRETS_PROVIDER: z.enum(['env', 'openbao']).default('env'),
    OPENBAO_ADDR: asOptionalString,
    OPENBAO_TOKEN: asOptionalString,
    OPENBAO_MOUNT: asOptionalString,
    OPENBAO_PAYMENT_PATH: asOptionalString,
    ENABLE_PAYMENTS_UI: z.enum(['true', 'false']).default('false'),
});

const requireFields = (config, fieldNames, errors) => {
    fieldNames.forEach((field) => {
        if (!config[field]) {
            errors.push(`${field} is required.`);
        }
    });
};

const validatePaymentEnvironment = (env = process.env) => {
    const parsed = paymentEnvSchema.safeParse(env);
    if (!parsed.success) {
        return Object.freeze({
            ok: false,
            errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
            warnings: [],
            config: null,
        });
    }

    const config = parsed.data;
    const errors = [];
    const warnings = [];

    if (config.PAYMENT_MODE === 'live') {
        if (config.PAYMENT_PROVIDER === 'mock') {
            errors.push('PAYMENT_PROVIDER=mock is not allowed when PAYMENT_MODE=live.');
        }
        requireFields(config, ['PAYMENT_WEBHOOK_SECRET', 'PAYMENT_SUCCESS_URL', 'PAYMENT_CANCEL_URL'], errors);
        if (config.PAYMENT_PROVIDER === 'hyperswitch') {
            requireFields(config, [
                'HYPERSWITCH_BASE_URL',
                'HYPERSWITCH_API_KEY',
                'HYPERSWITCH_PROFILE_ID',
                'HYPERSWITCH_MERCHANT_ID',
            ], errors);
        }
        if (['razorpay', 'stripe'].includes(config.PAYMENT_PROVIDER)) {
            warnings.push('PAYMENT_PROVIDER uses the legacy checkout runtime; Hyperswitch foundation remains adapter-only.');
        }
        if (config.BILLING_PROVIDER === 'lago') {
            requireFields(config, ['LAGO_BASE_URL', 'LAGO_API_KEY'], errors);
        }
        if (config.BILLING_PROVIDER === 'killbill') {
            requireFields(config, ['KILLBILL_BASE_URL', 'KILLBILL_API_KEY', 'KILLBILL_API_SECRET'], errors);
        }
        if (config.EVENT_BUS === 'kafka') {
            requireFields(config, ['KAFKA_BROKERS', 'KAFKA_CLIENT_ID'], errors);
        }
        if (config.SECRETS_PROVIDER === 'openbao') {
            requireFields(config, ['OPENBAO_ADDR', 'OPENBAO_TOKEN', 'OPENBAO_MOUNT', 'OPENBAO_PAYMENT_PATH'], errors);
        }
    }

    return Object.freeze({
        ok: errors.length === 0,
        errors,
        warnings,
        config: Object.freeze(config),
    });
};

const assertPaymentEnvironment = (env = process.env) => {
    const result = validatePaymentEnvironment(env);
    if (!result.ok) {
        const error = new Error(`Payment environment validation failed: ${result.errors.join('; ')}`);
        error.validation = result;
        throw error;
    }
    return result;
};

module.exports = {
    paymentEnvSchema,
    validatePaymentEnvironment,
    assertPaymentEnvironment,
};
