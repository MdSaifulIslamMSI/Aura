const mongoose = require('mongoose');

// The ledger head is one counter document, not an event. Its own collection is
// load-bearing twice over: the event model's _id is an ObjectId, so upserting
// the string id 'security_event_ledger_head' into it throws a CastError, and a
// counter document inside the ledger collection would be replayed to the
// verifier as a malformed record.
const securityEventLedgerHeadSchema = new mongoose.Schema({
    _id: { type: String },
    seq: { type: Number, default: 0 },
    lastHash: { type: String, default: '' },
}, { versionKey: false, timestamps: true });

module.exports = mongoose.models.SecurityEventLedgerHead
    || mongoose.model('SecurityEventLedgerHead', securityEventLedgerHeadSchema);
