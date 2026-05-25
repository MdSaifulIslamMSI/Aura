const mongoose = require('mongoose');

const STATUS_WEBHOOK_EVENT_STATES = [
    'received',
    'processed',
    'duplicate',
    'rejected',
    'failed',
];

const statusWebhookEventSchema = new mongoose.Schema({
    source: { type: String, required: true, trim: true, maxlength: 80, index: true },
    eventId: { type: String, required: true, trim: true, maxlength: 220, index: true },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 280, unique: true, index: true },
    bodyHash: { type: String, required: true, trim: true, maxlength: 128 },
    state: { type: String, enum: STATUS_WEBHOOK_EVENT_STATES, default: 'received', index: true },
    hitCount: { type: Number, default: 1, min: 1 },
    componentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent', default: null, index: true },
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusIncident', default: null, index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    requestIp: { type: String, default: '', trim: true, maxlength: 120 },
    payloadSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });

statusWebhookEventSchema.index({ source: 1, eventId: 1 });
statusWebhookEventSchema.index({ source: 1, componentId: 1, receivedAt: -1 });

module.exports = mongoose.model('StatusWebhookEvent', statusWebhookEventSchema);
module.exports.STATUS_WEBHOOK_EVENT_STATES = STATUS_WEBHOOK_EVENT_STATES;
