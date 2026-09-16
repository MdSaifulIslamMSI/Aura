require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const OtpSession = require('../models/OtpSession');
const ClientDiagnostic = require('../models/ClientDiagnostic');
const AssistantThreadMessage = require('../models/AssistantThreadMessage');
const fieldEncryptionService = require('../services/fieldEncryptionService');
const logger = require('../utils/logger');

// Backfills plaintext values in the encrypted-PII fields to ciphertext, reading
// raw collections (bypassing schema getters) and writing through bulk updates
// (bypassing setters is irrelevant: encrypt() is idempotent on ciphertext input
// detection via the v1. prefix).
//
// Idempotent: already-encrypted and empty values are skipped, safe to re-run.
// Usage:
//   node scripts/backfill-field-encryption.js --dry-run   # counts only
// Requires FIELD_ENCRYPTION_ENABLED=true and key material (KMS in production,
// FIELD_ENCRYPTION_MASTER_KEY outside production).

const BATCH_SIZE = 500;

const TARGETS = [
    {
        name: 'User.addresses[name,phone,address]',
        collection: User.collection,
        // value is the plaintext candidate; returns the encrypted replacement
        extract: (doc) => {
            if (!Array.isArray(doc.addresses)) return [];
            return doc.addresses
                .map((address, index) => ({
                    path: `addresses.${index}`,
                    updates: [
                        ['name', address?.name],
                        ['phone', address?.phone],
                        ['address', address?.address],
                    ],
                }))
                .flatMap((entry) => entry.updates.map(([field, value]) => ({
                    field: `${entry.path}.${field}`,
                    value,
                })));
        },
    },
    {
        name: 'Order.shippingAddress.address',
        collection: Order.collection,
        extract: (doc) => [{ field: 'shippingAddress.address', value: doc.shippingAddress?.address }],
    },
    {
        name: 'OtpSession.requestMeta[ip,userAgent,location]',
        collection: OtpSession.collection,
        extract: (doc) => [
            ['requestMeta.ip', doc.requestMeta?.ip],
            ['requestMeta.userAgent', doc.requestMeta?.userAgent],
            ['requestMeta.location', doc.requestMeta?.location],
        ].map(([field, value]) => ({ field, value })),
    },
    {
        name: 'ClientDiagnostic[clientIp,userAgent]',
        collection: ClientDiagnostic.collection,
        extract: (doc) => [
            ['clientIp', doc.clientIp],
            ['userAgent', doc.userAgent],
        ].map(([field, value]) => ({ field, value })),
    },
    {
        name: 'AssistantThreadMessage.content',
        collection: AssistantThreadMessage.collection,
        extract: (doc) => [{ field: 'content', value: doc.content }],
    },
];

const buildUpdate = (target, doc) => {
    const update = {};
    target.extract(doc).forEach(({ field, value }) => {
        if (typeof value !== 'string' || value === '' || fieldEncryptionService.isEncrypted(value)) return;
        update[field] = fieldEncryptionService.encrypt(value);
    });
    return Object.keys(update).length ? update : null;
};

const backfillCollection = async (target, { dryRun }) => {
    let scanned = 0;
    let pending = 0;
    let written = 0;
    let bulk = [];

    const flush = async () => {
        if (dryRun || !bulk.length) {
            bulk = [];
            return;
        }
        const result = await target.collection.bulkWrite(bulk, { ordered: false });
        written += result.modifiedCount || 0;
        bulk = [];
    };

    const cursor = target.collection.find({}, { batchSize: BATCH_SIZE });
    // eslint-disable-next-line no-restricted-syntax
    for await (const doc of cursor) {
        scanned += 1;
        const update = buildUpdate(target, doc);
        if (update) {
            pending += 1;
            bulk.push({ updateOne: { filter: { _id: doc._id }, update: { $set: update } } });
        }
        if (bulk.length >= BATCH_SIZE) {
            // eslint-disable-next-line no-await-in-loop
            await flush();
        }
    }
    await flush();

    return { scanned, pending, written };
};

const run = async () => {
    const dryRun = process.argv.includes('--dry-run');
    if (!fieldEncryptionService.isFieldEncryptionEnabled()) {
        throw new Error('FIELD_ENCRYPTION_ENABLED=true is required to run the backfill');
    }
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    await fieldEncryptionService.primeFieldEncryption();
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('field_encryption.backfill.started', { dryRun });

    for (const target of TARGETS) {
        const { scanned, pending, written } = await backfillCollection(target, { dryRun });
        logger.info('field_encryption.backfill.collection', {
            collection: target.name,
            scanned,
            docsPending: pending,
            docsWritten: written,
            dryRun,
        });
        // eslint-disable-next-line no-console
        console.log(`${target.name}: scanned=${scanned} pending=${pending} written=${written}${dryRun ? ' (dry-run)' : ''}`);
    }

    logger.info('field_encryption.backfill.completed', { dryRun });
    await mongoose.disconnect();
};

if (require.main === module) {
    run().catch((error) => {
        logger.error('field_encryption.backfill.failed', { error: error.message });
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { buildUpdate, TARGETS };
