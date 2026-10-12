const mongoose = require('mongoose');

const authSecurityEventOutboxSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    topic: { type: String, default: 'auth.security', index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
        type: String,
        enum: ['pending', 'published', 'failed'],
        default: 'pending',
        index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, default: '' },
    nextAttemptAt: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null },
}, { timestamps: true });

authSecurityEventOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
authSecurityEventOutboxSchema.index({ 'payload.userId': 1, 'payload.event': 1, createdAt: -1 });
// Retention: every row expires on the declared short_operational_window
// (180 days). The previous index was partial on status:'published', but no
// publisher exists in the codebase — every row is written 'pending' and never
// transitions — so that TTL could never fire and the collection grew without
// bound. Subject lookup (accountSecurityActivityService, adminAssurance-
// OverviewService, authNewDeviceAlertService) requires the raw payload.userId,
// which is also what the privacy inventory's delete-by-subject erasure
// contract needs; bounded retention, not identifier hashing, is the control
// here.
authSecurityEventOutboxSchema.index(
    { createdAt: 1 },
    {
        expireAfterSeconds: 180 * 24 * 60 * 60,
        name: 'auth_security_event_retention',
    }
);

module.exports = mongoose.model('AuthSecurityEventOutbox', authSecurityEventOutboxSchema);
