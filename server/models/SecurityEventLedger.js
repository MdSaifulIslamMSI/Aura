const mongoose = require('mongoose');

// Phase 5B: tamper-evident security event ledger. Each record is individually
// signed (HMAC) and hash-chained to its predecessor via a monotonic sequence
// number, so DB-only tampering (edit, delete, reorder, splice) is detectable.
const securityEventLedgerSchema = new mongoose.Schema({
    seq: { type: Number, required: true, unique: true, index: true },
    eventId: { type: String, required: true, index: true },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true, index: true },
    signature: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

securityEventLedgerSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SecurityEventLedger', securityEventLedgerSchema);
