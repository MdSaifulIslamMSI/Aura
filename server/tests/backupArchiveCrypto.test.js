const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CRYPTO_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'production', 'backup-archive-crypto.js');

const runCrypto = (command, input, output, env = {}) => {
    execFileSync(process.execPath, [CRYPTO_SCRIPT, command, input, output], {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
};

const makeArchive = (dir) => {
    const inputPath = path.join(dir, 'mongo.archive.gz');
    const payload = Buffer.concat([
        Buffer.from('fake-mongodump-archive\n'.repeat(5000)),
        crypto.randomBytes(64 * 1024),
    ]);
    fs.writeFileSync(inputPath, payload);
    return { inputPath, payload };
};

describe('backup archive encryption', () => {
    let workDir;

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-backup-crypto-'));
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
        delete process.env.AURA_BACKUP_ENCRYPTION_MASTER_KEY;
    });

    test('round-trips an archive in master-key mode without leaking plaintext', () => {
        const { inputPath, payload } = makeArchive(workDir);
        const encryptedPath = path.join(workDir, 'mongo.archive.gz.enc');
        const decryptedPath = path.join(workDir, 'mongo.archive.gz');

        runCrypto('encrypt', inputPath, encryptedPath, {
            AURA_BACKUP_ENCRYPTION_MASTER_KEY: 'local-round-trip-master-key-material-000',
        });
        runCrypto('decrypt', encryptedPath, decryptedPath, {
            AURA_BACKUP_ENCRYPTION_MASTER_KEY: 'local-round-trip-master-key-material-000',
        });

        const encrypted = fs.readFileSync(encryptedPath);
        expect(encrypted.subarray(0, 'AURA-BACKUP-ENC-V1'.length).toString('utf8')).toBe('AURA-BACKUP-ENC-V1');
        expect(encrypted.indexOf(payload.subarray(0, 64))).toBe(-1);
        expect(fs.readFileSync(decryptedPath)).toEqual(payload);
    });

    test('round-trips with a caller-provided KMS data key and records the wrapped key', () => {
        const { inputPath, payload } = makeArchive(workDir);
        const encryptedPath = path.join(workDir, 'mongo.archive.gz.enc');
        const decryptedPath = path.join(workDir, 'mongo.archive.gz');

        const dek = crypto.randomBytes(32);
        const wrapped = crypto.randomBytes(40);
        const env = { DEK_B64: dek.toString('base64'), WRAPPED_B64: wrapped.toString('base64') };

        runCrypto('encrypt', inputPath, encryptedPath, env);
        runCrypto('decrypt', encryptedPath, decryptedPath, env);

        const headerLine = fs.readFileSync(encryptedPath).toString('utf8').split('\n')[1];
        const header = JSON.parse(headerLine);
        expect(header.wrapped).toBe(wrapped.toString('base64'));
        expect(header.iv).toBeTruthy();
        expect(fs.readFileSync(decryptedPath)).toEqual(payload);
    });

    test('fails integrity verification on tampered ciphertext', () => {
        const { inputPath } = makeArchive(workDir);
        const encryptedPath = path.join(workDir, 'mongo.archive.gz.enc');
        const decryptedPath = path.join(workDir, 'mongo.archive.gz');

        runCrypto('encrypt', inputPath, encryptedPath, {
            AURA_BACKUP_ENCRYPTION_MASTER_KEY: 'tamper-test-master-key-material-0000000',
        });

        const encrypted = fs.readFileSync(encryptedPath);
        encrypted[encrypted.length - 100] ^= 0xff;
        fs.writeFileSync(encryptedPath, encrypted);

        expect(() => runCrypto('decrypt', encryptedPath, decryptedPath, {
            AURA_BACKUP_ENCRYPTION_MASTER_KEY: 'tamper-test-master-key-material-0000000',
        })).toThrow();
        expect(fs.existsSync(decryptedPath)).toBe(false);
    });

    test('derives an independent DEK per archive via a per-archive random salt', () => {
        // Regression: the DEK was derived from a hardcoded salt at Node's
        // default scrypt cost, so every archive ever taken under a given master
        // key shared one AES-256-GCM key, with no compartmentalisation and no
        // rotation story.
        const { inputPath } = makeArchive(workDir);
        const master = 'per-archive-salt-master-key-material-0000';
        const first = path.join(workDir, 'first.enc');
        const second = path.join(workDir, 'second.enc');

        runCrypto('encrypt', inputPath, first, { AURA_BACKUP_ENCRYPTION_MASTER_KEY: master });
        runCrypto('encrypt', inputPath, second, { AURA_BACKUP_ENCRYPTION_MASTER_KEY: master });

        const headerOf = (file) => JSON.parse(fs.readFileSync(file).toString('utf8').split('\n')[1]);
        const firstHeader = headerOf(first);
        const secondHeader = headerOf(second);

        // The salt must be recorded in the header so restores can re-derive it.
        expect(firstHeader.kdf.mode).toBe('scrypt');
        expect(Buffer.from(firstHeader.kdf.salt, 'base64')).toHaveLength(16);
        expect(firstHeader.kdf.salt).not.toBe(secondHeader.kdf.salt);

        // Cost must be pinned, not inherited from Node's defaults (N=16384).
        expect(firstHeader.kdf.N).toBe(131072);
        expect(firstHeader.kdf.r).toBe(8);
        expect(firstHeader.kdf.p).toBe(1);

        // Two archives of identical plaintext must not share a DEK.
        const derive = (saltB64) => crypto.scryptSync(master, Buffer.from(saltB64, 'base64'), 32, {
            N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024,
        });
        expect(derive(firstHeader.kdf.salt).equals(derive(secondHeader.kdf.salt))).toBe(false);

        // Both must still round-trip.
        const out = path.join(workDir, 'out');
        runCrypto('decrypt', first, out, { AURA_BACKUP_ENCRYPTION_MASTER_KEY: master });
        expect(fs.readFileSync(out)).toEqual(fs.readFileSync(inputPath));
    });

    test('still decrypts a v1 archive written before the per-archive salt', () => {
        // v1 headers carry no salt and were produced with a hardcoded salt at
        // Node's default cost. That derivation is frozen for reading only.
        const { payload } = makeArchive(workDir);
        const master = 'legacy-v1-compat-master-key-material-0000';
        const encryptedPath = path.join(workDir, 'legacy.enc');
        const decryptedPath = path.join(workDir, 'legacy.out');

        const dek = crypto.scryptSync(master, 'aura-backup-archive-kdf', 32); // nosemgrep: nodejs.crypto.scrypt -- reproducing the frozen v1 derivation
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
        const body = Buffer.concat([cipher.update(payload), cipher.final()]);
        const header = { v: 1, alg: 'aes-256-gcm', kdf: { mode: 'scrypt' }, iv: iv.toString('base64') };
        fs.writeFileSync(encryptedPath, Buffer.concat([
            Buffer.from(`AURA-BACKUP-ENC-V1\n${JSON.stringify(header)}\n`),
            body,
            cipher.getAuthTag(),
        ]));

        runCrypto('decrypt', encryptedPath, decryptedPath, { AURA_BACKUP_ENCRYPTION_MASTER_KEY: master });
        expect(fs.readFileSync(decryptedPath)).toEqual(payload);
    });

    test('rejects decrypting with the wrong key', () => {
        const { inputPath } = makeArchive(workDir);
        const encryptedPath = path.join(workDir, 'mongo.archive.gz.enc');
        const decryptedPath = path.join(workDir, 'mongo.archive.gz');

        runCrypto('encrypt', inputPath, encryptedPath, {
            AURA_BACKUP_ENCRYPTION_MASTER_KEY: 'correct-master-key-material-0000000000000',
        });

        expect(() => runCrypto('decrypt', encryptedPath, decryptedPath, {
            AURA_BACKUP_ENCRYPTION_MASTER_KEY: 'wrong-master-key-material-00000000000000',
        })).toThrow();
    });
});
