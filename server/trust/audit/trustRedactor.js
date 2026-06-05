const crypto = require('crypto');

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|otp|password|secret|api[_-]?key|card|cvv|pan|rawbody|payload|private|signature)/i;

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

const redactTrustValue = (value, key = '') => {
    if (value === null || value === undefined) return value;

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

    const normalizedKey = String(key || '').toLowerCase();
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
        return '[REDACTED]';
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

    return value;
};

module.exports = {
    hashValue,
    redactTrustValue,
    truncateIp,
};
