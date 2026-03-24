const crypto = require('crypto');

const roundCurrency = (value) => Number((Number(value) || 0).toFixed(2));
const toPaise = (value) => Math.max(1, Math.round(roundCurrency(value) * 100));
const fromPaise = (value) => roundCurrency(Number(value) / 100);

const hashPayload = (value) => {
    const input = typeof value === 'string' ? value : JSON.stringify(value || {});
    return crypto.createHash('sha256').update(input).digest('hex');
};

const makeIntentId = () => `pi_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
const makeEventId = (prefix = 'evt') => `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;

const normalizeMethod = (method) => String(method || '').trim().toUpperCase();
const PAYMENT_METHOD_TO_PROVIDER_TYPE = {
    UPI: 'upi',
    CARD: 'card',
    WALLET: 'wallet',
    NETBANKING: 'bank',
};
const PROVIDER_TYPE_TO_PAYMENT_METHOD = {
    upi: 'UPI',
    card: 'CARD',
    wallet: 'WALLET',
    bank: 'NETBANKING',
};

const mapPaymentMethodToProviderType = (method) => (
    PAYMENT_METHOD_TO_PROVIDER_TYPE[normalizeMethod(method)] || ''
);

const mapProviderTypeToPaymentMethod = (type) => (
    PROVIDER_TYPE_TO_PAYMENT_METHOD[String(type || '').trim().toLowerCase()] || ''
);

module.exports = {
    roundCurrency,
    toPaise,
    fromPaise,
    hashPayload,
    makeIntentId,
    makeEventId,
    normalizeMethod,
    mapPaymentMethodToProviderType,
    mapProviderTypeToPaymentMethod,
};
