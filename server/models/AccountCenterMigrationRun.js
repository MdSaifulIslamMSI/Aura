const mongoose = require('mongoose');

const accountCenterMigrationRunSchema = new mongoose.Schema({
    runId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        maxlength: 120,
    },
    migrationId: {
        type: String,
        required: true,
        index: true,
    },
    mode: {
        type: String,
        enum: ['audit', 'apply'],
        required: true,
    },
    status: {
        type: String,
        enum: ['running', 'completed', 'failed', 'paused'],
        default: 'running',
        index: true,
    },
    targetSchemaVersion: {
        type: Number,
        required: true,
    },
    checkpointId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    scanned: {
        type: Number,
        default: 0,
        min: 0,
    },
    matched: {
        type: Number,
        default: 0,
        min: 0,
    },
    modified: {
        type: Number,
        default: 0,
        min: 0,
    },
    batches: {
        type: Number,
        default: 0,
        min: 0,
    },
    pendingBefore: {
        type: Number,
        default: 0,
        min: 0,
    },
    pendingAfter: {
        type: Number,
        default: 0,
        min: 0,
    },
    approval: {
        approvedBy: { type: String, default: '', maxlength: 120 },
        ticket: { type: String, default: '', maxlength: 160 },
        backupEvidence: { type: String, default: '', maxlength: 240 },
        rollbackSha: { type: String, default: '', maxlength: 64 },
    },
    indexEvidence: {
        type: [String],
        default: [],
    },
    lastErrorCode: {
        type: String,
        default: '',
        maxlength: 120,
    },
    startedAt: {
        type: Date,
        default: Date.now,
    },
    completedAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: true,
});

accountCenterMigrationRunSchema.index(
    { migrationId: 1, status: 1, updatedAt: -1 },
    { name: 'account_center_migration_status' }
);

module.exports = mongoose.model('AccountCenterMigrationRun', accountCenterMigrationRunSchema);
