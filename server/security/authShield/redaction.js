const { hashSecurityValue } = require('../redactSecurityMetadata');

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|otp|password|secret|api[_-]?key|card|cvv|pan|rawbody|payload|private|credential|proof|signature)/i;
const PII_KEY_PATTERN = /(email|phone|address|name|avatar|dob)/i;
const SENSITIVE_TEXT_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;

const hashValue = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return hashSecurityValue(normalized);
};

const redactText = (value = '') => String(value || '').replace(SENSITIVE_TEXT_PATTERN, REDACTED);

const redactValue = (value, key = '') => {
    if (value === null || value === undefined) return value;
    const normalizedKey = String(key || '');
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) return REDACTED;
    if (Array.isArray(value)) return value.map((entry) => redactValue(entry, key));
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactValue(entryValue, entryKey);
            return acc;
        }, {});
    }

    if (PII_KEY_PATTERN.test(normalizedKey)) return hashValue(value);
    if (typeof value === 'string') return redactText(value);
    return value;
};

const safeHashId = (value = '') => hashValue(value);

module.exports = {
    REDACTED,
    hashValue,
    redactValue,
    safeHashId,
};
