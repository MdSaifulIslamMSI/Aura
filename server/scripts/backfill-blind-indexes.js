require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const EmailDeliveryLog = require('../models/EmailDeliveryLog');
const fieldEncryptionService = require('../services/fieldEncryptionService');
const {
    computePhoneBlindIndex,
    computePhoneBlindIndexV2,
    computeEmailBlindIndex,
    computeEmailBlindIndexV2,
} = require('../services/blindIndexService');
const logger = require('../utils/logger');

// Backfills the v2 (HKDF-derived) blind indexes for rows written before the
// v1 → v2 rollout.
//
// SAFE BY CONSTRUCTION:
//   - Reads the raw collection, bypassing schema setters/getters, so it sees
//     exactly what is stored rather than what mongoose derives on the fly.
//   - Only ever $sets the *V2 fields. It never touches v1, so a row that is only
//     half-migrated stays findable through the v1 read path.
//   - Idempotent: rows already carrying the correct v2 value are skipped, so it
//     is safe to re-run and safe to interrupt.
//   - Ciphertext rows are NOT skipped. Where field encryption is enabled, the
//     stored value is decrypted with the primed DEK, v1 is recomputed from the
//     plaintext, and v2 is written only if the recomputed v1 matches the stored
//     v1. A mismatch means the row's provenance is untrusted and it is skipped
//     rather than guessed. Every ciphertext row that passes that check is one
//     the process re-derived entirely from verified data.
//   - Recovery codes need no backfill: a code is single-use and its hash is
//     upgraded to v2 the moment it is consumed, so that population migrates itself.
//
// Usage:
//   node scripts/backfill-blind-indexes.js --dry-run   # counts only, no writes
//   node scripts/backfill-blind-indexes.js             # apply
//
// Requires field-encryption key material when cipher rows are present
// (KMS in production; FIELD_ENCRYPTION_MASTER_KEY outside production).

const BATCH_SIZE = 500;
const dryRun = process.argv.includes('--dry-run');

const runBulkBackfill = async ({
    collection,
    field,
    sourceField,
    v1Field,
    computeV1,
    computeV2,
}) => {
    let scanned = 0;
    let pending = 0;
    let written = 0;
    let cipherDecrypted = 0;
    let cipherSkippedNoV1 = 0;
    let cipherSkippedMismatch = 0;
    let cipherDecryptFailed = 0;
    let bulk = [];

    const flush = async () => {
        if (dryRun || !bulk.length) {
            bulk = [];
            return;
        }
        const result = await collection.bulkWrite(bulk, { ordered: false });
        written += result.modifiedCount || 0;
        bulk = [];
    };

    // Resolve the plaintext either directly (plaintext rows) or by decrypting
    // with the primed DEK (ciphertext rows), but ONLY when the recomputed v1
    // proves the decrypted bytes are what the stored v1 was derived from.
    const resolvePlaintext = (doc) => {
        const source = doc[sourceField];
        if (source === undefined || source === null || source === '') return { skip: true };

        if (!fieldEncryptionService.isEncrypted(source)) {
            return { plaintext: source, fromCipher: false };
        }

        let plaintext = null;
        try {
            plaintext = fieldEncryptionService.decrypt(source);
        } catch {
            return { skip: true, decryptFailed: true };
        }
        if (typeof plaintext !== 'string' || plaintext === '') {
            return { skip: true, decryptFailed: true };
        }

        if (!doc[v1Field]) return { skip: true, noStoredV1: true };
        if (computeV1(plaintext) !== doc[v1Field]) return { skip: true, mismatch: true };

        return { plaintext, fromCipher: true };
    };

    const cursor = collection.find({}, { batchSize: BATCH_SIZE });
    // eslint-disable-next-line no-restricted-syntax
    for await (const doc of cursor) {
        scanned += 1;

        const resolved = resolvePlaintext(doc);
        if (resolved.skip) {
            if (resolved.decryptFailed) cipherDecryptFailed += 1;
            if (resolved.noStoredV1) cipherSkippedNoV1 += 1;
            if (resolved.mismatch) cipherSkippedMismatch += 1;
            // eslint-disable-next-line no-continue
            continue;
        }

        if (resolved.fromCipher) cipherDecrypted += 1;

        const expectedV2 = computeV2(resolved.plaintext);
        if (doc[field] === expectedV2) continue;

        pending += 1;
        if (dryRun) continue;
        bulk.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { [field]: expectedV2 } } } });

        if (bulk.length >= BATCH_SIZE) await flush();
    }
    await flush();

    return {
        scanned, pending, written,
        cipherDecrypted, cipherSkippedNoV1, cipherSkippedMismatch, cipherDecryptFailed,
    };
};

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    if (fieldEncryptionService.isFieldEncryptionEnabled()) {
        await fieldEncryptionService.primeFieldEncryption();
    }
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('blind_index.backfill.started', { dryRun });

    const phone = await runBulkBackfill({
        collection: User.collection,
        field: 'phoneHashV2',
        sourceField: 'phone',
        v1Field: 'phoneHash',
        computeV1: computePhoneBlindIndex,
        computeV2: computePhoneBlindIndexV2,
    });
    logger.info('blind_index.backfill.user_phone', { ...phone, dryRun });
    // eslint-disable-next-line no-console
    console.log(`User.phoneHashV2: scanned=${phone.scanned} pending=${phone.pending} written=${phone.written} cipherDecrypted=${phone.cipherDecrypted} cipherSkips=${phone.cipherSkippedNoV1 + phone.cipherSkippedMismatch + phone.cipherDecryptFailed}${dryRun ? ' (dry-run)' : ''}`);

    const email = await runBulkBackfill({
        collection: EmailDeliveryLog.collection,
        field: 'recipientEmailHashV2',
        sourceField: 'recipientEmail',
        v1Field: 'recipientEmailHash',
        computeV1: computeEmailBlindIndex,
        computeV2: computeEmailBlindIndexV2,
    });
    logger.info('blind_index.backfill.email_delivery', { ...email, dryRun });
    // eslint-disable-next-line no-console
    console.log(`EmailDeliveryLog.recipientEmailHashV2: scanned=${email.scanned} pending=${email.pending} written=${email.written} cipherDecrypted=${email.cipherDecrypted} cipherSkips=${email.cipherSkippedNoV1 + email.cipherSkippedMismatch + email.cipherDecryptFailed}${dryRun ? ' (dry-run)' : ''}`);

    const skipped = phone.cipherSkippedNoV1 + phone.cipherSkippedMismatch + phone.cipherDecryptFailed
        + email.cipherSkippedNoV1 + email.cipherSkippedMismatch + email.cipherDecryptFailed;
    if (skipped) {
        logger.error('blind_index.backfill.cipher_provenance_failures', {
            reason: 'some ciphertext rows could not be verified against their stored v1; they were NOT written and stay on v1',
            userPhone: {
                noStoredV1: phone.cipherSkippedNoV1,
                mismatch: phone.cipherSkippedMismatch,
                decryptFailed: phone.cipherDecryptFailed,
            },
            recipientEmail: {
                noStoredV1: email.cipherSkippedNoV1,
                mismatch: email.cipherSkippedMismatch,
                decryptFailed: email.cipherDecryptFailed,
            },
        });
    }

    logger.info('blind_index.backfill.completed', { dryRun });
    await mongoose.disconnect();
};

if (require.main === module) {
    run().catch((error) => {
        logger.error('blind_index.backfill.failed', { error: error.message });
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { runBulkBackfill, run };
