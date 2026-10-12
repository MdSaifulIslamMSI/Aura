const mongoose = require('mongoose');

const paymentEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    intentId: { type: String, required: true, index: true },
    source: { type: String, enum: ['api', 'webhook', 'system'], required: true },
    type: { type: String, required: true },
    processingState: {
        type: String,
        enum: ['received', 'suppressed', 'processed', 'discarded'],
        default: 'processed',
        index: true,
    },
    payloadHash: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

paymentEventSchema.index({ intentId: 1, receivedAt: -1 });

// TTL retention (365d, money-data class) owned by the 2026-09-09 migration
// registry entry — but this model is in CRITICAL_INDEX_MODELS, so boot-time
// syncIndexes() drops any index not declared here. The paymentevents TTL was
// silently lost that way twice (2026-10-06, re-lost after the 2026-10-07
// deploy) before db:doctor caught it; declaring it in the model keeps boot
// sync and the migration registry converged on the same index.
paymentEventSchema.index(
    { createdAt: 1 },
    { name: 'ttl_createdAt_365d', expireAfterSeconds: 365 * 24 * 60 * 60 }
);

module.exports = mongoose.model('PaymentEvent', paymentEventSchema);

