const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

const VAULT_DIR = path.join(__dirname, '..', 'data');
const KEY_DERIVATION_SALT = 'aura-salt';
const CURRENT_KEY_VERSION = String(process.env.AUTH_VAULT_SECRET_VERSION || 'v1').trim() || 'v1';

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const isTestEnvironment = () => process.env.NODE_ENV === 'test';

const getCurrentVaultSecret = () => {
    const secret = String(process.env.AUTH_VAULT_SECRET || '').trim();
    if (secret) return secret;
    if (isTestEnvironment()) return '';
    throw new Error('AUTH_VAULT_SECRET is required for auth profile vault operations outside test environment');
};

const parseKeyConfigEntry = (entry, generatedVersionPrefix) => {
    const raw = String(entry || '').trim();
    if (!raw) return null;

    const separatorIndex = raw.indexOf(':');
    if (separatorIndex > 0) {
        const version = raw.slice(0, separatorIndex).trim();
        const secret = raw.slice(separatorIndex + 1).trim();
        if (!version || !secret) return null;
        return { version, secret };
    }

    return {
        version: `${generatedVersionPrefix}${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8)}`,
        secret: raw,
    };
};

const getVaultKeyEntries = () => {
    const entries = [];
    const currentSecret = getCurrentVaultSecret();
    if (currentSecret) {
        entries.push({ version: CURRENT_KEY_VERSION, secret: currentSecret });
    }

    const previousRaw = String(process.env.AUTH_VAULT_PREVIOUS_SECRETS || '').trim();
    if (!previousRaw) return entries;

    const previousEntries = previousRaw
        .split(',')
        .map((entry) => parseKeyConfigEntry(entry, 'legacy-'))
        .filter(Boolean)
        .filter((entry) => entry.secret !== currentSecret);

    return entries.concat(previousEntries);
};

const getVaultSecretsByVersion = () => new Map(
    getVaultKeyEntries().map((entry) => [entry.version, entry.secret])
);

const encrypt = (text, secret) => {
    if (!text) return '';
    try {
        const iv = crypto.randomBytes(12);
        const key = crypto.scryptSync(secret, KEY_DERIVATION_SALT, 32);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (error) {
        logger.error('vault.encrypt_failed', { error: error.message });
        return text;
    }
};

const decrypt = (data, secret) => {
    if (!data || !data.includes(':') || !secret) return data;
    try {
        const [ivHex, authTagHex, encrypted] = data.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const key = crypto.scryptSync(secret, KEY_DERIVATION_SALT, 32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        return null;
    }
};

const MAX_RECORDS = 50000;
const isVaultEnabled = () => {
    if (isTestEnvironment()) {
        return parseBoolean(process.env.AUTH_VAULT_ENABLED_IN_TEST, false);
    }
    return parseBoolean(process.env.AUTH_VAULT_ENABLED, false);
};

const resolveVaultFile = () => {
    const customPath = String(process.env.AUTH_VAULT_FILE || '').trim();
    if (customPath) {
        return path.isAbsolute(customPath)
            ? customPath
            : path.join(VAULT_DIR, customPath);
    }

    const filename = isTestEnvironment() ? 'auth-vault.test.json' : 'auth-vault.json';
    return path.join(VAULT_DIR, filename);
};

const resolveVaultTmpFile = () => {
    const customTempPath = String(process.env.AUTH_VAULT_TMP_FILE || '').trim();
    if (customTempPath) {
        return path.isAbsolute(customTempPath)
            ? customTempPath
            : path.join(VAULT_DIR, customTempPath);
    }

    const filename = isTestEnvironment() ? 'auth-vault.test.tmp.json' : 'auth-vault.tmp.json';
    return path.join(VAULT_DIR, filename);
};

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizePhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const normalizeProfile = (input = {}) => {
    const email = normalizeEmail(input.email);
    if (!email) return null;

    return {
        email,
        name: String(input.name || '').trim().slice(0, 120) || 'Aura User',
        phone: normalizePhone(input.phone || ''),
        avatar: String(input.avatar || '').trim().slice(0, 300),
        gender: String(input.gender || '').trim().slice(0, 32),
        dob: input.dob ? new Date(input.dob).toISOString() : null,
        bio: String(input.bio || '').trim().slice(0, 500),
        isVerified: Boolean(input.isVerified),
        isAdmin: Boolean(input.isAdmin),
        updatedAt: new Date().toISOString(),
    };
};

const ensureVaultFile = async () => {
    const vaultFile = resolveVaultFile();
    await fs.mkdir(VAULT_DIR, { recursive: true });
    try {
        await fs.access(vaultFile);
    } catch {
        await fs.writeFile(vaultFile, '{}', 'utf8');
    }
};

const readVault = async () => {
    const vaultFile = resolveVaultFile();
    await ensureVaultFile();
    try {
        const content = await fs.readFile(vaultFile, 'utf8');
        const parsed = JSON.parse(content || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        logger.error('auth_vault.read_failed', { error: error.message });
        return {};
    }
};

const writeVault = async (data) => {
    const vaultFile = resolveVaultFile();
    const vaultTmpFile = resolveVaultTmpFile();
    await ensureVaultFile();
    await fs.writeFile(vaultTmpFile, JSON.stringify(data), 'utf8');
    await fs.rename(vaultTmpFile, vaultFile);
};

const enforceVaultSize = (vault) => {
    const entries = Object.entries(vault);
    if (entries.length <= MAX_RECORDS) return vault;
    const sorted = entries.sort((a, b) => {
        const aTs = new Date(a[1]?.updatedAt || 0).getTime();
        const bTs = new Date(b[1]?.updatedAt || 0).getTime();
        return bTs - aTs;
    });
    return Object.fromEntries(sorted.slice(0, MAX_RECORDS));
};

const decryptField = (value, keyVersion, secretsByVersion) => {
    if (!value || typeof value !== 'string') {
        return { value: value || '', usedVersion: keyVersion || null, encrypted: false };
    }
    if (!value.includes(':')) {
        return { value, usedVersion: keyVersion || null, encrypted: false };
    }

    const attemptedVersions = new Set();
    if (keyVersion && secretsByVersion.has(keyVersion)) {
        attemptedVersions.add(keyVersion);
        const decrypted = decrypt(value, secretsByVersion.get(keyVersion));
        if (decrypted !== null) {
            return { value: decrypted, usedVersion: keyVersion, encrypted: true };
        }
    }

    for (const [version, secret] of secretsByVersion.entries()) {
        if (attemptedVersions.has(version)) continue;
        const decrypted = decrypt(value, secret);
        if (decrypted !== null) {
            return { value: decrypted, usedVersion: version, encrypted: true };
        }
    }

    logger.error('vault.decrypt_failed', { keyVersion });
    return { value, usedVersion: keyVersion || null, encrypted: true };
};

const buildEncryptedProfile = (normalized, secret) => ({
    ...normalized,
    keyVersion: CURRENT_KEY_VERSION,
    name: encrypt(normalized.name, secret),
    phone: encrypt(normalized.phone, secret),
    email: encrypt(normalized.email, secret),
});

const saveAuthProfileSnapshot = async (profile) => {
    if (!isVaultEnabled()) return;
    const normalized = normalizeProfile(profile);
    if (!normalized) return;

    try {
        const currentSecret = getCurrentVaultSecret();
        const vault = await readVault();
        const encryptedProfile = buildEncryptedProfile(normalized, currentSecret);
        vault[normalized.email] = encryptedProfile;
        await writeVault(enforceVaultSize(vault));
    } catch (error) {
        logger.error('auth_vault.write_failed', {
            email: normalized.email,
            error: error.message,
        });
    }
};

const getAuthProfileSnapshotByEmail = async (email) => {
    if (!isVaultEnabled()) return null;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;

    const currentSecret = getCurrentVaultSecret();
    const secretsByVersion = getVaultSecretsByVersion();
    const vault = await readVault();
    const profile = vault[normalizedEmail] || null;

    if (profile) {
        const decryptedName = decryptField(profile.name, profile.keyVersion, secretsByVersion);
        const decryptedPhone = decryptField(profile.phone, profile.keyVersion, secretsByVersion);
        const decryptedEmail = decryptField(profile.email, profile.keyVersion, secretsByVersion);

        const decryptedProfile = {
            ...profile,
            keyVersion: profile.keyVersion || CURRENT_KEY_VERSION,
            name: decryptedName.value,
            phone: decryptedPhone.value,
            email: decryptedEmail.value,
        };

        const shouldRotateKey = !profile.keyVersion
            || profile.keyVersion !== CURRENT_KEY_VERSION
            || decryptedName.usedVersion !== CURRENT_KEY_VERSION
            || decryptedPhone.usedVersion !== CURRENT_KEY_VERSION
            || decryptedEmail.usedVersion !== CURRENT_KEY_VERSION;

        if (shouldRotateKey) {
            vault[normalizedEmail] = buildEncryptedProfile(
                {
                    ...decryptedProfile,
                    email: normalizeEmail(decryptedProfile.email) || normalizedEmail,
                    updatedAt: new Date().toISOString(),
                },
                currentSecret
            );
            await writeVault(enforceVaultSize(vault));
        }

        return decryptedProfile;
    }
    return null;
};

module.exports = {
    saveAuthProfileSnapshot,
    getAuthProfileSnapshotByEmail,
    resolveVaultFile,
};
