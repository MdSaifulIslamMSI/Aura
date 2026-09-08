const mongoose = require('mongoose');

// Ledger of applied schema/data migrations. Written by server/migrations/runner.js;
// never edit applied rows by hand.
const schemaMigrationSchema = new mongoose.Schema({
    migrationId: { type: String, required: true, trim: true, maxlength: 160, unique: true, index: true },
    checksum: { type: String, default: '', maxlength: 64 },
    description: { type: String, default: '', maxlength: 500 },
    appliedAt: { type: Date, default: Date.now },
    durationMs: { type: Number, default: 0, min: 0 },
    appliedBy: { type: String, default: '', maxlength: 120 },
}, { timestamps: true });

module.exports = mongoose.model('SchemaMigration', schemaMigrationSchema);
