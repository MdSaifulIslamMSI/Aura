require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { registry } = require('../migrations');
const { getMigrationStatus } = require('../migrations/runner');

// Read-only production index/retention integrity check. Complements
// `migrate:status` by verifying the indexes that carry correctness and auth
// guarantees actually exist on the connected database (production runs with
// autoIndex disabled, so a missing index is a silent correctness bug).
//
// Usage: npm --prefix server run db:doctor

const TTL_DAY_SECONDS = 24 * 60 * 60;

const REQUIRED_UNIQUE_INDEXES = [
    ['couponredemptions', { code: 1, user: 1 }, 'coupon once-per-user backstop'],
    ['statuswebhookevents', { idempotencyKey: 1 }, 'status webhook idempotency'],
    ['paymentintents', { intentId: 1 }, 'payment intent identity'],
    ['carts', { user: 1 }, 'one cart per user'],
    ['users', { email: 1 }, 'account email identity'],
    ['otpsessions', { identityKey: 1, purpose: 1 }, 'OTP session identity'],
];

// Retention TTLs mirror the registry entries in server/migrations/index.js.
const REQUIRED_TTL_INDEXES = [
    ['emaildeliverylogs', 'createdAt', 90],
    ['securityevents', 'timestamp', 180],
    ['usernotifications', 'createdAt', 180],
    ['adminnotifications', 'createdAt', 180],
    ['assistantthreadmessages', 'createdAt', 180],
    ['statusauditlogs', 'createdAt', 180],
    ['productgovernancelogs', 'createdAt', 365],
    ['usergovernancelogs', 'createdAt', 365],
    ['paymentevents', 'createdAt', 365],
];

const keyMatches = (indexKey, expectedKey) => {
    const actual = Object.entries(indexKey || {});
    const expected = Object.entries(expectedKey);
    if (actual.length !== expected.length) return false;
    return expected.every(([field, direction]) => indexKey[field] === direction);
};

const findIndex = (indexes, expectedKey) => indexes.find((index) => keyMatches(index.key, expectedKey));

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }
    await mongoose.connect(process.env.MONGO_URI);

    const problems = [];

    for (const [collection, expectedKey, purpose] of REQUIRED_UNIQUE_INDEXES) {
        const indexes = await mongoose.connection.collection(collection).indexes();
        const found = findIndex(indexes, expectedKey);
        if (!found) {
            problems.push(`MISSING unique index on ${collection} ${JSON.stringify(expectedKey)} (${purpose})`);
        } else if (!found.unique) {
            problems.push(`Index on ${collection} ${JSON.stringify(expectedKey)} exists but is not unique (${purpose})`);
        }
    }

    for (const [collection, field, days] of REQUIRED_TTL_INDEXES) {
        const indexes = await mongoose.connection.collection(collection).indexes();
        const found = findIndex(indexes, { [field]: 1 });
        if (!found) {
            problems.push(`MISSING TTL index on ${collection}.${field} (${days}d retention)`);
        } else if (found.expireAfterSeconds !== days * TTL_DAY_SECONDS) {
            problems.push(`TTL index on ${collection}.${field} has expireAfterSeconds=${found.expireAfterSeconds}, expected ${days * TTL_DAY_SECONDS}`);
        }
    }

    const migrationStatus = await getMigrationStatus({ registry });
    if (migrationStatus.pending.length > 0) {
        problems.push(`Pending migrations: ${migrationStatus.pending.join(', ')}`);
    }

    const summary = {
        ok: problems.length === 0,
        checked: {
            uniqueIndexes: REQUIRED_UNIQUE_INDEXES.length,
            ttlIndexes: REQUIRED_TTL_INDEXES.length,
            migrations: registry.length,
        },
        problems,
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (problems.length > 0) {
        problems.forEach((problem) => logger.error('db_doctor.problem', { problem }));
    } else {
        logger.info('db_doctor.ok', summary.checked);
    }

    await mongoose.connection.close(false);
    process.exit(problems.length === 0 ? 0 : 1);
};

if (require.main === module) {
    run().catch((error) => {
        logger.error('db_doctor.failed', { error: error?.message || String(error) });
        process.exit(1);
    });
}

module.exports = { run };
