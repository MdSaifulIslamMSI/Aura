const ORIGINAL_ENV = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_DEVICE_CHALLENGE_MODE: process.env.AUTH_DEVICE_CHALLENGE_MODE,
    AUTH_LATTICE_CHALLENGE_MODE: process.env.AUTH_LATTICE_CHALLENGE_MODE,
    AUTH_DEVICE_CHALLENGE_SECRET: process.env.AUTH_DEVICE_CHALLENGE_SECRET,
    AUTH_DEVICE_CHALLENGE_SECRET_VERSION: process.env.AUTH_DEVICE_CHALLENGE_SECRET_VERSION,
    AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS: process.env.AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS,
    AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK: process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK,
    AUTH_VAULT_SECRET: process.env.AUTH_VAULT_SECRET,
    AUTH_VAULT_SECRET_VERSION: process.env.AUTH_VAULT_SECRET_VERSION,
    AUTH_WEBAUTHN_AUTHENTICATOR_ATTACHMENT: process.env.AUTH_WEBAUTHN_AUTHENTICATOR_ATTACHMENT,
};

const loadFlags = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../config/authTrustedDeviceFlags');
};

describe('authTrustedDeviceFlags', () => {
    afterEach(() => {
        for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        jest.resetModules();
    });

    test('fails closed when trusted-device mode is enabled without a dedicated secret or explicit fallback', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'privileged';
        delete process.env.AUTH_DEVICE_CHALLENGE_SECRET;
        delete process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK;
        process.env.AUTH_VAULT_SECRET = 'vault-secret-0123456789abcdef0123456789';
        process.env.AUTH_VAULT_SECRET_VERSION = 'vault-v1';

        const { assertTrustedDeviceConfig } = loadFlags();

        expect(() => assertTrustedDeviceConfig()).toThrow(/AUTH_DEVICE_CHALLENGE_SECRET is required/);
    });

    test('allows an explicit vault fallback when challenge mode is enabled', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'admin';
        delete process.env.AUTH_DEVICE_CHALLENGE_SECRET;
        process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK = 'true';
        process.env.AUTH_VAULT_SECRET = 'vault-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ12';
        process.env.AUTH_VAULT_SECRET_VERSION = 'vault-v3';

        const {
            assertTrustedDeviceConfig,
            getCurrentTrustedDeviceKeyEntry,
        } = loadFlags();

        expect(() => assertTrustedDeviceConfig()).not.toThrow();
        expect(getCurrentTrustedDeviceKeyEntry()).toMatchObject({
            version: 'vault-v3',
            source: 'auth_vault',
        });
    });

    test('builds current and previous trusted-device rotation entries', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'always';
        process.env.AUTH_DEVICE_CHALLENGE_SECRET = 'trusted-device-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ12';
        process.env.AUTH_DEVICE_CHALLENGE_SECRET_VERSION = 'td-v2';
        process.env.AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS = 'td-v1:trusted-device-secret-legacy-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        const { getTrustedDeviceKeyEntries } = loadFlags();

        expect(getTrustedDeviceKeyEntries()).toEqual([
            {
                version: 'td-v2',
                secret: 'trusted-device-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ12',
                source: 'trusted_device',
            },
            {
                version: 'td-v1',
                secret: 'trusted-device-secret-legacy-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                source: 'previous',
            },
        ]);
    });
});
