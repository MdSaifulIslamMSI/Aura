const os = require('os');

const REDACTED_PLACEHOLDER = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(phone|email|authorization|token|password|otp|secret)/i;

const maskEmail = (email) => {
    const value = String(email || '').trim();
    if (!value.includes('@')) return REDACTED_PLACEHOLDER;

    const [localPart, domainPart] = value.split('@');
    if (!localPart || !domainPart) return REDACTED_PLACEHOLDER;

    const visiblePrefix = localPart.slice(0, 2);
    return `${visiblePrefix || '*'}***@${domainPart}`;
};

const maskPhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return REDACTED_PLACEHOLDER;
    return `***${digits.slice(-4)}`;
};

const sanitizeStringForKey = (key, value) => {
    if (value === undefined || value === null || value === '') return REDACTED_PLACEHOLDER;

    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey.includes('email')) return maskEmail(value);
    if (normalizedKey.includes('phone')) return maskPhone(value);

    return REDACTED_PLACEHOLDER;
};

const redactSensitiveData = (value, key = '') => {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveData(item, key));
    }

    if (value instanceof Date) {
        return value;
    }

    if (value instanceof Error) {
        return {
            message: value.message,
            stack: value.stack,
            name: value.name,
        };
    }

    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactSensitiveData(entryValue, entryKey);
            return acc;
        }, {});
    }

    if (SENSITIVE_KEY_PATTERN.test(String(key || ''))) {
        return sanitizeStringForKey(key, value);
    }

    return value;
};

const formatMessage = (level, message, meta = {}) => {
    const sanitizedMeta = redactSensitiveData(meta);

    return JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        hostname: os.hostname(),
        pid: process.pid,
        ...sanitizedMeta,
    });
};

const logger = {
    info: (message, meta) => console.log(formatMessage('info', message, meta)),
    warn: (message, meta) => console.warn(formatMessage('warn', message, meta)),
    error: (message, meta) => console.error(formatMessage('error', message, meta)),
    debug: (message, meta) => {
        if (process.env.NODE_ENV !== 'production') {
            console.debug(formatMessage('debug', message, meta));
        }
    },
};

module.exports = logger;
