const SPAN_NAMES = Object.freeze([
    'payment.create_intent',
    'payment.confirm',
    'payment.provider_call',
    'payment.webhook.verify',
    'payment.webhook.process',
    'payment.refund',
    'ledger.transaction',
    'billing.invoice',
    'outbox.publish',
]);

const METRIC_NAMES = Object.freeze([
    'payment_intent_created_total',
    'payment_success_total',
    'payment_failure_total',
    'payment_refund_total',
    'payment_webhook_duplicate_total',
    'payment_provider_latency_ms',
    'payment_provider_error_total',
    'outbox_pending_count',
    'outbox_failed_count',
    'ledger_transaction_total',
]);

const SENSITIVE_LOG_KEYS = new Set([
    'authorization',
    'cookie',
    'apikey',
    'apikey',
    'token',
    'secret',
    'paymentwebhooksecret',
    'hyperswitchapikey',
    'lagoapikey',
]);

const redactSensitivePaymentLog = (value) => {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(redactSensitivePaymentLog);
    }
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
        const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (SENSITIVE_LOG_KEYS.has(normalizedKey) || normalizedKey.includes('secret') || normalizedKey.includes('token')) {
            return [key, '[redacted]'];
        }
        return [key, redactSensitivePaymentLog(nested)];
    }));
};

const createPaymentLogContext = ({
    requestId,
    paymentIntentId,
    provider,
    eventId,
    extra = {},
} = {}) => redactSensitivePaymentLog({
    request_id: requestId,
    payment_intent_id: paymentIntentId,
    provider,
    event_id: eventId,
    ...extra,
});

module.exports = {
    SPAN_NAMES,
    METRIC_NAMES,
    redactSensitivePaymentLog,
    createPaymentLogContext,
};
