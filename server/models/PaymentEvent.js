const mongoose = require('mongoose');

const paymentEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    intentId: { type: String, required: true, index: true },
    source: { type: String, enum: ['api', 'webhook', 'system'], required: true },
    type: { type: String, required: true },
    payloadHash: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

paymentEventSchema.index({ intentId: 1, receivedAt: -1 });

module.exports = mongoose.model('PaymentEvent', paymentEventSchema);

