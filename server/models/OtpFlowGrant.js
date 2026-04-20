const mongoose = require('mongoose');

const otpFlowGrantSchema = new mongoose.Schema({
    tokenId: {
        type: String,
        required: true,
        unique: true,
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
    factor: {
        type: String,
        enum: ['otp', 'email', ''],
        default: '',
    },
    currentStep: {
        type: String,
        enum: ['otp-verified', 'email-verified', 'phone-factor-verified', 'issued'],
        default: 'issued',
    },
    nextStep: {
        type: String,
        enum: ['auth-sync', 'reset-password'],
        required: true,
        index: true,
    },
    state: {
        type: String,
        enum: ['active', 'consumed', 'superseded'],
        default: 'active',
        index: true,
    },
    issuedAt: {
        type: Date,
        default: Date.now,
        required: true,
    },
    consumedAt: {
        type: Date,
        default: null,
    },
    supersededAt: {
        type: Date,
        default: null,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
}, { timestamps: true });

otpFlowGrantSchema.index({ user: 1, purpose: 1, nextStep: 1, state: 1 });
otpFlowGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpFlowGrant', otpFlowGrantSchema);
