const mongoose = require('mongoose');

const catalogSyncCursorSchema = new mongoose.Schema({
    provider: { type: String, required: true, unique: true, index: true },
    cursor: { type: String, default: '' },
    lastRunAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    failCount: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('CatalogSyncCursor', catalogSyncCursorSchema);
