const crypto = require('crypto');

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|token|otp|password|secret|api[_-]?key|apikey|card|cvv|pan|private|rawbody|payload|signature|credential)/i;
const LONG_SECRET_PATTERN = /\b(sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;

const hashSecurityValue = (value = '', length = 16) => crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, length);

const redactStringValue = (value = '') => String(value || '').replace(LONG_SECRET_PATTERN, '[REDACTED]');

const redactSecurityMetadata = (value, key = '') => {
    if (value === null || value === undefined) return value;
    const normalizedKey = String(key || '');

    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
        return '[REDACTED]';
    }

    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) {
        return value.map((entry) => redactSecurityMetadata(entry, normalizedKey));
    }

    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactSecurityMetadata(entryValue, entryKey);
            return acc;
        }, {});
    }

    if (typeof value === 'string') return redactStringValue(value);

    return value;
};

module.exports = {
    hashSecurityValue,
    redactSecurityMetadata,
};
