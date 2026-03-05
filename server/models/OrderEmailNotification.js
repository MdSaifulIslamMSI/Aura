const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema({
    attempt: { type: Number, required: true },
    at: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: ['sent', 'retry', 'failed'], required: true },
    errorCode: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    providerMessageId: { type: String, default: '' },
}, { _id: false });

const adminActionSchema = new mongoose.Schema({
    actorUserId: { type: String, default: '' },
    action: { type: String, required: true },
    at: { type: Date, default: Date.now },
    requestId: { type: String, default: '' },
}, { _id: false });

const orderEmailNotificationSchema = new mongoose.Schema({
    notificationId: { type: String, required: true, unique: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Order', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    recipientEmail: { type: String, required: true, index: true },
    eventType: { type: String, enum: ['order_placed'], required: true, index: true },
    status: { type: String, enum: ['pending', 'processing', 'retry', 'sent', 'failed'], default: 'pending', index: true },
    dedupeKey: { type: String, required: true, unique: true, index: true },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 8 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lastAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    provider: { type: String, default: 'gmail' },
    providerMessageId: { type: String, default: '' },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastErrorCode: { type: String, default: '' },
    lastErrorMessage: { type: String, default: '' },
    alertSent: { type: Boolean, default: false },
    requestId: { type: String, default: '' },
    payloadSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    attempts: [attemptSchema],
    adminActions: [adminActionSchema],
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
}, { timestamps: true });

orderEmailNotificationSchema.index({ status: 1, nextAttemptAt: 1, lockedAt: 1 });
orderEmailNotificationSchema.index({ recipientEmail: 1, createdAt: -1 });

module.exports = mongoose.model('OrderEmailNotification', orderEmailNotificationSchema);
