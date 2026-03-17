const trim = (value, fallback = '') => String(value || fallback).trim();

const MIN_SECRET_LENGTH = 32;

const nodeEnv = trim(process.env.NODE_ENV, '').toLowerCase();
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const flags = {
    authVaultSecret: trim(process.env.AUTH_VAULT_SECRET, ''),
    authVaultSecretVersion: trim(process.env.AUTH_VAULT_SECRET_VERSION, 'v1') || 'v1',
    authVaultPreviousSecrets: trim(process.env.AUTH_VAULT_PREVIOUS_SECRETS, ''),
};

const secretLooksStrong = (secret) => {
    if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
    const lowered = secret.toLowerCase();
    if (lowered.includes('change-me') || lowered.includes('default') || lowered.includes('secret')) {
        return false;
    }
    return true;
};

const assertAuthVaultConfig = () => {
    if (isTest) return;

    if (!flags.authVaultSecret) {
        if (isProduction) {
            logger.warn('auth_vault.missing_secret', { tip: 'AUTH_VAULT_SECRET missing in production. Auth vault features will be unavailable. Please configure it in your Render dashboard.' });
            return;
        }
        throw new Error('AUTH_VAULT_SECRET is required outside test environment');
    }

    if (!flags.authVaultSecretVersion) {
        throw new Error('AUTH_VAULT_SECRET_VERSION must not be empty when AUTH_VAULT_SECRET is set');
    }

    if (isProduction && !secretLooksStrong(flags.authVaultSecret)) {
        throw new Error(`AUTH_VAULT_SECRET must be at least ${MIN_SECRET_LENGTH} chars and not use weak/default phrases in production`);
    }
};

module.exports = {
    flags,
    MIN_SECRET_LENGTH,
    secretLooksStrong,
    assertAuthVaultConfig,
};
