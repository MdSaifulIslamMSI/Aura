const os = require('os');
const { hashSecurityValue } = require('../security/redactSecurityMetadata');

const REDACTED_PLACEHOLDER = '[REDACTED]';
// PII-bearing key families. Addresses, names, postal codes, IPs, user agents,
// mobile numbers and birth dates are personal data under GDPR/DPDP and must
// never reach logs in cleartext — the original pattern covered secrets but
// silently passed the most common PII classes through.
const SENSITIVE_KEY_PATTERN = /(phone|mobile|email|authorization|token|password|pass|otp|secret|jwt|api[_-]?key|card(?:number)?|cvv|pan|credential|signature|private|rawbody|payload|first_?name|last_?name|full_?name|recipient_?name|shipping_?name|contact_?name|customer_?name|display_?name|user_?name|address|street|city|state|country|pincode|pin_?code|postal_?code|zip|location|latitude|longitude|(?:client|remote|source|sender|user|origin|real|forwarded)_?ip|ip_?address|(?:^|[^a-z])ip(?:[^a-z]|$)|user_?agent|dob|date_?of_?birth)/i;
const IDENTIFIER_KEY_PATTERN = /^(userId|uid|firebaseUid|authUid|accountId|actorId|resourceId|ownerId|tenantId|sellerId|buyerId)$/i;
const HASHED_IDENTIFIER_PATTERN = /^[a-f0-9]{16}$/i;
const URL_LIKE_KEY_PATTERN = /(url|uri|path|route)$/i;
// A URL-ish token is the longest run of characters that are not whitespace, a
// quote or a backtick. This is the unit the query-string redaction operates
// on, so the text is tokenised first and the query rule is applied per token.
const URL_TOKEN_PATTERN = /[^\s"'`]+/g;
const SENSITIVE_TEXT_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;
// Free-text PII: an email address, a 13-19 digit card (with or without
// separators), or a 10+ digit run (phone numbers, unseparated cards) embedded
// in a log message or stack trace.
const EMAIL_IN_TEXT_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD_NUMBER_IN_TEXT_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/g;
const LONG_DIGIT_RUN_PATTERN = /\b\d{10,}\b/g;

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

/**
 * Redacts the query string of one URL-ish token.
 *
 * The query string starts at the first '?' a URL prefix can reach. A prefix
 * is either a scheme ("http://" / "https://") or a single '/', and the path
 * that follows it must be at least one character long and must not itself
 * start with '?'. The scheme form is never the deciding one: every scheme
 * contains a '/', and the '/' form accepts everything the scheme form does,
 * so one '/' test covers both.
 *
 * WHY THIS IS NOT A REGULAR EXPRESSION: the same rule used to be expressed as
 * one, and the ambiguity between the literal '/' in the prefix and the '/'
 * that the path character class also matched made the match quadratic. The
 * text being redacted is attacker-influenced log content, so a token of 20k
 * '/' characters took ~1.4s to redact. One pass over the token is linear in
 * its length and produces byte-for-byte the same output.
 */
const redactUrlQueryInToken = (token) => {
    // `candidate` is the earliest '/' that can open a URL: the character after
    // it must exist and must not itself be the '?' that starts the query.
    let candidate = -1;
    for (let index = 0; index < token.length; index += 1) {
        if (token[index] === '?') {
            // The query is reachable when the candidate leaves at least one
            // path character before it.
            if (candidate !== -1 && candidate + 2 <= index) {
                return `${token.slice(0, index)}?${REDACTED_PLACEHOLDER}`;
            }
            continue;
        }
        if (candidate === -1
            && token[index] === '/'
            && index + 1 < token.length
            && token[index + 1] !== '?') {
            candidate = index;
        }
    }
    return token;
};

const redactUrlQueriesInText = (value) => {
    const text = String(value || '');
    if (!text) return text;

    let redacted = '';
    let cursor = 0;
    for (const match of text.matchAll(URL_TOKEN_PATTERN)) {
        redacted += text.slice(cursor, match.index);
        redacted += redactUrlQueryInToken(match[0]);
        cursor = match.index + match[0].length;
    }
    return redacted + text.slice(cursor);
};

const redactSensitiveText = (value) => redactUrlQueriesInText(value)
    .replace(SENSITIVE_TEXT_PATTERN, REDACTED_PLACEHOLDER)
    .replace(EMAIL_IN_TEXT_PATTERN, REDACTED_PLACEHOLDER)
    .replace(CARD_NUMBER_IN_TEXT_PATTERN, REDACTED_PLACEHOLDER)
    .replace(LONG_DIGIT_RUN_PATTERN, REDACTED_PLACEHOLDER);

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

const redactSensitiveData = (value, key = '', options = {}) => {
    if (value === null || value === undefined) return value;

    const normalizedKey = String(key || '');
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
        return sanitizeStringForKey(key, value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveData(item, key, options));
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
            acc[entryKey] = redactSensitiveData(entryValue, entryKey, options);
            return acc;
        }, {});
    }

    if (IDENTIFIER_KEY_PATTERN.test(normalizedKey)) {
        const normalizedValue = String(value || '').trim();
        if (HASHED_IDENTIFIER_PATTERN.test(normalizedValue)) return normalizedValue;
        // No usable key: drop the identifier rather than hash it under something
        // an attacker could also compute.
        if (options.skipPseudonymisation) return REDACTED_PLACEHOLDER;
        return hashSecurityValue(value);
    }
    if (URL_LIKE_KEY_PATTERN.test(normalizedKey)) {
        return sanitizeUrlLikeValue(value);
    }

    if (typeof value === 'string') return redactSensitiveText(value);

    return value;
};

const formatMessage = (level, message, meta = {}) => {
    // Pseudonymisation needs a configured key. If it is missing we must not emit
    // a forgeable pseudonym, but we also must not let a logging concern take down
    // a request — so fall back to plain redaction, which drops the identifier
    // entirely rather than hashing it under a weak or shared key.
    let sanitizedMeta;
    try {
        sanitizedMeta = redactSensitiveData(meta);
    } catch {
        sanitizedMeta = redactSensitiveData(meta, '', { skipPseudonymisation: true });
    }

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
    redactUrlQueriesInText,
    REDACTED_PLACEHOLDER,
    sanitizeUrlLikeValue,
};

module.exports = logger;
