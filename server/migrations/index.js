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
            await mongoose.connection.collection('couponredemptions').createIndex(
                { code: 1, user: 1 },
                { unique: true, name: 'coupon_code_user_unique' }
            );
        },
    },
    ...TTL_RETENTIONS.map(([collection, field, days, label]) => ({
        id: `2026-09-09-ttl-${collection}-${field}-${days}d`,
        description: `${label}: ${days}-day TTL index on ${collection}.${field}.`,
        up: async () => {
            await mongoose.connection.collection(collection).createIndex(
                { [field]: 1 },
                { expireAfterSeconds: days * DAY_SECONDS, name: `ttl_${field}_${days}d` }
            );
        },
    })),
];

module.exports = { registry };
