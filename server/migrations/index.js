const mongoose = require('mongoose');

// Registry of ordered schema/data migrations executed by
// scripts/run_migrations.js (npm run migrate:run / migrate:status).
//
// Rules:
// - Append-only: never edit or reorder an entry once it has been applied; the
//   runner records migrationId + checksum in the SchemaMigration ledger.
// - Each entry: { id, description, up }. `up` receives no arguments and must
//   be idempotent enough to survive a crash between applying and recording.
// - One-off scripts under server/scripts/migrate_*.js predate this runner and
//   stay as documented legacy; new migrations register here.

const DAY_SECONDS = 24 * 60 * 60;

const keyOf = (indexKey) => JSON.stringify(indexKey);

// createIndex rejects a key pattern that already exists under a different
// name/options ("An equivalent index already exists..."), so every index
// migration reconciles: no-op when an equivalent index already carries the
// required options, otherwise drop the stale one and build the intended one.
const reconcileIndex = async (collectionName, spec, createOptions) => {
    const collection = mongoose.connection.collection(collectionName);
    let indexes;
    try {
        indexes = await collection.indexes();
    } catch (error) {
        // A collection that has never been written has no namespace yet;
        // treat it as having no existing indexes (createIndex creates it).
        if (error?.codeName !== 'NamespaceNotFound' && error?.code !== 26) throw error;
        indexes = [];
    }
    const existing = indexes.find((index) => keyOf(index.key) === keyOf(spec));
    if (existing && Object.entries(createOptions).every(([key, value]) => existing[key] === value)) {
        return 'kept';
    }
    if (existing) await collection.dropIndex(existing.name);
    await collection.createIndex(spec, { ...createOptions, name: createOptions.name });
    return existing ? 'replaced' : 'created';
};

// Retention policy (approved 2026-09-09): logs/notifications roll off in
// 90-180 days, money-related events stay 365 days. Shared-tier storage is
// capped (512MB/2GB), so unbounded growth eventually takes writes down.
const TTL_RETENTIONS = [
    ['emaildeliverylogs', 'createdAt', 90, 'Email delivery log retention'],
    ['securityevents', 'timestamp', 180, 'Auth/security event retention'],
    ['usernotifications', 'createdAt', 180, 'User notification retention'],
    ['adminnotifications', 'createdAt', 180, 'Admin notification retention'],
    ['assistantthreadmessages', 'createdAt', 180, 'Assistant thread message retention'],
    ['statusauditlogs', 'createdAt', 180, 'Status page audit log retention'],
    ['productgovernancelogs', 'createdAt', 365, 'Product governance log retention'],
    ['usergovernancelogs', 'createdAt', 365, 'User governance log retention'],
    ['paymentevents', 'createdAt', 365, 'Payment event retention (money data)'],
];

const registry = [
    {
        id: '2026-09-09-coupon-redemption-user-unique',
        description: 'Create the coupon_code_user_unique backstop index on couponredemptions; fails closed if duplicate redemptions must be cleaned first.',
        up: async () => {
            await reconcileIndex('couponredemptions', { code: 1, user: 1 }, { unique: true, name: 'coupon_code_user_unique' });
        },
    },
    ...TTL_RETENTIONS.map(([collection, field, days, label]) => ({
        id: `2026-09-09-ttl-${collection}-${field}-${days}d`,
        description: `${label}: ${days}-day TTL index on ${collection}.${field}.`,
        up: async () => {
            await reconcileIndex(collection, { [field]: 1 }, {
                expireAfterSeconds: days * DAY_SECONDS,
                name: `ttl_${field}_${days}d`,
            });
        },
    })),
];

module.exports = { registry };
