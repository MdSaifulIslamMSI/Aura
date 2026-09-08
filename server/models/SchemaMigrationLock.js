const mongoose = require('mongoose');

// Singleton lock (_id: 'runner') so two operators, CI, or replicas cannot run
// migrations concurrently. Stale locks are reclaimed by the runner after
// MIGRATION_LOCK_STALE_MS.
const schemaMigrationLockSchema = new mongoose.Schema({
    _id: { type: String, default: 'runner' },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: '', maxlength: 120 },
}, { timestamps: true });

module.exports = mongoose.model('SchemaMigrationLock', schemaMigrationLockSchema);
