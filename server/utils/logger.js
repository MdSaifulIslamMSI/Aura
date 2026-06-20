const os = require('os');
const { hashSecurityValue } = require('../security/redactSecurityMetadata');

const REDACTED_PLACEHOLDER = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(phone|email|authorization|token|password|pass|otp|secret|jwt|api[_-]?key|card(number)?|cvv|pan|credential|signature|private|rawbody|payload)/i;
const IDENTIFIER_KEY_PATTERN = /^(userId|uid|firebaseUid|authUid|accountId|actorId|resourceId|ownerId|tenantId|sellerId|buyerId)$/i;
const HASHED_IDENTIFIER_PATTERN = /^[a-f0-9]{16}$/i;
const URL_LIKE_KEY_PATTERN = /(url|uri|path|route)$/i;
const URL_WITH_QUERY_PATTERN = /((?:https?:\/\/|\/)[^\s"'`?]+)\?[^\s"'`]*/gi;
const SENSITIVE_TEXT_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;

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

const redactUrlQueriesInText = (value) => String(value || '')
    .replace(URL_WITH_QUERY_PATTERN, `$1?${REDACTED_PLACEHOLDER}`);

const redactSensitiveText = (value) => redactUrlQueriesInText(value)
    .replace(SENSITIVE_TEXT_PATTERN, REDACTED_PLACEHOLDER);

const sanitizeUrlLikeValue = (value) => {
    const normalizedValue = String(value || '');
    const queryIndex = normalizedValue.indexOf('?');
    if (queryIndex < 0) return normalizedValue;
    return `${normalizedValue.slice(0, queryIndex)}?${REDACTED_PLACEHOLDER}`;
};

const sanitizeStringForKey = (key, value) => {
    if (value === undefined || value === null || value === '') return REDACTED_PLACEHOLDER;

    const normalizedKey = String(key || '').toLowerCase();
    const normalizedValue = String(value || '').trim();
    if (normalizedKey.endsWith('hash') && /^[a-f0-9]{16,128}$/i.test(normalizedValue)) {
        return normalizedValue;
    }
    if (normalizedKey.includes('email')) return maskEmail(value);
    if (normalizedKey.includes('phone')) return maskPhone(value);

    return REDACTED_PLACEHOLDER;
};

const redactSensitiveData = (value, key = '') => {
    if (value === null || value === undefined) return value;

    const normalizedKey = String(key || '');
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
        return sanitizeStringForKey(key, value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveData(item, key));
    }

    if (value instanceof Date) {
        return value;
    }

    if (value instanceof Error) {
        return {
            message: redactSensitiveText(value.message),
            stack: redactSensitiveText(value.stack),
            name: value.name,
        };
    }

    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactSensitiveData(entryValue, entryKey);
            return acc;
        }, {});
    }

    if (IDENTIFIER_KEY_PATTERN.test(normalizedKey)) {
        const normalizedValue = String(value || '').trim();
        if (HASHED_IDENTIFIER_PATTERN.test(normalizedValue)) return normalizedValue;
        return hashSecurityValue(value);
    }
    if (URL_LIKE_KEY_PATTERN.test(normalizedKey)) {
        return sanitizeUrlLikeValue(value);
    }

    if (typeof value === 'string') return redactSensitiveText(value);

    return value;
};

const formatMessage = (level, message, meta = {}) => {
    const sanitizedMeta = redactSensitiveData(meta);

    return JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message: redactSensitiveText(message),
        hostname: os.hostname(),
        pid: process.pid,
        ...sanitizedMeta,
    });
};

const isBrokenPipeError = (error) => {
    if (!error) return false;

    const message = String(error.message || '').toLowerCase();
    return error.code === 'EPIPE' || message.includes('broken pipe');
};

const safeConsoleWrite = (method, payload) => {
    try {
        console[method](payload);
    } catch (error) {
        if (isBrokenPipeError(error)) {
            return;
        }

        // Swallow non-EPIPE write errors to keep logging from impacting app flow.
    }
};

const logger = {
    info: (message, meta) => safeConsoleWrite('log', formatMessage('info', message, meta)),
    warn: (message, meta) => safeConsoleWrite('warn', formatMessage('warn', message, meta)),
    error: (message, meta) => safeConsoleWrite('error', formatMessage('error', message, meta)),
    debug: (message, meta) => {
        if (process.env.NODE_ENV !== 'production') {
            safeConsoleWrite('debug', formatMessage('debug', message, meta));
        }
    },
    redactSensitiveData,
    REDACTED_PLACEHOLDER,
    sanitizeUrlLikeValue,
};

module.exports = logger;
