const crypto = require('crypto');

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|otp|password|secret|api[_-]?key|card|cvv|pan|rawbody|payload|private|signature|credential|proof)/i;
const SENSITIVE_TEXT_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;

const hashValue = (value = '') => crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);

const truncateIp = (value = '') => {
    const ip = String(value || '').trim();
    if (!ip) return '';
    if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
    return ip.split('.').slice(0, 3).join('.').concat('.0/24');
};

const redactTrustText = (value = '') => String(value || '').replace(SENSITIVE_TEXT_PATTERN, '[REDACTED]');

const redactTrustValue = (value, key = '') => {
    if (value === null || value === undefined) return value;

    const normalizedKey = String(key || '').toLowerCase();
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
        return '[REDACTED]';
    }

    if (Array.isArray(value)) {
        return value.map((entry) => redactTrustValue(entry, key));
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactTrustValue(entryValue, entryKey);
            return acc;
        }, {});
    }

    if (normalizedKey.includes('ip')) {
        return truncateIp(value);
    }
    if (normalizedKey.includes('useragent') || normalizedKey.includes('user_agent')) {
        return hashValue(value);
    }
    if (normalizedKey === 'actorid' || normalizedKey === 'resourceid') {
        return hashValue(value);
    }

    if (typeof value === 'string') {
        return redactTrustText(value);
    }

    return value;
};

module.exports = {
    hashValue,
    redactTrustValue,
    truncateIp,
};
