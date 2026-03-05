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

module.exports = {
    roundCurrency,
    toPaise,
    fromPaise,
    hashPayload,
    makeIntentId,
    makeEventId,
    normalizeMethod,
};

