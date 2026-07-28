const User = require('../models/User');
const Listing = require('../models/Listing');
const ProductReview = require('../models/ProductReview');
const TradeIn = require('../models/TradeIn');
const PriceAlert = require('../models/PriceAlert');
const AccountPrivacyJob = require('../models/AccountPrivacyJob');
const AccountCenterMigrationRun = require('../models/AccountCenterMigrationRun');
const { recordAccountMigrationState } = require('./accountProductTelemetryService');

const MIGRATION_ID = 'account-center-v2-schema-2026-07';
const TARGET_SCHEMA_VERSION = 2;
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;
const EXPECTED_INDEXES = Object.freeze([
    'listing_owner_history',
    'product_review_owner_history',
    'trade_in_owner_history',
    'price_alert_owner_history',
    'account_privacy_job_idempotency_unique',
    'account_privacy_job_owner_history',
    'account_privacy_job_worker_queue',
]);

const toPositiveInteger = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
};

const pendingVersionFilter = (afterId = null) => ({
    ...(afterId ? { _id: { $gt: afterId } } : {}),
    $or: [
        { accountCenterSchemaVersion: { $exists: false } },
        { accountCenterSchemaVersion: { $lt: TARGET_SCHEMA_VERSION } },
    ],
});

const buildEvidence = (run = {}) => ({
    runId: String(run.runId || ''),
    migrationId: MIGRATION_ID,
    mode: String(run.mode || 'audit'),
    status: String(run.status || ''),
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
    checkpointId: run.checkpointId ? String(run.checkpointId) : null,
    scanned: Number(run.scanned || 0),
    matched: Number(run.matched || 0),
    modified: Number(run.modified || 0),
    batches: Number(run.batches || 0),
    pendingBefore: Number(run.pendingBefore || 0),
    pendingAfter: Number(run.pendingAfter || 0),
    indexEvidence: Array.isArray(run.indexEvidence) ? run.indexEvidence : [],
    additiveOnly: true,
    destructive: false,
});

const createMongooseAccountCenterMigrationStore = () => ({
    countPending: () => User.countDocuments(pendingVersionFilter()),
    getBatch: ({ afterId, limit }) => User.find(pendingVersionFilter(afterId))
        .select('_id')
        .sort({ _id: 1 })
        .limit(limit)
        .lean(),
    updateBatch: (ids) => User.updateMany(
        {
            _id: { $in: ids },
            $or: [
                { accountCenterSchemaVersion: { $exists: false } },
                { accountCenterSchemaVersion: { $lt: TARGET_SCHEMA_VERSION } },
            ],
        },
        { $set: { accountCenterSchemaVersion: TARGET_SCHEMA_VERSION } }
    ),
    ensureIndexes: async () => {
        await Promise.all([
            Listing.createIndexes(),
            ProductReview.createIndexes(),
            TradeIn.createIndexes(),
            PriceAlert.createIndexes(),
            AccountPrivacyJob.createIndexes(),
            AccountCenterMigrationRun.createIndexes(),
        ]);
    },
    listIndexNames: async () => {
        const models = [Listing, ProductReview, TradeIn, PriceAlert, AccountPrivacyJob];
        const indexGroups = await Promise.all(models.map(
            (model) => model.collection.indexes().catch(() => [])
        ));
        return indexGroups
            .flat()
            .map((index) => String(index?.name || ''))
            .filter(Boolean)
            .sort();
    },
    getRun: (runId) => AccountCenterMigrationRun.findOne({ runId }).lean(),
    createRun: (payload) => AccountCenterMigrationRun.create(payload),
    updateRun: (runId, update) => AccountCenterMigrationRun.findOneAndUpdate(
        { runId },
        { $set: update },
        { returnDocument: 'after', lean: true }
    ),
});

const assertApplyAuthorization = (options = {}, env = process.env) => {
    if (options.mode !== 'apply') return;
    const enabled = ['1', 'true', 'yes', 'on'].includes(
        String(env.ACCOUNT_CENTER_MIGRATION_APPLY_ENABLED || '').trim().toLowerCase()
    );
    if (
        options.execute !== true
        || !enabled
        || !String(options.approvedBy || '').trim()
        || !String(options.ticket || '').trim()
        || !String(options.backupEvidence || '').trim()
        || !/^[a-f0-9]{40}$/i.test(String(options.rollbackSha || '').trim())
    ) {
        const error = new Error(
            'Apply mode requires --execute, the apply feature gate, approval, ticket, backup evidence, and a 40-character rollback SHA.'
        );
        error.code = 'ACCOUNT_CENTER_MIGRATION_APPLY_GATE_REQUIRED';
        throw error;
    }
};

const runAccountCenterMigration = async (options = {}, dependencies = {}) => {
    const store = dependencies.store || createMongooseAccountCenterMigrationStore();
    const wait = dependencies.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const mode = String(options.mode || 'audit').trim().toLowerCase();
    if (!['audit', 'apply'].includes(mode)) throw new Error('Migration mode must be audit or apply');
    const runId = String(options.runId || '').trim();
    if (!/^[A-Za-z0-9._-]{8,120}$/.test(runId)) throw new Error('A safe migration run ID is required');
    const normalizedOptions = {
        ...options,
        mode,
        runId,
    };
    assertApplyAuthorization(normalizedOptions, dependencies.env || process.env);

    const existing = await store.getRun(runId);
    if (existing?.status === 'completed') return buildEvidence(existing);
    if (existing && existing.mode !== mode) throw new Error('Migration run mode cannot change');

    const pendingBefore = existing
        ? Number(existing.pendingBefore || 0)
        : await store.countPending();
    const currentIndexes = await store.listIndexNames();
    const missingIndexes = EXPECTED_INDEXES.filter((name) => !currentIndexes.includes(name));

    if (mode === 'audit') {
        const auditPayload = {
            runId,
            migrationId: MIGRATION_ID,
            mode,
            status: 'completed',
            targetSchemaVersion: TARGET_SCHEMA_VERSION,
            pendingBefore,
            pendingAfter: pendingBefore,
            indexEvidence: currentIndexes,
            completedAt: new Date(),
        };
        const audit = existing
            ? await store.updateRun(runId, auditPayload)
            : await store.createRun(auditPayload);
        const evidence = buildEvidence(audit);
        recordAccountMigrationState({
            mode,
            status: evidence.status,
            pending: evidence.pendingAfter,
            modified: evidence.modified,
        });
        return evidence;
    }

    let run = existing || await store.createRun({
        runId,
        migrationId: MIGRATION_ID,
        mode,
        status: 'running',
        targetSchemaVersion: TARGET_SCHEMA_VERSION,
        pendingBefore,
        pendingAfter: pendingBefore,
        approval: {
            approvedBy: String(options.approvedBy).trim(),
            ticket: String(options.ticket).trim(),
            backupEvidence: String(options.backupEvidence).trim(),
            rollbackSha: String(options.rollbackSha).trim().toLowerCase(),
        },
        indexEvidence: currentIndexes,
    });
    try {
        if (missingIndexes.length) {
            await store.ensureIndexes();
        }

        const batchSize = toPositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
        const maxBatches = toPositiveInteger(options.maxBatches, 1000, 100000);
        const delayMs = Math.min(toPositiveInteger(options.delayMs, 50, 5000), 5000);
        // Paused or failed runs start a repair pass from the beginning so
        // documents missed by concurrent inserts or partial failure are not
        // stranded behind the last checkpoint. The version predicate is safe.
        let checkpointId = ['paused', 'failed'].includes(run.status) ? null : run.checkpointId || null;
        let scanned = Number(run.scanned || 0);
        let matched = Number(run.matched || 0);
        let modified = Number(run.modified || 0);
        let batches = Number(run.batches || 0);

        for (let index = 0; index < maxBatches; index += 1) {
            const rows = await store.getBatch({ afterId: checkpointId, limit: batchSize });
            if (!rows.length) break;
            const ids = rows.map((row) => row._id);
            const updateResult = await store.updateBatch(ids);
            checkpointId = ids[ids.length - 1];
            scanned += rows.length;
            matched += Number(updateResult.matchedCount || 0);
            modified += Number(updateResult.modifiedCount || 0);
            batches += 1;
            run = await store.updateRun(runId, {
                status: 'running',
                checkpointId,
                scanned,
                matched,
                modified,
                batches,
            });
            if (rows.length < batchSize) break;
            await wait(delayMs);
        }

        const pendingAfter = await store.countPending();
        const status = pendingAfter === 0 ? 'completed' : 'paused';
        run = await store.updateRun(runId, {
            status,
            checkpointId,
            scanned,
            matched,
            modified,
            batches,
            pendingAfter,
            indexEvidence: await store.listIndexNames(),
            completedAt: status === 'completed' ? new Date() : null,
            lastErrorCode: '',
        });
        const evidence = buildEvidence(run);
        recordAccountMigrationState({
            mode,
            status: evidence.status,
            pending: evidence.pendingAfter,
            modified: evidence.modified,
        });
        return evidence;
    } catch (error) {
        const lastErrorCode = String(error?.code || 'ACCOUNT_CENTER_MIGRATION_BATCH_FAILED')
            .replace(/[^A-Z0-9_]/gi, '_')
            .slice(0, 120);
        await store.updateRun(runId, {
            status: 'failed',
            lastErrorCode,
            pendingAfter: await store.countPending().catch(() => Number(run.pendingAfter || pendingBefore)),
            completedAt: null,
        }).catch(() => null);
        recordAccountMigrationState({
            mode,
            status: 'failed',
            pending: Number(run.pendingAfter || pendingBefore),
            modified: Number(run.modified || 0),
        });
        throw error;
    }
};

module.exports = {
    DEFAULT_BATCH_SIZE,
    EXPECTED_INDEXES,
    MAX_BATCH_SIZE,
    MIGRATION_ID,
    TARGET_SCHEMA_VERSION,
    assertApplyAuthorization,
    buildEvidence,
    createMongooseAccountCenterMigrationStore,
    pendingVersionFilter,
    runAccountCenterMigration,
};
