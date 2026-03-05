const mongoose = require('mongoose');

const catalogSyncRunSchema = new mongoose.Schema({
    syncRunId: { type: String, required: true, unique: true, index: true },
    provider: { type: String, required: true, index: true },
    cursorInput: { type: String, default: '' },
    cursorOutput: { type: String, default: '' },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'completed_with_errors', 'failed'],
        default: 'pending',
        index: true,
    },
    idempotencyKey: { type: String, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestId: { type: String, default: '' },
    totals: {
        processed: { type: Number, default: 0 },
        inserted: { type: Number, default: 0 },
        updated: { type: Number, default: 0 },
        skipped: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
    },
    errorSample: [{
        row: { type: Number, default: 0 },
        code: { type: String, default: '' },
        message: { type: String, default: '' },
    }],
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null, index: true },
    lockedBy: { type: String, default: null },
}, { timestamps: true });

catalogSyncRunSchema.index({ status: 1, createdAt: -1 });
catalogSyncRunSchema.index({ provider: 1, createdAt: -1 });
catalogSyncRunSchema.index({ idempotencyKey: 1, user: 1 }, { sparse: true });

module.exports = mongoose.model('CatalogSyncRun', catalogSyncRunSchema);
