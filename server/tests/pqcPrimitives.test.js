'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const algorithms = require('../security/pqc/algorithms');
const keyMaterial = require('../security/pqc/keyMaterial');
const kem = require('../security/pqc/hybridKem');
const signature = require('../security/pqc/hybridSignature');
const { PqcKeyRegistry } = require('../security/pqc/keyRegistry');

const capabilities = algorithms.getPqcCapabilities();
const describeWithPqc = capabilities.fullyAvailable ? describe : describe.skip;

jest.setTimeout(60000);

describeWithPqc('PQC primitives', () => {
    let kemKey;
    let signingKey;
    let slhKey;

    beforeAll(() => {
        kemKey = keyMaterial.generateHybridKemKey();
        signingKey = keyMaterial.generateHybridSigningKey();
        slhKey = keyMaterial.generateSlhDsaKey();
    });

    describe('hybrid KEM', () => {
        test('seals and opens a value with context and AAD binding', () => {
            const token = kem.sealToken('MG Road apartment 42', {
                publicKeyRecord: kemKey,
                context: 'test:field-encryption',
                aad: 'record-42',
            });

            expect(token.startsWith('pqc1.')).toBe(true);
            expect(kem.openToken(token, {
                privateKeyRecord: kemKey,
                context: 'test:field-encryption',
                aad: 'record-42',
            })).toBe('MG Road apartment 42');
        });

        test('rejects a changed AAD, context, ciphertext, or key', () => {
            const token = kem.sealToken('sensitive', {
                publicKeyRecord: kemKey,
                context: 'test:field-encryption',
                aad: 'record-42',
            });

            expect(() => kem.openToken(token, {
                privateKeyRecord: kemKey,
                context: 'test:field-encryption',
                aad: 'record-43',
            })).toThrow();

            expect(() => kem.openToken(token, {
                privateKeyRecord: kemKey,
                context: 'test:other',
                aad: 'record-42',
            })).toThrow();

            const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
            expect(() => kem.openToken(tampered, {
                privateKeyRecord: kemKey,
                context: 'test:field-encryption',
                aad: 'record-42',
            })).toThrow();

            const otherKey = keyMaterial.generateHybridKemKey();
            expect(() => kem.openToken(token, {
                privateKeyRecord: otherKey,
                context: 'test:field-encryption',
                aad: 'record-42',
            })).toThrow(/keyId/i);
        });

        test('wraps and unwraps a 32-byte data key under a separate context', () => {
            const dataKey = crypto.randomBytes(32);
            const wrapped = kem.wrapDataKey(dataKey, { publicKeyRecord: kemKey });
            expect(kem.unwrapDataKey(wrapped, { privateKeyRecord: kemKey }).equals(dataKey)).toBe(true);
            expect(() => kem.wrapDataKey(crypto.randomBytes(16), { publicKeyRecord: kemKey }))
                .toThrow(/32 bytes/);
        });

        test('reports envelope dimensions without decrypting', () => {
            const token = kem.sealToken('hello', { publicKeyRecord: kemKey });
            expect(kem.describeEnvelope(token)).toMatchObject({
                v: 1,
                alg: algorithms.KEM_ALGORITHM,
                keyId: kemKey.keyId,
                ephemeralPublicKeyBytes: kem.X25519_PUBLIC_DER_BYTES,
                mlKemCiphertextBytes: kem.ML_KEM_768_CIPHERTEXT_BYTES,
            });
        });
    });

    describe('hybrid signatures', () => {
        test('requires both Ed25519 and ML-DSA-65 to verify', () => {
            const signed = signature.sign('ledger-entry', signingKey, { context: 'test:ledger' });
            const token = signature.serializeSignature(signed);

            const result = signature.verify('ledger-entry', token, signingKey, { context: 'test:ledger' });
            expect(result).toMatchObject({ valid: true, ed25519: true, mlDsa: true, keyId: signingKey.keyId });
        });

        test('rejects a changed message or context', () => {
            const signed = signature.sign('ledger-entry', signingKey, { context: 'test:ledger' });
            expect(signature.verify('ledger-entry-2', signed, signingKey, { context: 'test:ledger' }).valid).toBe(false);
            expect(signature.verify('ledger-entry', signed, signingKey, { context: 'test:other' }).valid).toBe(false);
        });

        test('rejects a tampered ML-DSA component', () => {
            const signed = signature.sign('ledger-entry', signingKey, { context: 'test:ledger' });
            const raw = Buffer.from(signed.mlDsa, 'base64url');
            raw[0] ^= 0xff;
            const tampered = { ...signed, mlDsa: raw.toString('base64url') };
            const result = signature.verify('ledger-entry', tampered, signingKey, { context: 'test:ledger' });
            expect(result.valid).toBe(false);
            expect(result.ed25519).toBe(true);
            expect(result.mlDsa).toBe(false);
        });

        test('SLH-DSA signs and verifies long-lived checkpoints', () => {
            const signed = signature.signSlhDsa('checkpoint', slhKey, { context: 'test:checkpoint' });
            expect(signature.verifySlhDsa('checkpoint', signed, slhKey, { context: 'test:checkpoint' }).valid).toBe(true);
            expect(signature.verifySlhDsa('checkpoint', signed, slhKey, { context: 'test:other' }).valid).toBe(false);
        });
    });

    describe('key registry', () => {
        let directory;

        beforeAll(() => {
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-pqc-'));
        });

        afterAll(() => {
            fs.rmSync(directory, { recursive: true, force: true });
        });

        test('loads inline JSON and base64 JSON references', async () => {
            const registry = new PqcKeyRegistry();
            const inline = await registry.load('hybrid-kem', JSON.stringify(kemKey));
            expect(inline.keyId).toBe(kemKey.keyId);

            const encoded = `base64-json:${Buffer.from(JSON.stringify(signingKey)).toString('base64')}`;
            const decoded = await registry.load('hybrid-signature', encoded);
            expect(decoded.keyId).toBe(signingKey.keyId);
        });

        test('loads a file reference and exposes only metadata in status', async () => {
            const filePath = path.join(directory, 'kem.json');
            fs.writeFileSync(filePath, JSON.stringify(kemKey), { mode: 0o600 });
            const registry = new PqcKeyRegistry();
            const loaded = await registry.load('hybrid-kem', `file:${filePath}`);

            expect(loaded.keyId).toBe(kemKey.keyId);
            const status = JSON.stringify(registry.getStatus());
            expect(status).not.toContain(kemKey.x25519.privateKey);
            expect(status).not.toContain(kemKey.mlKem.privateKey);
        });

        test('loads public-only records for verification', async () => {
            const registry = new PqcKeyRegistry();
            const publicRecord = keyMaterial.toPublicRecord(signingKey);
            const loaded = await registry.loadPublic('hybrid-signature', publicRecord);
            expect(loaded.keyId).toBe(signingKey.keyId);
            expect(loaded.publicKeys.ed25519.asymmetricKeyType).toBe('ed25519');
        });

        test('loadPublic strips private material from a full key record', async () => {
            const registry = new PqcKeyRegistry();
            const loaded = await registry.loadPublic('hybrid-signature', signingKey);
            const serialized = JSON.stringify(loaded.publicRecord);
            expect(loaded.keyId).toBe(signingKey.keyId);
            expect(serialized).not.toContain(signingKey.ed25519.privateKey);
            expect(serialized).not.toContain(signingKey.mlDsa.privateKey);
        });

        test('loads an SSM SecureString reference through an injected client', async () => {
            const sent = [];
            const ssmClient = {
                send: jest.fn(async (command) => {
                    sent.push(command.input);
                    return { Parameter: { Value: JSON.stringify(signingKey) } };
                }),
            };
            const registry = new PqcKeyRegistry({ ssmClient });
            const loaded = await registry.load('hybrid-signature', 'ssm:/aura/test/pqc/ledger-signing');

            expect(loaded.keyId).toBe(signingKey.keyId);
            expect(loaded.source).toBe('ssm');
            expect(sent[0]).toMatchObject({
                Name: '/aura/test/pqc/ledger-signing',
                WithDecryption: true,
            });
            const status = JSON.stringify(registry.getStatus());
            expect(status).not.toContain(signingKey.mlDsa.privateKey);
        });

        test('loads current plus previous keys for rotation', async () => {
            const newer = keyMaterial.generateHybridKemKey();
            const registry = new PqcKeyRegistry();
            const rotated = await registry.loadRotated('hybrid-kem', newer, [kemKey]);

            expect(rotated.current.keyId).toBe(newer.keyId);
            expect(rotated.previous.map((entry) => entry.keyId)).toContain(kemKey.keyId);
        });

        test('fails closed on an ambiguous reference', async () => {
            const registry = new PqcKeyRegistry();
            await expect(registry.load('hybrid-kem', 'just-a-string')).rejects.toThrow(/ambiguous/i);
        });

        const permissionTest = process.platform === 'win32' ? test.skip : test;
        permissionTest('rejects group/other-readable private key files on POSIX', async () => {
            const filePath = path.join(directory, 'world-readable-kem.json');
            fs.writeFileSync(filePath, JSON.stringify(kemKey), { mode: 0o644 });
            const registry = new PqcKeyRegistry();
            await expect(registry.load('hybrid-kem', `file:${filePath}`)).rejects.toThrow(/chmod 600/);
        });
    });

    describe('compact key records', () => {
        const stripPublicKeys = (record) => {
            const copy = JSON.parse(JSON.stringify(record));
            for (const keyName of ['x25519', 'mlKem', 'ed25519', 'mlDsa', 'slhDsa']) {
                if (copy[keyName]) delete copy[keyName].publicKey;
            }
            return copy;
        };

        test('loaders derive public keys and preserve key identity', () => {
            const compactKem = stripPublicKeys(kemKey);
            const compactSigning = stripPublicKeys(signingKey);

            const loadedKem = keyMaterial.loadKemKeyRecord(compactKem);
            const loadedSigning = keyMaterial.loadSigningKeyRecord(compactSigning);

            expect(loadedKem.keyId).toBe(kemKey.keyId);
            expect(loadedSigning.keyId).toBe(signingKey.keyId);
            expect(keyMaterial.toPublicRecord(compactKem).mlKem.publicKey).toBe(kemKey.mlKem.publicKey);
            expect(keyMaterial.toPublicRecord(compactSigning).mlDsa.publicKey).toBe(signingKey.mlDsa.publicKey);
        });

        test('compact records fit SSM parameter limits', () => {
            const compactKem = stripPublicKeys(kemKey);
            const compactSigning = stripPublicKeys(signingKey);

            expect(Buffer.byteLength(JSON.stringify(compactKem))).toBeLessThanOrEqual(4096);
            expect(Buffer.byteLength(JSON.stringify(compactSigning))).toBeLessThanOrEqual(8192);
        });

        test('keygen --compact writes a loadable record without public keys', () => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-pqc-compact-'));
            const script = path.join(__dirname, '..', '..', 'scripts', 'security', 'pqc-keygen.mjs');
            try {
                for (const [type, limit] of [['hybrid-kem', 4096], ['hybrid-signature', 8192]]) {
                    const out = path.join(directory, `${type}.json`);
                    execFileSync(process.execPath, [script, '--type', type, '--compact', '--out', out], {
                        encoding: 'utf8',
                    });
                    const record = JSON.parse(fs.readFileSync(out, 'utf8'));
                    const loaded = type === 'hybrid-kem'
                        ? keyMaterial.loadKemKeyRecord(record)
                        : keyMaterial.loadSigningKeyRecord(record);

                    expect(loaded.keyId).toMatch(/^pqc-[0-9a-f]{32}$/);
                    expect(fs.statSync(out).size).toBeLessThanOrEqual(limit);
                    for (const keyName of ['x25519', 'mlKem', 'ed25519', 'mlDsa']) {
                        if (record[keyName]) expect(record[keyName].publicKey).toBeUndefined();
                    }
                }
            } finally {
                fs.rmSync(directory, { recursive: true, force: true });
            }
        });
    });
});

describe('PQC capability reporting', () => {
    test('always returns a complete capability snapshot', () => {
        const snapshot = algorithms.getPqcCapabilities();
        expect(snapshot.algorithms.mlKem.standard).toBe('FIPS 203');
        expect(snapshot.algorithms.mlDsa.standard).toBe('FIPS 204');
        expect(snapshot.algorithms.slhDsa.standard).toBe('FIPS 205');
        expect(typeof snapshot.available).toBe('boolean');
        expect(Array.isArray(snapshot.reasons)).toBe(true);
    });
});
