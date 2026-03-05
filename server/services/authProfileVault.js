const fs = require('fs/promises');
const path = require('path');
const logger = require('../utils/logger');

const VAULT_DIR = path.join(__dirname, '..', 'data');
const VAULT_FILE = path.join(VAULT_DIR, 'auth-vault.json');
const VAULT_TMP_FILE = path.join(VAULT_DIR, 'auth-vault.tmp.json');

const MAX_RECORDS = 50000;

const parseBoolean = (value, fallback = true) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const isVaultEnabled = () => parseBoolean(process.env.AUTH_VAULT_ENABLED, true);

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
    await fs.mkdir(VAULT_DIR, { recursive: true });
    try {
        await fs.access(VAULT_FILE);
    } catch {
        await fs.writeFile(VAULT_FILE, '{}', 'utf8');
    }
};

const readVault = async () => {
    await ensureVaultFile();
    try {
        const content = await fs.readFile(VAULT_FILE, 'utf8');
        const parsed = JSON.parse(content || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        logger.error('auth_vault.read_failed', { error: error.message });
        return {};
    }
};

const writeVault = async (data) => {
    await ensureVaultFile();
    await fs.writeFile(VAULT_TMP_FILE, JSON.stringify(data), 'utf8');
    await fs.rename(VAULT_TMP_FILE, VAULT_FILE);
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

const saveAuthProfileSnapshot = async (profile) => {
    if (!isVaultEnabled()) return;
    const normalized = normalizeProfile(profile);
    if (!normalized) return;

    try {
        const vault = await readVault();
        vault[normalized.email] = normalized;
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
    const vault = await readVault();
    return vault[normalizedEmail] || null;
};

module.exports = {
    saveAuthProfileSnapshot,
    getAuthProfileSnapshotByEmail,
};

