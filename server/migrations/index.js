const mongoose = require('mongoose');
const logger = require('../utils/logger');

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
    // 2d, not 7d: the shared M0 cluster hit its 512MB wall twice (2026-09-10,
    // 2026-10-02) with statuschecks as the fastest-growing collection. Raw
    // checks older than 2d have no display value — statusdailymetrics holds
    // the rollups — and 2d caps the collection at roughly two days of writes.
    ['statuschecks', 'checkedAt', 2, 'Status check telemetry retention (monitor writes continuously; raw checks older than 2d have no display value - statusdailymetrics holds the rollups)'],
];

const registry = [
    {
        id: '2026-09-09-coupon-redemption-user-unique',
        description: 'Create the coupon_code_user_unique backstop index on couponredemptions; fails closed if duplicate redemptions must be cleaned first.',
        up: async () => {
            await reconcileIndex('couponredemptions', { code: 1, user: 1 }, { unique: true, name: 'coupon_code_user_unique' });
        },
    },
    {
        // $indexStats on the live cluster (2026-10-02): zero query accesses
        // since the mongod process started on 2026-09-29, across three API
        // restarts and all production traffic. Every read path these served
        // is either covered by a compound that is actively used (browse:
        // isPublished_1_catalogVersion_1_*, ads: the adCampaign compound,
        // publish-gate: catalogVersion_1_publishGate.status_1_*) or is a
        // case-insensitive-regex/$ne query shape that cannot use a plain
        // index at all. Unique and TTL constraints are deliberately kept:
        // uniq_title_key, uniq_image_key, id_1_partial_unique_numeric,
        // externalId_1_source_1_catalogVersion_1 (unique+sparse), and every
        // ttl_* index. ~40.6MB freed on the shared M0 cluster.
        id: '2026-10-02-drop-zero-access-indexes',
        description: 'Drop 20 index definitions with zero recorded query accesses in 4+ days of production traffic (products: 17, statuschecks: 3); ~40.6MB freed on the shared M0 cluster.',
        up: async () => {
            const dropTargets = {
                products: [
                    'title_1',
                    'categoryPaths_1',
                    'category_1',
                    'price_1',
                    'rating_-1',
                    'stock_1',
                    'createdAt_-1',
                    'isActive_1',
                    'isPublished_1_contentQuality.publishReady_1_provenance.trustTier_1',
                    'adCampaign.status_1',
                    'adCampaign.isSponsored_1',
                    'adCampaign.priority_1',
                    'adCampaign.cpcBid_1',
                    'provenance.trustTier_1',
                    'provenance.datasetClass_1',
                    'provenance.sourceType_1',
                    'publishGate.status_1',
                ],
                statuschecks: [
                    'status_1',
                    'componentId_1',
                    'status_1_checkedAt_-1',
                ],
            };
            let dropped = 0;
            for (const [collectionName, names] of Object.entries(dropTargets)) {
                const collection = mongoose.connection.collection(collectionName);
                for (const name of names) {
                    try {
                        await collection.dropIndex(name);
                        dropped += 1;
                    } catch (error) {
                        // Missing index (27) or missing collection (26) both
                        // mean the target state is already achieved.
                        if (
                            error?.codeName !== 'IndexNotFound'
                            && error?.codeName !== 'NamespaceNotFound'
                            && error?.code !== 27
                            && error?.code !== 26
                        ) throw error;
                    }
                }
            }
            logger.info('migrations.dropped_zero_access_indexes', { dropped });
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
