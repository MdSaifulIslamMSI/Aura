const mongoose = require('mongoose');

const providerUsageSchema = new mongoose.Schema({
    windowDate: { type: String, default: '' },
    callCount: { type: Number, default: 0 },
    dailyLimit: { type: Number, default: 0 },
    blockedUntil: { type: Date, default: null },
}, { _id: false });

const fxRateSnapshotSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: 'global',
    },
    provider: { type: String, default: '' },
    source: { type: String, default: '' },
    referenceBaseCurrency: { type: String, default: 'USD' },
    asOfDate: { type: String, default: '' },
    fetchedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    cacheTtlMs: { type: Number, default: 60 * 60 * 1000 },
    rates: {
        type: Map,
        of: Number,
        default: {},
    },
    lastSuccessfulRefreshAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
    lastFailureReason: { type: String, default: '' },
    lastTrigger: { type: String, default: '' },
    refreshLockOwner: { type: String, default: '' },
    refreshLockExpiresAt: { type: Date, default: null },
    providerUsage: {
        type: Map,
        of: providerUsageSchema,
        default: {},
    },
}, { timestamps: true });

module.exports = mongoose.model('FxRateSnapshot', fxRateSnapshotSchema);
