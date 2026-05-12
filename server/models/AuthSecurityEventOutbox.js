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

module.exports = mongoose.model('AuthSecurityEventOutbox', authSecurityEventOutboxSchema);
