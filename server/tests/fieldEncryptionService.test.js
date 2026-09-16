const ENV_KEYS = [
    'FIELD_ENCRYPTION_ENABLED',
    'FIELD_ENCRYPTION_KMS_KEY_ID',
    'FIELD_ENCRYPTION_MASTER_KEY',
    'FIELD_ENCRYPTION_KEY_VERSION',
    'FIELD_ENCRYPTION_PREVIOUS_KEYS',
];

const loadService = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../services/fieldEncryptionService');
};

describe('fieldEncryptionService', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'test';
        ENV_KEYS.forEach((key) => delete process.env[key]);
    });

    afterEach(() => {
        process.env.NODE_ENV = previousNodeEnv;
        ENV_KEYS.forEach((key) => delete process.env[key]);
    });

    test('is a pass-through no-op when not enabled', async () => {
        const service = loadService();
        const primed = await service.primeFieldEncryption();

        expect(primed.enabled).toBe(false);
        expect(service.encrypt('home address line')).toBe('home address line');
        expect(service.decrypt('home address line')).toBe('home address line');
        expect(service.isEncrypted('home address line')).toBe(false);
    });

    test('round-trips with a local master key and fresh IVs per record', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'a'.repeat(48);

        const service = loadService();
        await service.primeFieldEncryption();

        const first = service.encrypt('MG Road apartment 42');
        const second = service.encrypt('MG Road apartment 42');

        expect(first).not.toBe(second);
        expect(service.isEncrypted(first)).toBe(true);
        expect(first.split('.')).toHaveLength(5);
        expect(first.startsWith('v1.')).toBe(true);
        expect(service.decrypt(first)).toBe('MG Road apartment 42');
        expect(service.decrypt(second)).toBe('MG Road apartment 42');
    });

    test('passes empty values through and tolerates legacy plaintext on decrypt', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'b'.repeat(48);

        const service = loadService();
        await service.primeFieldEncryption();

        expect(service.encrypt('')).toBe('');
        expect(service.encrypt(null)).toBe(null);
        expect(service.decrypt('')).toBe('');
        expect(service.decrypt(null)).toBe(null);
        expect(service.decrypt('plaintext stored before rollout')).toBe('plaintext stored before rollout');
    });

    test('rejects a local master key in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'c'.repeat(48);

        const service = loadService();
        await expect(service.primeFieldEncryption()).rejects.toThrow(/not allowed in production/);
    });

    test('requires key material when enabled without configuration', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';

        const service = loadService();
        await expect(service.primeFieldEncryption()).rejects.toThrow(/requires FIELD_ENCRYPTION_KMS_KEY_ID/);
    });

    test('fails closed on writes when enabled but not primed', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'd'.repeat(48);

        const service = loadService();
        expect(() => service.encrypt('value')).toThrow(/not primed|key material/);
    });

    test('supports key rotation through previous keys', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'e'.repeat(48);
        process.env.FIELD_ENCRYPTION_KEY_VERSION = 'ka';

        const service = loadService();
        await service.primeFieldEncryption();
        const oldCiphertext = service.encrypt('rotate me');

        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'f'.repeat(48);
        process.env.FIELD_ENCRYPTION_KEY_VERSION = 'kb';
        process.env.FIELD_ENCRYPTION_PREVIOUS_KEYS = `ka:${'e'.repeat(48)}`;
        jest.resetModules();
        // eslint-disable-next-line global-require
        const rotated = require('../services/fieldEncryptionService');
        await rotated.primeFieldEncryption();

        expect(rotated.decrypt(oldCiphertext)).toBe('rotate me');
        const newCiphertext = rotated.encrypt('rotate me');
        expect(Buffer.from(newCiphertext.split('.')[1], 'base64url').toString('utf8')).toBe('kb');
    });

    test('returns null for tampered ciphertext', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = '0'.repeat(48);

        const service = loadService();
        await service.primeFieldEncryption();
        const ciphertext = service.encrypt('tamper target');
        const parts = ciphertext.split('.');
        parts[4] = Buffer.from('tampered').toString('base64url');

        expect(service.decrypt(parts.join('.'))).toBeNull();
    });

    test('primes from KMS and caches the data key in process memory', async () => {
        jest.mock('@aws-sdk/client-kms', () => {
            const generated = Buffer.alloc(32, 7);
            return {
                __kmsCalls: 0,
                GenerateDataKeyCommand: class {
                    constructor(input) {
                        this.input = input;
                    }
                },
                KMSClient: class {
                    // eslint-disable-next-line class-methods-use-this
                    async send(command) {
                        // eslint-disable-next-line global-require
                        const mod = require('@aws-sdk/client-kms');
                        mod.__kmsCalls += 1;
                        return { Plaintext: generated };
                    }
                },
            };
        });

        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_KMS_KEY_ID = 'alias/aura-field-encryption';

        const service = loadService();
        const primed = await service.primeFieldEncryption();
        expect(primed.enabled).toBe(true);

        const ciphertext = service.encrypt('kms protected value');
        expect(service.decrypt(ciphertext)).toBe('kms protected value');

        const kmsModule = require('@aws-sdk/client-kms');
        expect(kmsModule.__kmsCalls).toBe(1);
        jest.dontMock('@aws-sdk/client-kms');
    });
});
