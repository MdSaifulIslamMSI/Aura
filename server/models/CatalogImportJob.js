const mongoose = require('mongoose');

const catalogImportJobSchema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true, index: true },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'completed_with_errors', 'failed', 'published'],
        default: 'pending',
        index: true,
    },
    sourceType: {
        type: String,
        enum: ['json', 'jsonl', 'ndjson', 'csv'],
        required: true,
    },
    sourceRef: { type: String, required: true, trim: true },
    manifestRef: { type: String, required: true, trim: true },
    mode: { type: String, default: 'batch' },
    initiatedBy: { type: String, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestId: { type: String, default: '' },
    idempotencyKey: { type: String, default: '' },
    catalogVersion: { type: String, required: true, index: true },
    totals: {
        totalRows: { type: Number, default: 0 },
        inserted: { type: Number, default: 0 },
        updated: { type: Number, default: 0 },
        skipped: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
    },
    errorCount: { type: Number, default: 0 },
    errorSample: [{
        row: { type: Number, default: 0 },
        code: { type: String, default: '' },
        message: { type: String, default: '' },
    }],
    publishable: { type: Boolean, default: false, index: true },
    publishGateStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'dev_only'],
        default: 'pending',
        index: true,
    },
    publishGateReason: { type: String, default: '' },
    snapshotManifest: {
        providerName: { type: String, default: '' },
        feedVersion: { type: String, default: '' },
        exportTimestamp: { type: Date, default: null },
        schemaVersion: { type: String, default: '' },
        recordCount: { type: Number, default: 0 },
        sha256: { type: String, default: '' },
        sourceUrl: { type: String, default: '' },
        sourceRef: { type: String, default: '' },
        sourceType: { type: String, default: '' },
    },
    sourceValidation: {
        readyForImport: { type: Boolean, default: false },
        manifestMatchesSource: { type: Boolean, default: false },
        checksumMatches: { type: Boolean, default: false },
        computedSha256: { type: String, default: '' },
        sampleSize: { type: Number, default: 0 },
        missingFieldCoverage: [{ type: String, default: '' }],
        checkedAt: { type: Date, default: null },
    },
    qualitySummary: {
        totalProducts: { type: Number, default: 0 },
        publishReadyProducts: { type: Number, default: 0 },
        syntheticRejectedProducts: { type: Number, default: 0 },
        devOnlyProducts: { type: Number, default: 0 },
        trustedProducts: { type: Number, default: 0 },
        avgCompletenessScore: { type: Number, default: 0 },
    },
    publishedAt: { type: Date, default: null },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null, index: true },
    lockedBy: { type: String, default: null },
}, { timestamps: true });

catalogImportJobSchema.index({ status: 1, createdAt: -1 });
catalogImportJobSchema.index({ idempotencyKey: 1, user: 1 }, { sparse: true });
catalogImportJobSchema.index({ catalogVersion: 1, status: 1 });

module.exports = mongoose.model('CatalogImportJob', catalogImportJobSchema);
