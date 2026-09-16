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
