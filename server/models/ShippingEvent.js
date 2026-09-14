const mongoose = require('mongoose');

// Ledger of every inbound courier webhook, mirroring PaymentEvent: the
// unique eventId is the replay-protection backstop and discarded events are
// kept for reconciliation instead of being silently dropped.
const shippingEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: 'webhook' },
    provider: { type: String, required: true, index: true },
    eventType: { type: String, default: '' },
    trackingId: { type: String, default: '', index: true },
    payloadHash: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

module.exports = mongoose.model('ShippingEvent', shippingEventSchema);
