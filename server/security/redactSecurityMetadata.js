const crypto = require('crypto');

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|token|otp|password|secret|api[_-]?key|apikey|card|cvv|pan|private|rawbody|payload|signature|credential|proof)/i;
const LONG_SECRET_PATTERN = /\b(sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;
const SECURITY_HASH_CONTEXT = 'aura-security-log-pseudonym-v1';

const getSecurityHashKey = () => String(
    process.env.SECURITY_LOG_HASH_KEY
    || process.env.OTP_FLOW_SECRET
    || process.env.SESSION_SECRET
    || process.env.JWT_SECRET
    || 'aura-local-security-log-key'
).trim();

const buildSecurityHmacKey = (value = '') => `${getSecurityHashKey()}:${String(value || '')}`;

const hashSecurityValue = (value = '', length = 16) => crypto
    .createHmac('sha256', buildSecurityHmacKey(value))
    .update(SECURITY_HASH_CONTEXT)
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
