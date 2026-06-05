const crypto = require('crypto');

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(password|token|accessToken|refreshToken|authorization|cookie|otp|secret|api[_-]?key|privateKey|private|card|cvv|paymentMethod|webhookSecret|rawBody|credential)/i;

const hashValue = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
};

const shouldRedactKey = (key = '') => SENSITIVE_KEY_PATTERN.test(String(key || ''));

const redactSecurityValue = (value, key = '') => {
    if (value === null || value === undefined) return value;

    if (shouldRedactKey(key)) {
        return REDACTED;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => redactSecurityValue(entry, key));
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactSecurityValue(entryValue, entryKey);
            return acc;
        }, {});
    }

    return value;
};

module.exports = {
    REDACTED,
    hashValue,
    redactSecurityValue,
    shouldRedactKey,
};
