const crypto = require('crypto');
const { isProduction } = require('../utils/cryptoKdf');

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|token|otp|password|secret|api[_-]?key|apikey|card|cvv|pan|private|rawbody|payload|signature|credential|proof)/i;
const LONG_SECRET_PATTERN = /\b(sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;
const SECURITY_HASH_CONTEXT = 'aura-security-log-pseudonym-v1';

// Security-log pseudonyms must not be forgeable. Previously an unconfigured
// environment silently fell back to a hardcoded string, which meant anyone who
// read the source could mint valid-looking pseudonyms and correlate logs
// across tenants. Outside production we now derive from an ephemeral random key
// instead: pseudonyms stay stable within a process (so one request's logs still
// correlate) but are worthless across restarts. Production fails closed.
const DEV_FALLBACK_KEY = crypto.randomBytes(32).toString('hex');

let missingKeyWarned = false;

const getSecurityHashKey = () => {
    const configured = String(
        process.env.SECURITY_LOG_HASH_KEY
        || process.env.OTP_FLOW_SECRET
        || process.env.SESSION_SECRET
        || process.env.JWT_SECRET
        || ''
    ).trim();

    if (configured) return configured;

    if (isProduction()) {
        throw new Error(
            'Security log pseudonymisation requires SECURITY_LOG_HASH_KEY (or OTP_FLOW_SECRET/SESSION_SECRET/JWT_SECRET) in production'
        );
    }

    if (!missingKeyWarned) {
        missingKeyWarned = true;
        // eslint-disable-next-line no-console
        console.warn(
            '[security] SECURITY_LOG_HASH_KEY is not configured; using an ephemeral per-process key. '
            + 'Log pseudonyms will not be stable across restarts.'
        );
    }
    return DEV_FALLBACK_KEY;
};

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
