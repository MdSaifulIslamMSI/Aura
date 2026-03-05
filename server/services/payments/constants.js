const PAYMENT_METHODS = ['COD', 'UPI', 'CARD', 'WALLET'];
const DIGITAL_METHODS = ['UPI', 'CARD', 'WALLET'];
const INTENT_EXPIRY_MINUTES = 20;
const MAX_OUTBOX_RETRIES = 5;
const OUTBOX_POLL_MS = 15000;

const parseBoundedInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
};

const PAYMENT_FORTRESS_MAX_ACTIVE_INTENTS = parseBoundedInt(
    process.env.PAYMENT_FORTRESS_MAX_ACTIVE_INTENTS,
    6,
    { min: 1, max: 50 }
);

const PAYMENT_FORTRESS_MAX_CONFIRM_ATTEMPTS = parseBoundedInt(
    process.env.PAYMENT_FORTRESS_MAX_CONFIRM_ATTEMPTS,
    12,
    { min: 1, max: 100 }
);

const PAYMENT_FORTRESS_MAX_CONFIRM_FAILURES = parseBoundedInt(
    process.env.PAYMENT_FORTRESS_MAX_CONFIRM_FAILURES,
    5,
    { min: 1, max: 25 }
);

const PAYMENT_FORTRESS_CONFIRM_LOCK_MINUTES = parseBoundedInt(
    process.env.PAYMENT_FORTRESS_CONFIRM_LOCK_MINUTES,
    15,
    { min: 1, max: 240 }
);

const PAYMENT_STATUSES = {
    CREATED: 'created',
    CHALLENGE_PENDING: 'challenge_pending',
    AUTHORIZED: 'authorized',
    CAPTURED: 'captured',
    FAILED: 'failed',
    PARTIALLY_REFUNDED: 'partially_refunded',
    REFUNDED: 'refunded',
    EXPIRED: 'expired',
};

module.exports = {
    PAYMENT_METHODS,
    DIGITAL_METHODS,
    INTENT_EXPIRY_MINUTES,
    MAX_OUTBOX_RETRIES,
    OUTBOX_POLL_MS,
    PAYMENT_FORTRESS_MAX_ACTIVE_INTENTS,
    PAYMENT_FORTRESS_MAX_CONFIRM_ATTEMPTS,
    PAYMENT_FORTRESS_MAX_CONFIRM_FAILURES,
    PAYMENT_FORTRESS_CONFIRM_LOCK_MINUTES,
    PAYMENT_STATUSES,
};
