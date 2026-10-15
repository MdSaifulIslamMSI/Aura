#!/usr/bin/env node
'use strict';

// Envelope encryption for production Mongo backup archives. Runs on the backend
// EC2 host (host node, or node:22-alpine via docker) with ZERO npm dependencies.
//
// Key material is provided by the CALLER via env:
//   DEK_B64   - base64 data-encryption key (from `aws kms generate-data-key`
//               Plaintext, or derived locally for master-key mode)
//   WRAPPED_B64 - base64 KMS-wrapped key (CiphertextBlob), stored in the header
//               so restores can ask KMS to unwrap it. Optional in master-key mode.
//   AURA_BACKUP_ENCRYPTION_MASTER_KEY - dev/test-only alternative: DEK derived
//               via scrypt with a per-file random salt recorded in the header
//               (never use in production; prefer DEK_B64 from KMS).
//
// File format: header JSON line '\n' | AES-256-GCM ciphertext | 16-byte raw tag
//   header = {"v":1,"alg":"aes-256-gcm","kdf"?:{...},"wrapped"?:<b64>}

const crypto = require('crypto');
const fs = require('fs');

const TAG_LENGTH = 16;
const MAGIC_HEADER = 'AURA-BACKUP-ENC-V1';
const MASTER_KEY_MIN_LENGTH = 32;

// scrypt cost for the local master-key mode.
//
// Node's `scryptSync` defaults to N=16384 (2^14), which is 128x below the work
// factor this repo pins in server/services/authProfileVault.js for its own vault
// KDF. Relying on the default silently under-provisions cost, so the parameters
// are pinned explicitly here. They are part of the archive format: v1 archives
// carry no params field and were written with Node's defaults, so that
// derivation is frozen for reading only (see deriveDekFromMasterKeyLegacy).
const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1 };
// 128 * N * r = 128 MiB at N=2^17; Node's default maxmem (32 MiB) rejects it.
const SCRYPT_MAXMEM_BYTES = 192 * 1024 * 1024;
const SALT_BYTES = 16;

const fail = (message) => {
    process.stderr.write(`backup-archive-crypto: ${message}\n`);
    process.exit(1);
};

// Reads magic + header JSON from an open descriptor so every later read
// (size, tag, body) observes the SAME file state — no check-then-read race.
const readHeaderFromFd = (fd) => {
    const probe = Buffer.alloc(MAGIC_HEADER.length + 1);
    fs.readSync(fd, probe, 0, probe.length, 0);
    if (probe.toString('utf8').trim() !== MAGIC_HEADER) {
        fail('input is not an encrypted Aura backup archive');
    }
    // Line 1: magic marker, line 2: header JSON. Scan for the JSON newline.
    const stat = fs.fstatSync(fd);
    const scanLength = Math.min(stat.size, 8192);
    const buffer = Buffer.alloc(scanLength);
    fs.readSync(fd, buffer, 0, scanLength, 0);
    const magicEnd = buffer.indexOf('\n');
    const jsonEnd = magicEnd < 0 ? -1 : buffer.indexOf('\n', magicEnd + 1);
    if (magicEnd < 0 || jsonEnd < 0) fail('corrupt header: incomplete');
    return {
        headerLine: buffer.subarray(magicEnd + 1, jsonEnd).toString('utf8'),
        bodyOffset: jsonEnd + 1,
    };
};

const readMasterKey = () => {
    const master = process.env.AURA_BACKUP_ENCRYPTION_MASTER_KEY || '';
    if (master.length < MASTER_KEY_MIN_LENGTH) {
        fail('AURA_BACKUP_ENCRYPTION_MASTER_KEY must be at least 32 characters');
    }
    return master;
};

// Current derivation: pinned cost, per-archive random salt.
const deriveDekFromMasterKey = (salt) => crypto.scryptSync(
    readMasterKey(),
    salt,
    32,
    { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, maxmem: SCRYPT_MAXMEM_BYTES }
);

// Frozen: reproduces the original derivation exactly so v1 archives still
// decrypt. Those headers record no salt and were written with a hardcoded salt
// and Node's DEFAULT cost (N=16384). Never used for new archives.
const deriveDekFromMasterKeyLegacy = () => crypto.scryptSync(
    readMasterKey(),
    'aura-backup-archive-kdf',
    32
);

const commandEncrypt = (inputPath, outputPath) => {
    let dek;
    const header = { v: 1, alg: 'aes-256-gcm' };
    if (process.env.DEK_B64) {
        dek = Buffer.from(process.env.DEK_B64, 'base64');
        if (dek.length !== 32) fail('DEK_B64 must decode to 32 bytes');
        if (process.env.WRAPPED_B64) header.wrapped = process.env.WRAPPED_B64;
    } else if (process.env.AURA_BACKUP_ENCRYPTION_MASTER_KEY) {
        // Fresh salt per archive: two archives of the same database under the
        // same master key must not share a DEK, and the GCM auth tag becomes a
        // per-file oracle only for a DEK derived from this archive's own salt.
        const salt = crypto.randomBytes(SALT_BYTES);
        dek = deriveDekFromMasterKey(salt);
        header.kdf = {
            mode: 'scrypt',
            salt: salt.toString('base64'),
            N: SCRYPT_PARAMS.N,
            r: SCRYPT_PARAMS.r,
            p: SCRYPT_PARAMS.p,
        };
    } else {
        fail('encryption requires DEK_B64 (KMS envelope) or AURA_BACKUP_ENCRYPTION_MASTER_KEY');
    }

    const iv = crypto.randomBytes(12);
    header.iv = iv.toString('base64');
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);

    return new Promise((resolve, reject) => {
        const input = fs.createReadStream(inputPath);
        const output = fs.createWriteStream(outputPath, { mode: 0o600 });
        output.write(`${MAGIC_HEADER}\n${JSON.stringify(header)}\n`);
        input.on('error', reject);
        output.on('error', reject);
        // Manual chunk loop: pipe's auto-end conflicts with the manual
        // final()/getAuthTag() needed to append the GCM tag after the ciphertext.
        input.on('data', (chunk) => {
            const encrypted = cipher.update(chunk);
            if (encrypted.length && !output.write(encrypted)) {
                input.pause();
                output.once('drain', () => input.resume());
            }
        });
        input.on('end', () => {
            try {
                const tail = cipher.final();
                if (tail.length) output.write(tail);
                output.end(cipher.getAuthTag(), () => resolve());
            } catch (error) {
                reject(error);
            }
        });
    });
};

const commandDecrypt = (inputPath, outputPath) => {
    // Single descriptor for the whole operation: header, size, tag, and body
    // are all read from one fd, so the archive cannot change between checks.
    const fd = fs.openSync(inputPath, 'r');
    const { headerLine, bodyOffset } = readHeaderFromFd(fd);
    let header;
    try {
        header = JSON.parse(headerLine);
    } catch {
        fs.closeSync(fd);
        return fail('corrupt header: invalid JSON');
    }

    let dek;
    if (header.kdf?.mode === 'scrypt') {
        const saltB64 = String(header.kdf.salt || '');
        if (!saltB64) {
            // v1 archive: no salt recorded. Reproduce the original frozen
            // derivation (hardcoded salt, Node default cost) to read it.
            dek = deriveDekFromMasterKeyLegacy();
        } else {
            const salt = Buffer.from(saltB64, 'base64');
            if (salt.length !== SALT_BYTES) {
                fs.closeSync(fd);
                return fail('corrupt header: kdf salt must be 16 bytes');
            }
            dek = deriveDekFromMasterKey(salt);
        }
    } else {
        if (!process.env.DEK_B64) {
            fs.closeSync(fd);
            return fail('DEK_B64 is required to decrypt this archive (unwrap it with `aws kms decrypt`)');
        }
        dek = Buffer.from(process.env.DEK_B64, 'base64');
        if (dek.length !== 32) {
            fs.closeSync(fd);
            return fail('DEK_B64 must decode to 32 bytes');
        }
    }

    const iv = Buffer.from(String(header.iv || ''), 'base64');
    if (iv.length !== 12) {
        fs.closeSync(fd);
        return fail('corrupt header: invalid iv');
    }

    const stat = fs.fstatSync(fd);
    const tagOffset = stat.size - TAG_LENGTH;
    if (tagOffset <= bodyOffset) {
        fs.closeSync(fd);
        return fail('corrupt archive: missing body or tag');
    }
    const tag = Buffer.alloc(TAG_LENGTH);
    fs.readSync(fd, tag, 0, TAG_LENGTH, tagOffset);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    return new Promise((resolve, reject) => {
        const input = fs.createReadStream(null, { fd, start: bodyOffset, end: tagOffset - 1, autoClose: false });
        const output = fs.createWriteStream(outputPath, { mode: 0o600 });
        input.on('error', reject);
        output.on('error', reject);
        input.on('data', (chunk) => {
            const plain = decipher.update(chunk);
            if (plain.length && !output.write(plain)) {
                input.pause();
                output.once('drain', () => input.resume());
            }
        });
        input.on('end', () => {
            try {
                // final() throws on auth-tag mismatch: the tamper check.
                const tail = decipher.final();
                if (tail.length) output.write(tail);
                output.end(() => resolve());
            } catch (error) {
                fs.rmSync(outputPath, { force: true });
                reject(error);
            }
        });
    }).finally(() => {
        fs.closeSync(fd);
    });
};

const [command, inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !['encrypt', 'decrypt'].includes(command)) {
    process.stderr.write('usage: node backup-archive-crypto.js <encrypt|decrypt> <input> <output>\n');
    process.exit(1);
}

(command === 'encrypt' ? commandEncrypt(inputPath, outputPath) : commandDecrypt(inputPath, outputPath))
    .then(() => {
        process.stdout.write(`${command} ok: ${outputPath}\n`);
    })
    .catch((error) => fail(error.message));
