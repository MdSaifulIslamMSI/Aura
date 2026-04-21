const crypto = require('crypto');
const { flags: authVaultFlags, MIN_SECRET_LENGTH, secretLooksStrong } = require('./authVaultFlags');

const trim = (value, fallback = '') => String(value || fallback).trim();

const nodeEnv = trim(process.env.NODE_ENV, '').toLowerCase();
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const TEST_TRUSTED_DEVICE_SECRET = 'trusted-device-test-secret-0123456789abcdef';
const TEST_TRUSTED_DEVICE_VERSION = 'test-v1';

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const normalizeTrustedDeviceMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['always', 'admin', 'seller', 'privileged', 'off'].includes(normalized)) {
        return normalized;
    }
    return 'off';
};

const parseKeyConfigEntry = (entry, generatedVersionPrefix) => {
    const raw = String(entry || '').trim();
    if (!raw) return null;

    const separatorIndex = raw.indexOf(':');
    if (separatorIndex > 0) {
        const version = raw.slice(0, separatorIndex).trim();
        const secret = raw.slice(separatorIndex + 1).trim();
        if (!version || !secret) return null;
        return { version, secret, source: 'previous' };
    }

    return {
        version: `${generatedVersionPrefix}${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8)}`,
        secret: raw,
        source: 'previous',
    };
};

const flags = {
    authDeviceChallengeMode: normalizeTrustedDeviceMode(
        process.env.AUTH_DEVICE_CHALLENGE_MODE || process.env.AUTH_LATTICE_CHALLENGE_MODE
    ),
    authDeviceChallengeSecret: trim(process.env.AUTH_DEVICE_CHALLENGE_SECRET, ''),
    authDeviceChallengeSecretVersion: trim(process.env.AUTH_DEVICE_CHALLENGE_SECRET_VERSION, 'v1') || 'v1',
    authDeviceChallengePreviousSecrets: trim(process.env.AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS, ''),
    authDeviceChallengeAllowVaultFallback: parseBoolean(process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK, false),
    authTrustedDevicePreferWebAuthn: parseBoolean(process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN, true),
    authWebAuthnRpName: trim(process.env.AUTH_WEBAUTHN_RP_NAME, 'Aura Trusted Device') || 'Aura Trusted Device',
    authWebAuthnRpId: trim(process.env.AUTH_WEBAUTHN_RP_ID, ''),
    authWebAuthnOrigin: trim(process.env.AUTH_WEBAUTHN_ORIGIN, ''),
    authWebAuthnUserVerification: trim(process.env.AUTH_WEBAUTHN_USER_VERIFICATION, 'required').toLowerCase() || 'required',
    authWebAuthnAuthenticatorAttachment: trim(process.env.AUTH_WEBAUTHN_AUTHENTICATOR_ATTACHMENT, 'platform').toLowerCase() || 'platform',
    authWebAuthnTimeoutMs: Math.max(Number(process.env.AUTH_WEBAUTHN_TIMEOUT_MS || 60_000), 15_000),
};

const getCurrentTrustedDeviceKeyEntry = () => {
    if (flags.authDeviceChallengeSecret) {
        return {
            version: flags.authDeviceChallengeSecretVersion,
            secret: flags.authDeviceChallengeSecret,
            source: 'trusted_device',
        };
    }

    if (flags.authDeviceChallengeAllowVaultFallback && authVaultFlags.authVaultSecret) {
        const authVaultVersion = String(authVaultFlags.authVaultSecretVersion || 'v1').trim() || 'v1';
        return {
            version: authVaultVersion.startsWith('vault-') ? authVaultVersion : `vault-${authVaultVersion}`,
            secret: authVaultFlags.authVaultSecret,
            source: 'auth_vault',
        };
    }

    if (isTest) {
        return {
            version: TEST_TRUSTED_DEVICE_VERSION,
            secret: TEST_TRUSTED_DEVICE_SECRET,
            source: 'test',
        };
    }

    return null;
};

const getTrustedDeviceKeyEntries = () => {
    const entries = [];
    const currentEntry = getCurrentTrustedDeviceKeyEntry();

    if (currentEntry?.secret) {
        entries.push(currentEntry);
    }

    const previousEntries = String(flags.authDeviceChallengePreviousSecrets || '')
        .split(',')
        .map((entry) => parseKeyConfigEntry(entry, 'legacy-device-'))
        .filter(Boolean)
        .filter((entry) => entry.secret !== currentEntry?.secret);

    return entries.concat(previousEntries);
};

const getTrustedDeviceSecretsByVersion = () => new Map(
    getTrustedDeviceKeyEntries().map((entry) => [entry.version, entry.secret])
);

const shouldRequireTrustedDevice = ({ user = null, mode = flags.authDeviceChallengeMode } = {}) => {
    switch (normalizeTrustedDeviceMode(mode)) {
    case 'always':
        return true;
    case 'admin':
        return Boolean(user?.isAdmin);
    case 'seller':
        return Boolean(user?.isSeller);
    case 'privileged':
        return Boolean(user?.isAdmin || user?.isSeller);
    case 'off':
    default:
        return false;
    }
};

const assertTrustedDeviceConfig = () => {
    if (isTest) return;

    const challengeMode = flags.authDeviceChallengeMode;
    const hasDedicatedSecret = Boolean(flags.authDeviceChallengeSecret);

    if (hasDedicatedSecret && !flags.authDeviceChallengeSecretVersion) {
        throw new Error('AUTH_DEVICE_CHALLENGE_SECRET_VERSION must not be empty when AUTH_DEVICE_CHALLENGE_SECRET is set');
    }

    if (hasDedicatedSecret && isProduction && !secretLooksStrong(flags.authDeviceChallengeSecret)) {
        throw new Error(`AUTH_DEVICE_CHALLENGE_SECRET must be at least ${MIN_SECRET_LENGTH} chars and not use weak/default phrases in production`);
    }

    if (challengeMode === 'off') {
        return;
    }

    if (hasDedicatedSecret) {
        return;
    }

    if (!flags.authDeviceChallengeAllowVaultFallback) {
        throw new Error(
            'AUTH_DEVICE_CHALLENGE_SECRET is required when trusted-device challenge mode is enabled. '
            + 'Set AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK=true only if you intentionally want to reuse AUTH_VAULT_SECRET.'
        );
    }

    if (!authVaultFlags.authVaultSecret) {
        throw new Error(
            'AUTH_VAULT_SECRET is required when AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK=true and trusted-device challenge mode is enabled'
        );
    }
};

module.exports = {
    flags,
    MIN_SECRET_LENGTH,
    TEST_TRUSTED_DEVICE_SECRET,
    TEST_TRUSTED_DEVICE_VERSION,
    parseBoolean,
    parseKeyConfigEntry,
    normalizeTrustedDeviceMode,
    getCurrentTrustedDeviceKeyEntry,
    getTrustedDeviceKeyEntries,
    getTrustedDeviceSecretsByVersion,
    shouldRequireTrustedDevice,
    assertTrustedDeviceConfig,
};
