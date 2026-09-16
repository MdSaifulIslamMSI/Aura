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
//               via scrypt with a per-file salt (never use in production).
//
// File format: header JSON line '\n' | AES-256-GCM ciphertext | 16-byte raw tag
//   header = {"v":1,"alg":"aes-256-gcm","kdf"?:{"salt":"b64"},"wrapped"?:<b64>}

const crypto = require('crypto');
const fs = require('fs');

const TAG_LENGTH = 16;
const MAGIC_HEADER = 'AURA-BACKUP-ENC-V1';
const MASTER_KEY_MIN_LENGTH = 32;

const fail = (message) => {
    process.stderr.write(`backup-archive-crypto: ${message}\n`);
    process.exit(1);
};

const readHeader = (filePath) => {
    const fd = fs.openSync(filePath, 'r');
    try {
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
    } finally {
        fs.closeSync(fd);
    }
};

const deriveDekFromMasterKey = () => {
    const master = process.env.AURA_BACKUP_ENCRYPTION_MASTER_KEY || '';
    if (master.length < MASTER_KEY_MIN_LENGTH) {
        fail('AURA_BACKUP_ENCRYPTION_MASTER_KEY must be at least 32 characters');
    }
    return crypto.scryptSync(master, 'aura-backup-archive-kdf', 32);
};

const commandEncrypt = (inputPath, outputPath) => {
    let dek;
    const header = { v: 1, alg: 'aes-256-gcm' };
    if (process.env.DEK_B64) {
        dek = Buffer.from(process.env.DEK_B64, 'base64');
        if (dek.length !== 32) fail('DEK_B64 must decode to 32 bytes');
        if (process.env.WRAPPED_B64) header.wrapped = process.env.WRAPPED_B64;
    } else if (process.env.AURA_BACKUP_ENCRYPTION_MASTER_KEY) {
        dek = deriveDekFromMasterKey();
        header.kdf = { mode: 'scrypt' };
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
    const { headerLine, bodyOffset } = readHeader(inputPath);
    let header;
    try {
        header = JSON.parse(headerLine);
    } catch {
        return fail('corrupt header: invalid JSON');
    }

    let dek;
    if (header.kdf?.mode === 'scrypt') {
        dek = deriveDekFromMasterKey();
    } else {
        if (!process.env.DEK_B64) fail('DEK_B64 is required to decrypt this archive (unwrap it with `aws kms decrypt`)');
        dek = Buffer.from(process.env.DEK_B64, 'base64');
        if (dek.length !== 32) fail('DEK_B64 must decode to 32 bytes');
    }

    const iv = Buffer.from(String(header.iv || ''), 'base64');
    if (iv.length !== 12) fail('corrupt header: invalid iv');

    const stat = fs.statSync(inputPath);
    const tagOffset = stat.size - TAG_LENGTH;
    if (tagOffset <= bodyOffset) fail('corrupt archive: missing body or tag');
    const tag = Buffer.alloc(TAG_LENGTH);
    const tagFd = fs.openSync(inputPath, 'r');
    fs.readSync(tagFd, tag, 0, TAG_LENGTH, tagOffset);
    fs.closeSync(tagFd);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    return new Promise((resolve, reject) => {
        const input = fs.createReadStream(inputPath, { start: bodyOffset, end: tagOffset - 1 });
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
