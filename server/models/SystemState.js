const mongoose = require('mongoose');

const systemStateSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true, default: 'singleton' },
    activeCatalogVersion: { type: String, default: 'legacy-v1', index: true },
    previousCatalogVersion: { type: String, default: '' },
    lastSwitchAt: { type: Date, default: null },
    manualProductCounter: { type: Number, default: 1000000 },
    catalogLastImportAt: { type: Date, default: null },
    catalogLastSyncAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SystemState', systemStateSchema);
