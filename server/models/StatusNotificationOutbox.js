const mongoose = require('mongoose');

const STATUS_NOTIFICATION_STATES = [
    'queued',
    'sending',
    'sent',
    'failed',
    'cancelled',
];

const statusNotificationOutboxSchema = new mongoose.Schema({
    eventType: { type: String, required: true, trim: true, maxlength: 120, index: true },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 220, unique: true, index: true },
    recipientEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 240 },
    text: { type: String, required: true, maxlength: 10000 },
    html: { type: String, default: '', maxlength: 20000 },
    status: { type: String, enum: STATUS_NOTIFICATION_STATES, default: 'queued', index: true },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: '', maxlength: 1000 },
    subscriberId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusSubscriber', default: null, index: true },
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusIncident', default: null, index: true },
    incidentUpdateId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusIncidentUpdate', default: null, index: true },
    maintenanceWindowId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceWindow', default: null, index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

statusNotificationOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
statusNotificationOutboxSchema.index({ incidentId: 1, eventType: 1, status: 1 });

module.exports = mongoose.model('StatusNotificationOutbox', statusNotificationOutboxSchema);
module.exports.STATUS_NOTIFICATION_STATES = STATUS_NOTIFICATION_STATES;
