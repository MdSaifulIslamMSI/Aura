const crypto = require('crypto');
const mongoose = require('mongoose');

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MIGRATION_RUN_SCHEMA_VERSION = 2;
const INITIAL_SOURCE_DIGEST = crypto
    .createHash('sha256')
    .update(JSON.stringify({
        contract: 'trusted-device-v2-legacy-backfill-v2',
        sourceSchemaVersion: 1,
    }))
    .digest('hex');
const MIGRATION_MODES = Object.freeze(['audit', 'apply']);
const MIGRATION_AUDIENCES = Object.freeze(['admin', 'public', 'all']);
const MIGRATION_STATUSES = Object.freeze([
    'planned',
    'running',
    'paused',
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
]);
const TERMINAL_STATUSES = new Set([
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
]);

const nonNegativeCount = { type: Number, default: 0, min: 0 };

const trustedDeviceMigrationRunSchema = new mongoose.Schema({
    schemaVersion: {
        type: Number,
        enum: [MIGRATION_RUN_SCHEMA_VERSION],
        default: MIGRATION_RUN_SCHEMA_VERSION,
        required: true,
        immutable: true,
    },
    runId: { type: String, required: true, trim: true, maxlength: 128 },
    mode: {
        type: String,
        enum: MIGRATION_MODES,
        default: 'audit',
        required: true,
    },
    audience: {
        type: String,
        enum: MIGRATION_AUDIENCES,
        default: 'all',
        required: true,
    },
    status: {
        type: String,
        enum: MIGRATION_STATUSES,
        default: 'planned',
        required: true,
    },
    sourceSchemaVersion: { type: Number, enum: [1], default: 1, immutable: true },
    targetSchemaVersion: { type: Number, enum: [2], default: 2, immutable: true },
    requestedByHash: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: HASH_PATTERN,
        select: false,
    },
    configHash: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: HASH_PATTERN,
    },
    sourceSnapshotAt: { type: Date, required: true, default: Date.now },
    approval: {
        approvedAt: { type: Date, default: null },
        approvedByHash: {
            type: String,
            default: null,
            trim: true,
            lowercase: true,
            match: HASH_PATTERN,
            select: false,
        },
        changeTicketHash: {
            type: String,
            default: null,
            trim: true,
            lowercase: true,
            match: HASH_PATTERN,
            select: false,
        },
    },
    checkpoint: {
        lastUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
        batchNumber: { ...nonNegativeCount },
        scannedCount: { ...nonNegativeCount },
        sourceDigest: {
            type: String,
            required: true,
            default: INITIAL_SOURCE_DIGEST,
            trim: true,
            lowercase: true,
            match: HASH_PATTERN,
        },
        updatedAt: { type: Date, default: null },
    },
    totals: {
        scanned: { ...nonNegativeCount },
        eligible: { ...nonNegativeCount },
        migrated: { ...nonNegativeCount },
        skipped: { ...nonNegativeCount },
        failed: { ...nonNegativeCount },
    },
    errorSample: {
        type: [{
            subjectHash: {
                type: String,
                required: true,
                trim: true,
                lowercase: true,
                match: HASH_PATTERN,
                select: false,
            },
            code: { type: String, required: true, trim: true, maxlength: 80 },
            detailCode: { type: String, default: '', trim: true, maxlength: 80 },
            recordedAt: { type: Date, default: Date.now },
        }],
        default: [],
        validate: {
            validator: (entries) => entries.length <= 20,
            message: 'errorSample cannot contain more than 20 entries',
        },
    },
    lock: {
        ownerHash: {
            type: String,
            default: null,
            trim: true,
            lowercase: true,
            match: HASH_PATTERN,
            select: false,
        },
        acquiredAt: { type: Date, default: null },
        leaseExpiresAt: { type: Date, default: null },
    },
    startedAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
}, { timestamps: true });

trustedDeviceMigrationRunSchema.index(
    { runId: 1 },
    { unique: true, name: 'trusted_device_migration_run_id_unique' }
);
trustedDeviceMigrationRunSchema.index(
    { status: 1, createdAt: -1 },
    { name: 'trusted_device_migration_status' }
);
trustedDeviceMigrationRunSchema.index(
    { mode: 1, audience: 1, createdAt: -1 },
    { name: 'trusted_device_migration_scope' }
);
trustedDeviceMigrationRunSchema.index(
    { 'lock.leaseExpiresAt': 1, status: 1 },
    { name: 'trusted_device_migration_lease' }
);

trustedDeviceMigrationRunSchema.pre('validate', function validateMigrationRunState() {
    const hasApproval = Boolean(this.approval?.approvedAt && this.approval?.approvedByHash);
    if (this.mode === 'apply' && !hasApproval) {
        this.invalidate('approval', 'apply migrations require approval time and an approvedByHash');
    }

    if (['running', 'paused'].includes(this.status) && !this.startedAt) {
        this.invalidate('startedAt', `${this.status} migrations must record startedAt`);
    }
    if (TERMINAL_STATUSES.has(this.status) && !this.finishedAt) {
        this.invalidate('finishedAt', `${this.status} migrations must record finishedAt`);
    }
    if (!TERMINAL_STATUSES.has(this.status) && this.finishedAt) {
        this.invalidate('finishedAt', `${this.status} migrations cannot record finishedAt`);
    }

    const lockParts = [this.lock?.ownerHash, this.lock?.acquiredAt, this.lock?.leaseExpiresAt];
    const populatedLockParts = lockParts.filter(Boolean).length;
    if (populatedLockParts > 0 && populatedLockParts < lockParts.length) {
        this.invalidate('lock', 'migration lock owner, acquisition time, and lease expiry are all required together');
    }
    if (
        populatedLockParts === lockParts.length
        && this.lock.leaseExpiresAt.getTime() <= this.lock.acquiredAt.getTime()
    ) {
        this.invalidate('lock.leaseExpiresAt', 'migration lock lease must expire after it is acquired');
    }

    const accounted = Number(this.totals?.migrated || 0)
        + Number(this.totals?.skipped || 0)
        + Number(this.totals?.failed || 0);
    if (accounted > Number(this.totals?.scanned || 0)) {
        this.invalidate('totals', 'migrated, skipped, and failed totals cannot exceed scanned');
    }
    if (Number(this.checkpoint?.scannedCount || 0) > Number(this.totals?.scanned || 0)) {
        this.invalidate('checkpoint.scannedCount', 'checkpoint scannedCount cannot exceed total scanned');
    }
});

const TrustedDeviceMigrationRun = mongoose.models.TrustedDeviceMigrationRun
    || mongoose.model('TrustedDeviceMigrationRun', trustedDeviceMigrationRunSchema);

module.exports = TrustedDeviceMigrationRun;
module.exports.constants = Object.freeze({
    MIGRATION_AUDIENCES,
    MIGRATION_MODES,
    MIGRATION_RUN_SCHEMA_VERSION,
    MIGRATION_STATUSES,
});
