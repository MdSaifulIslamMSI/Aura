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
    'clientsecret',
    'credential',
    'proof',
    'signature',
    'token',
    'secret',
    'paymentwebhooksecret',
    'hyperswitchapikey',
    'lagoapikey',
]);

const SENSITIVE_LOG_TEXT_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+|(?:pi|seti|cs)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+)\b/g;

const shouldRedactPaymentKey = (key = '') => {
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return SENSITIVE_LOG_KEYS.has(normalizedKey)
        || normalizedKey.includes('secret')
        || normalizedKey.includes('token')
        || normalizedKey.includes('credential')
        || normalizedKey === 'signature'
        || normalizedKey.endsWith('signature')
        || normalizedKey.endsWith('signatures')
        || normalizedKey.includes('signaturebase')
        || normalizedKey.includes('authorization')
        || normalizedKey.includes('cookie')
        || normalizedKey.includes('apikey');
};

const redactPaymentText = (value = '') => String(value || '').replace(SENSITIVE_LOG_TEXT_PATTERN, '[redacted]');

const redactSensitivePaymentLog = (value) => {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'string') {
            return redactPaymentText(value);
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(redactSensitivePaymentLog);
    }
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
        if (shouldRedactPaymentKey(key)) {
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
