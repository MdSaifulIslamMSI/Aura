const crypto = require('crypto');
const Decimal = require('decimal.js');

const ZERO_DECIMAL_CURRENCIES = new Set([
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'ISK',
    'JPY',
    'KMF',
    'KRW',
    'PYG',
    'RWF',
    'UGX',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF',
]);

const THREE_DECIMAL_CURRENCIES = new Set([
    'BHD',
    'IQD',
    'JOD',
    'KWD',
    'LYD',
    'OMR',
    'TND',
]);

const normalizeCurrencyCode = (value, fallback = 'INR') => {
    const normalized = String(value || fallback).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
};

const getCurrencyExponent = (currency = 'INR') => {
    const normalized = normalizeCurrencyCode(currency);
    if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
    if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
    return 2;
};

const getCurrencyScale = (currency = 'INR') => (
    new Decimal(10).pow(getCurrencyExponent(currency))
);

const roundCurrency = (value, currency = 'INR') => (
    new Decimal(value || 0)
        .toDecimalPlaces(getCurrencyExponent(currency), Decimal.ROUND_HALF_UP)
        .toNumber()
);

const toMinorUnits = (value, currency = 'INR') => {
    const rounded = new Decimal(roundCurrency(value, currency));
    const minorUnits = rounded.times(getCurrencyScale(currency)).toNearest(1, Decimal.ROUND_HALF_UP);
    if (rounded.gt(0) && minorUnits.lt(1)) return 1;
    return minorUnits.toNumber();
};

const fromMinorUnits = (value, currency = 'INR') => (
    new Decimal(value || 0)
        .div(getCurrencyScale(currency))
        .toDecimalPlaces(getCurrencyExponent(currency), Decimal.ROUND_HALF_UP)
        .toNumber()
);

const toPaise = (value, currency = 'INR') => toMinorUnits(value, currency);
const fromPaise = (value, currency = 'INR') => fromMinorUnits(value, currency);

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
    normalizeCurrencyCode,
    getCurrencyExponent,
    getCurrencyScale,
    roundCurrency,
    toMinorUnits,
    fromMinorUnits,
    toPaise,
    fromPaise,
    hashPayload,
    makeIntentId,
    makeEventId,
    normalizeMethod,
    mapPaymentMethodToProviderType,
    mapProviderTypeToPaymentMethod,
};
