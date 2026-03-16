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
        process.env.AUTH_VAULT_SECRET = '0123456789abcdef0123456789abcdef';
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
