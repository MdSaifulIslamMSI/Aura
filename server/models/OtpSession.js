const mongoose = require('mongoose');

const otpSessionSchema = new mongoose.Schema({
    identityKey: {
        type: String,
        required: true,
        index: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    purpose: {
        type: String,
        enum: ['signup', 'login', 'forgot-password', 'payment-challenge'],
        required: true,
        index: true,
    },
    otpHash: {
        type: String,
        required: true,
        select: false,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    attempts: {
        type: Number,
        default: 0,
    },
    lockedUntil: {
        type: Date,
        default: null,
    },
    lastSentAt: {
        type: Date,
        default: Date.now,
    },
    requestMeta: {
        ip: { type: String, default: '' },
        userAgent: { type: String, default: '' },
        location: { type: String, default: '' },
        requestId: { type: String, default: '' },
        deviceId: { type: String, default: '' },
        deviceSessionHash: { type: String, default: '' },
        credentialUid: { type: String, default: '' },
    },
}, { timestamps: true });

otpSessionSchema.index({ identityKey: 1, purpose: 1 }, { unique: true });
otpSessionSchema.index({ user: 1, purpose: 1 }, { unique: true });
otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpSession', otpSessionSchema);
