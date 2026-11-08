'use strict';

const { generateHybridKemKey } = require('../security/pqc/keyMaterial');

const ENV_KEYS = [
    'FIELD_ENCRYPTION_ENABLED',
    'FIELD_ENCRYPTION_KMS_KEY_ID',
    'FIELD_ENCRYPTION_MASTER_KEY',
    'FIELD_ENCRYPTION_KEY_VERSION',
    'FIELD_ENCRYPTION_PREVIOUS_KEYS',
    'FIELD_ENCRYPTION_PQC_MODE',
    'FIELD_ENCRYPTION_PQC_KEM_KEY_REF',
    'FIELD_ENCRYPTION_PQC_KEM_PREVIOUS_KEY_REFS',
];

const loadService = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../services/fieldEncryptionService');
};

const resetEnv = () => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
};

describe('fieldEncryptionService PQC modes', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'test';
        resetEnv();
    });

    afterEach(() => {
        process.env.NODE_ENV = previousNodeEnv;
        resetEnv();
    });

    test('per-record mode seals each field with a hybrid KEM envelope', async () => {
        const kemKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'g'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'per-record';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(kemKey);

        const service = loadService();
        const primed = await service.primeFieldEncryption();
        expect(primed.pqc.effectiveMode).toBe('per-record');

        const first = service.encrypt('MG Road apartment 42');
        const second = service.encrypt('MG Road apartment 42');
        expect(first).not.toBe(second);
        expect(first.startsWith('pqc1.')).toBe(true);
        expect(service.isEncrypted(first)).toBe(true);
        expect(service.decrypt(first)).toBe('MG Road apartment 42');
        expect(service.decrypt(second)).toBe('MG Road apartment 42');

        const status = service.getFieldEncryptionStatus();
        expect(status.pqc).toMatchObject({
            configuredMode: 'per-record',
            effectiveMode: 'per-record',
            active: true,
            keyId: kemKey.keyId,
            algorithm: 'X25519+ML-KEM-768',
        });
        expect(JSON.stringify(status)).not.toContain(kemKey.x25519.privateKey);
    });

    test('key-wrap mode embeds a PQ-wrapped DEK in every record', async () => {
        const kemKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'h'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'key-wrap';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(kemKey);

        const service = loadService();
        await service.primeFieldEncryption();

        const ciphertext = service.encrypt('key-wrap protected');
        expect(ciphertext.split('.')).toHaveLength(6);
        expect(ciphertext.startsWith('v2.kw.')).toBe(true);
        expect(service.decrypt(ciphertext)).toBe('key-wrap protected');
    });

    test('key-wrap records survive a process restart without extra key state', async () => {
        const kemKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'h'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'key-wrap';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(kemKey);

        const before = loadService();
        await before.primeFieldEncryption();
        const ciphertext = before.encrypt('survives restart');

        const after = loadService();
        await after.primeFieldEncryption();
        expect(after.decrypt(ciphertext)).toBe('survives restart');
    });

    test('key-wrap mode rejects tampered envelopes', async () => {
        const kemKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'h'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'key-wrap';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(kemKey);

        const service = loadService();
        await service.primeFieldEncryption();
        const ciphertext = service.encrypt('tamper target');
        const tampered = ciphertext.slice(0, -4) + (ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA');
        expect(service.decrypt(tampered)).toBeNull();
    });

    test('rejects tampered PQ records instead of returning plaintext', async () => {
        const kemKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'i'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'per-record';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(kemKey);

        const service = loadService();
        await service.primeFieldEncryption();
        const ciphertext = service.encrypt('tamper target');
        const tampered = ciphertext.slice(0, -4) + (ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA');
        expect(service.decrypt(tampered)).toBeNull();
    });

    test('keeps v1 records readable after switching to per-record mode', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'j'.repeat(48);
        const legacy = loadService();
        await legacy.primeFieldEncryption();
        const v1Ciphertext = legacy.encrypt('written before PQC');
        expect(v1Ciphertext.startsWith('v1.')).toBe(true);

        process.env.FIELD_ENCRYPTION_PQC_MODE = 'per-record';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(generateHybridKemKey());
        const upgraded = loadService();
        await upgraded.primeFieldEncryption();

        expect(upgraded.decrypt(v1Ciphertext)).toBe('written before PQC');
        expect(upgraded.encrypt('new record').startsWith('pqc1.')).toBe(true);
    });

    test('off mode with a key reference is decrypt-only and keeps writes classical', async () => {
        const kemKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'j'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'per-record';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(kemKey);

        const before = loadService();
        await before.primeFieldEncryption();
        const pqcCiphertext = before.encrypt('existing PQ record');
        expect(pqcCiphertext.startsWith('pqc1.')).toBe(true);

        process.env.FIELD_ENCRYPTION_PQC_MODE = 'off';
        const after = loadService();
        const primed = await after.primeFieldEncryption();
        expect(primed.pqc.effectiveMode).toBe('off');
        expect(primed.pqc.decryptOnly).toBe(true);
        expect(after.decrypt(pqcCiphertext)).toBe('existing PQ record');
        expect(after.encrypt('new classical record').startsWith('v1.')).toBe(true);
    });

    test('auto mode uses PQ when the runtime and key material are available', async () => {
        const kemKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'j'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'auto';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(kemKey);

        const service = loadService();
        const primed = await service.primeFieldEncryption();
        expect(primed.pqc.effectiveMode).toBe('per-record');
        const ciphertext = service.encrypt('auto selected PQ');
        expect(ciphertext.startsWith('pqc1.')).toBe(true);
        expect(service.decrypt(ciphertext)).toBe('auto selected PQ');
    });

    test('decrypts records written under a previous KEM key during rotation', async () => {
        const oldKey = generateHybridKemKey();
        const newKey = generateHybridKemKey();
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'k'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'per-record';
        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(oldKey);

        const before = loadService();
        await before.primeFieldEncryption();
        const oldCiphertext = before.encrypt('rotate me');

        process.env.FIELD_ENCRYPTION_PQC_KEM_KEY_REF = JSON.stringify(newKey);
        process.env.FIELD_ENCRYPTION_PQC_KEM_PREVIOUS_KEY_REFS = JSON.stringify(oldKey);
        const after = loadService();
        await after.primeFieldEncryption();

        expect(after.decrypt(oldCiphertext)).toBe('rotate me');
        const newest = after.encrypt('rotate me');
        expect(newest).not.toBe(oldCiphertext);
        expect(after.decrypt(newest)).toBe('rotate me');
    });

    test('auto mode falls back to v1 when no PQ key is configured', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'l'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'auto';

        const service = loadService();
        const primed = await service.primeFieldEncryption();
        expect(primed.pqc.effectiveMode).toBe('off');
        const ciphertext = service.encrypt('classical fallback');
        expect(ciphertext.startsWith('v1.')).toBe(true);
        expect(service.decrypt(ciphertext)).toBe('classical fallback');
    });

    test('require mode fails closed without a KEM key reference', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'm'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'require';

        const service = loadService();
        await expect(service.primeFieldEncryption()).rejects.toThrow(/requires FIELD_ENCRYPTION_PQC_KEM_KEY_REF/);
    });

    test('rejects an unknown PQC mode instead of silently disabling it', async () => {
        process.env.FIELD_ENCRYPTION_ENABLED = 'true';
        process.env.FIELD_ENCRYPTION_MASTER_KEY = 'n'.repeat(48);
        process.env.FIELD_ENCRYPTION_PQC_MODE = 'quantum-magic';

        const service = loadService();
        await expect(service.primeFieldEncryption()).rejects.toThrow(/is invalid/);
    });
});
