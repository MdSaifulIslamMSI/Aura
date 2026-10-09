require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const EmailDeliveryLog = require('../models/EmailDeliveryLog');
const fieldEncryptionService = require('../services/fieldEncryptionService');
const {
    computePhoneBlindIndexV2,
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
//   - Recovery codes need no backfill: a code is single-use and its hash is
//     upgraded to v2 the moment it is consumed, so that population migrates itself.
//
// Usage:
//   node scripts/backfill-blind-indexes.js --dry-run   # counts only, no writes
//   node scripts/backfill-blind-indexes.js             # apply

const BATCH_SIZE = 500;
const dryRun = process.argv.includes('--dry-run');

// The v2 hash is derived from the PLAINTEXT phone/email. Once field encryption
// at rest is enabled the stored value is ciphertext and the hash cannot be
// recomputed from it, so those rows are counted and skipped rather than guessed:
// they keep their v1 index and remain findable through the v1 read path.
const isPlaintextCandidate = (value) => !fieldEncryptionService.isEncrypted(value);

const runBulkBackfill = async ({ collection, field, sourceField, computeV2 }) => {
    let scanned = 0;
    let pending = 0;
    let written = 0;
    let encryptedSkipped = 0;
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

    const cursor = collection.find({}, { batchSize: BATCH_SIZE });
    // eslint-disable-next-line no-restricted-syntax
    for await (const doc of cursor) {
        scanned += 1;

        const source = doc[sourceField];
        if (source === undefined || source === null || source === '') continue;

        if (!isPlaintextCandidate(source)) {
            encryptedSkipped += 1;
            // eslint-disable-next-line no-continue
            continue;
        }

        const expectedV2 = computeV2(source);
        if (doc[field] === expectedV2) continue;

        pending += 1;
        if (dryRun) continue;
        bulk.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { [field]: expectedV2 } } } });

        if (bulk.length >= BATCH_SIZE) await flush();
    }
    await flush();

    return { scanned, pending, written, encryptedSkipped };
};

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(process.env.MONGO_URI);
    logger.info('blind_index.backfill.started', { dryRun });

    const phone = await runBulkBackfill({
        collection: User.collection,
        field: 'phoneHashV2',
        sourceField: 'phone',
        computeV2: computePhoneBlindIndexV2,
    });
    logger.info('blind_index.backfill.user_phone', { ...phone, dryRun });
    // eslint-disable-next-line no-console
    console.log(`User.phoneHashV2: scanned=${phone.scanned} pending=${phone.pending} written=${phone.written} encryptedSkipped=${phone.encryptedSkipped}${dryRun ? ' (dry-run)' : ''}`);

    const email = await runBulkBackfill({
        collection: EmailDeliveryLog.collection,
        field: 'recipientEmailHashV2',
        sourceField: 'recipientEmail',
        computeV2: computeEmailBlindIndexV2,
    });
    logger.info('blind_index.backfill.email_delivery', { ...email, dryRun });
    // eslint-disable-next-line no-console
    console.log(`EmailDeliveryLog.recipientEmailHashV2: scanned=${email.scanned} pending=${email.pending} written=${email.written} encryptedSkipped=${email.encryptedSkipped}${dryRun ? ' (dry-run)' : ''}`);

    if (phone.encryptedSkipped || email.encryptedSkipped) {
        logger.warn('blind_index.backfill.encrypted_rows_skipped', {
            reason: 'plaintext unavailable where field encryption is enabled; these rows keep v1 and stay findable via the v1 read path',
            userPhone: phone.encryptedSkipped,
            recipientEmail: email.encryptedSkipped,
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

module.exports = { runBulkBackfill };
