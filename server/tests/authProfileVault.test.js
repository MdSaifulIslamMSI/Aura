const fs = require('fs/promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

const makeVaultEnv = (suffix) => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_VAULT_ENABLED_IN_TEST = 'true';
    process.env.AUTH_VAULT_FILE = `auth-vault.${suffix}.json`;
    process.env.AUTH_VAULT_TMP_FILE = `auth-vault.${suffix}.tmp.json`;
};

const loadVaultService = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../services/authProfileVault');
};

describe('authProfileVault key rotation', () => {
    afterEach(async () => {
        const vaultFile = process.env.AUTH_VAULT_FILE;
        const tmpFile = process.env.AUTH_VAULT_TMP_FILE;
        if (vaultFile) {
            await fs.unlink(path.join(dataDir, vaultFile)).catch(() => {});
        }
        if (tmpFile) {
            await fs.unlink(path.join(dataDir, tmpFile)).catch(() => {});
        }
        delete process.env.AUTH_VAULT_SECRET;
        delete process.env.AUTH_VAULT_SECRET_VERSION;
        delete process.env.AUTH_VAULT_PREVIOUS_SECRETS;
        delete process.env.AUTH_VAULT_ENABLED_IN_TEST;
        delete process.env.AUTH_VAULT_FILE;
        delete process.env.AUTH_VAULT_TMP_FILE;
    });

    test('stores keyVersion and decrypts profile snapshots', async () => {
        makeVaultEnv('rotation-store');
        process.env.AUTH_VAULT_SECRET = '0123456789abcdef0123456789abcdef'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- deterministic test-only vault key
        process.env.AUTH_VAULT_SECRET_VERSION = 'v2';

        const { saveAuthProfileSnapshot, getAuthProfileSnapshotByEmail, resolveVaultFile } = loadVaultService();

        await saveAuthProfileSnapshot({ email: 'User@Email.com', name: 'User Name', phone: '123 456 7890' });
        const profile = await getAuthProfileSnapshotByEmail('user@email.com');

        expect(profile).toBeTruthy();
        expect(profile.name).toBe('User Name');
        expect(profile.phone).toBe('1234567890');
        expect(profile.keyVersion).toBe('v2');

        const rawVault = JSON.parse(await fs.readFile(resolveVaultFile(), 'utf8'));
        expect(rawVault['user@email.com'].keyVersion).toBe('v2');
        expect(rawVault['user@email.com'].name).toContain(':');
    });

    test('can decrypt with previous key and rotates record to current key', async () => {
        makeVaultEnv('rotation-migrate');
        process.env.AUTH_VAULT_SECRET = 'legacy-secret-0123456789abcdef012345';
        process.env.AUTH_VAULT_SECRET_VERSION = 'v1';

        let vaultService = loadVaultService();
        await vaultService.saveAuthProfileSnapshot({ email: 'rotate@example.com', name: 'Rotate Me', phone: '1112223333' });

        process.env.AUTH_VAULT_SECRET = 'new-secret-abcdef0123456789abcdef01';
        process.env.AUTH_VAULT_SECRET_VERSION = 'v2';
        process.env.AUTH_VAULT_PREVIOUS_SECRETS = 'v1:legacy-secret-0123456789abcdef012345';

        vaultService = loadVaultService();
        const profile = await vaultService.getAuthProfileSnapshotByEmail('rotate@example.com');

        expect(profile).toBeTruthy();
        expect(profile.name).toBe('Rotate Me');
        expect(profile.keyVersion).toBe('v1');

        const rawVault = JSON.parse(await fs.readFile(vaultService.resolveVaultFile(), 'utf8'));
        expect(rawVault['rotate@example.com'].keyVersion).toBe('v2');
    });
});

describe('authProfileVault ciphertext format', () => {
    afterEach(async () => {
        const vaultFile = process.env.AUTH_VAULT_FILE;
        const tmpFile = process.env.AUTH_VAULT_TMP_FILE;
        if (vaultFile) {
            await fs.unlink(path.join(dataDir, vaultFile)).catch(() => {});
        }
        if (tmpFile) {
            await fs.unlink(path.join(dataDir, tmpFile)).catch(() => {});
        }
        delete process.env.AUTH_VAULT_SECRET;
        delete process.env.AUTH_VAULT_SECRET_VERSION;
        delete process.env.AUTH_VAULT_PREVIOUS_SECRETS;
        delete process.env.AUTH_VAULT_ENABLED_IN_TEST;
        delete process.env.AUTH_VAULT_FILE;
        delete process.env.AUTH_VAULT_TMP_FILE;
        jest.restoreAllMocks();
    });

    test('encrypts with a per-record salt under the v1 payload format', async () => {
        makeVaultEnv('format-salt');
        process.env.AUTH_VAULT_SECRET = '0123456789abcdef0123456789abcdef'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- deterministic test-only vault key

        const { saveAuthProfileSnapshot, resolveVaultFile } = loadVaultService();
        await saveAuthProfileSnapshot({ email: 'salt@example.com', name: 'Same Name', phone: '1112223333' });
        await saveAuthProfileSnapshot({ email: 'salt2@example.com', name: 'Same Name', phone: '1112223333' });

        const rawVault = JSON.parse(await fs.readFile(resolveVaultFile(), 'utf8'));
        const first = rawVault['salt@example.com'].name.split(':');
        const second = rawVault['salt2@example.com'].name.split(':');

        expect(first).toHaveLength(5);
        expect(first[0]).toBe('v1');
        expect(second[0]).toBe('v1');
        expect(first[1]).not.toBe(second[1]);
    });

    test('still decrypts legacy records written with the original static derivation salt', async () => {
        makeVaultEnv('format-legacy');
        process.env.AUTH_VAULT_SECRET = 'legacy-compatible-secret-0123456789'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- deterministic test-only vault key
        process.env.AUTH_VAULT_SECRET_VERSION = 'v1';

        const crypto = require('crypto');
        const { saveAuthProfileSnapshot, getAuthProfileSnapshotByEmail, resolveVaultFile } = loadVaultService();
        await saveAuthProfileSnapshot({ email: 'placeholder@example.com', name: 'Placeholder', phone: '' });

        const key = crypto.scryptSync(process.env.AUTH_VAULT_SECRET, 'aura-salt', 32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
        let encrypted = cipher.update('Legacy Name', 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const legacyCiphertext = `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;

        const rawVault = JSON.parse(await fs.readFile(resolveVaultFile(), 'utf8'));
        rawVault['legacy@example.com'] = {
            ...rawVault['placeholder@example.com'],
            email: legacyCiphertext,
            name: legacyCiphertext,
            keyVersion: 'v1',
        };
        await fs.writeFile(resolveVaultFile(), JSON.stringify(rawVault), 'utf8');

        const profile = await getAuthProfileSnapshotByEmail('legacy@example.com');
        expect(profile).toBeTruthy();
        expect(profile.name).toBe('Legacy Name');
    });

    test('never falls back to plaintext when encryption fails', async () => {
        makeVaultEnv('format-fail-closed');
        process.env.AUTH_VAULT_SECRET = '0123456789abcdef0123456789abcdef'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- deterministic test-only vault key

        const crypto = require('crypto');
        jest.spyOn(crypto, 'createCipheriv').mockImplementation(() => {
            throw new Error('simulated cipher failure');
        });

        const { saveAuthProfileSnapshot, resolveVaultFile } = loadVaultService();
        await saveAuthProfileSnapshot({ email: 'failclosed@example.com', name: 'Secret Name', phone: '1112223333' });

        const rawContent = await fs.readFile(resolveVaultFile(), 'utf8');
        expect(rawContent).not.toContain('Secret Name');
        expect(rawContent).not.toContain('failclosed@example.com');
    });
});
