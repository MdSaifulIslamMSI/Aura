const crypto = require('crypto');

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|otp|password|secret|api[_-]?key|card|cvv|pan|rawbody|payload|private|credential|proof)/i;
const PII_KEY_PATTERN = /(email|phone|address|name|avatar|dob)/i;

const hashValue = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
};

const redactValue = (value, key = '') => {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((entry) => redactValue(entry, key));
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactValue(entryValue, entryKey);
            return acc;
        }, {});
    }

    const normalizedKey = String(key || '');
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) return REDACTED;
    if (PII_KEY_PATTERN.test(normalizedKey)) return hashValue(value);
    return value;
};

const safeHashId = (value = '') => hashValue(value);

module.exports = {
    REDACTED,
    hashValue,
    redactValue,
    safeHashId,
};
