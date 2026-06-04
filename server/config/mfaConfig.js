const crypto = require('crypto');

const MIN_MFA_SECRET_LENGTH = 32;
const DEFAULT_MFA_CHALLENGE_TTL_SECONDS = 300;
const DEFAULT_MFA_FRESH_WINDOW_SECONDS = 900;

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = safeString(value).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const integer = Math.floor(parsed);
    if (integer < min) return fallback;
    return Math.min(integer, max);
};

const isPlaceholderValue = (value = '') => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return false;
    return /<[^>]+>|replace-with|change-?me|placeholder|your-|example\.(com|test|invalid)|\.example\b/.test(normalized);
};

const secretLooksStrong = (value = '') => {
    const secret = safeString(value);
    if (secret.length < MIN_MFA_SECRET_LENGTH) return false;
    if (isPlaceholderValue(secret)) return false;
    if (/^(.)\1+$/.test(secret)) return false;
    if (/password|secret|changeme|development|local-only/i.test(secret)) return false;
    return true;
};

const resolveMfaConfig = (env = process.env) => ({
    enabled: parseBoolean(env.MFA_ENABLED, false),
    totpEnabled: parseBoolean(env.MFA_TOTP_ENABLED, false),
    passkeyEnabled: parseBoolean(env.MFA_PASSKEY_ENABLED, false),
    recoveryCodesEnabled: parseBoolean(env.MFA_RECOVERY_CODES_ENABLED, true),
    requiredForAdmins: parseBoolean(env.MFA_REQUIRED_FOR_ADMINS, false),
    requiredForSellers: parseBoolean(env.MFA_REQUIRED_FOR_SELLERS, false),
    emailOtpFallbackEnabled: parseBoolean(env.MFA_EMAIL_OTP_FALLBACK_ENABLED, false),
    challengeTtlSeconds: parsePositiveInteger(
        env.MFA_CHALLENGE_TTL_SECONDS,
        DEFAULT_MFA_CHALLENGE_TTL_SECONDS,
        { min: 60, max: 3600 }
    ),
    freshWindowSeconds: parsePositiveInteger(
        env.MFA_FRESH_WINDOW_SECONDS,
        DEFAULT_MFA_FRESH_WINDOW_SECONDS,
        { min: 60, max: 86400 }
    ),
    secretEncryptionKey: safeString(env.MFA_SECRET_ENCRYPTION_KEY),
});

const decodeEncryptionKeyCandidate = (secret = '') => {
    const trimmed = safeString(secret);
    if (!trimmed) return null;

    if (/^[a-f0-9]{64}$/i.test(trimmed)) {
        return Buffer.from(trimmed, 'hex');
    }

    try {
        const decoded = Buffer.from(trimmed, 'base64');
        if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')) {
            return decoded;
        }
    } catch {
        // Fall back to derived key below.
    }

    return crypto.createHash('sha256').update(trimmed).digest();
};

const getMfaEncryptionKey = (env = process.env) => {
    const config = resolveMfaConfig(env);
    if (!secretLooksStrong(config.secretEncryptionKey)) {
        throw new Error('MFA_SECRET_ENCRYPTION_KEY must be at least 32 strong characters when TOTP MFA is enabled');
    }
    return decodeEncryptionKeyCandidate(config.secretEncryptionKey);
};

const validateMfaEnvironment = ({
    env = process.env,
    runtimeEnv = env.NODE_ENV || 'development',
    allowPlaceholders = false,
} = {}) => {
    const config = resolveMfaConfig(env);
    const production = safeString(runtimeEnv).toLowerCase() === 'production';
    const placeholderAllowed = Boolean(allowPlaceholders && !production);
    const failures = [];
    const warnings = [];

    if (config.totpEnabled && !config.enabled) {
        warnings.push('MFA_TOTP_ENABLED=true has no effect while MFA_ENABLED=false');
    }
    if (config.passkeyEnabled && !config.enabled) {
        warnings.push('MFA_PASSKEY_ENABLED=true has no effect while MFA_ENABLED=false');
    }

    if (config.totpEnabled) {
        if (!config.secretEncryptionKey) {
            failures.push('MFA_SECRET_ENCRYPTION_KEY is required when MFA_TOTP_ENABLED=true');
        } else if (isPlaceholderValue(config.secretEncryptionKey)) {
            const message = 'MFA_SECRET_ENCRYPTION_KEY must be replaced before use';
            if (placeholderAllowed) warnings.push(message);
            else failures.push(message);
        } else if (!secretLooksStrong(config.secretEncryptionKey)) {
            failures.push(`MFA_SECRET_ENCRYPTION_KEY must be at least ${MIN_MFA_SECRET_LENGTH} strong characters`);
        }
    }

    return {
        ok: failures.length === 0,
        safe: failures.length === 0,
        production,
        config,
        failures,
        warnings,
    };
};

module.exports = {
    DEFAULT_MFA_CHALLENGE_TTL_SECONDS,
    DEFAULT_MFA_FRESH_WINDOW_SECONDS,
    MIN_MFA_SECRET_LENGTH,
    getMfaEncryptionKey,
    isPlaceholderValue,
    parseBoolean,
    parsePositiveInteger,
    resolveMfaConfig,
    secretLooksStrong,
    validateMfaEnvironment,
};
