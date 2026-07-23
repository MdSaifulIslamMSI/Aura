const mongoose = require('mongoose');

const adminRecoveryGrantSchema = new mongoose.Schema({
    grantId: { type: String, required: true, unique: true, index: true, immutable: true },
    tokenHash: { type: String, required: true, unique: true, index: true, immutable: true, select: false },
    subjectUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
    subjectAuthUidHash: { type: String, default: '', immutable: true },
    purpose: {
        type: String,
        enum: ['ADMIN_FACTOR_ENROLLMENT'],
        default: 'ADMIN_FACTOR_ENROLLMENT',
        required: true,
        immutable: true,
    },
    allowedMethods: {
        type: [String],
        enum: ['passkey'],
        default: ['passkey'],
        immutable: true,
    },
    state: {
        type: String,
        enum: ['active', 'exchanged', 'consuming', 'consumed', 'revoked'],
        default: 'active',
        required: true,
        index: true,
    },
    adminSecurityVersion: { type: Number, required: true, min: 0, immutable: true },
    operatorHash: { type: String, required: true, immutable: true },
    secondOperatorHash: { type: String, default: '', immutable: true },
    ticketHash: { type: String, default: '', immutable: true },
    reasonCode: { type: String, required: true, maxlength: 120, immutable: true },
    boundSessionHash: { type: String, default: '', select: false },
    authorityHash: { type: String, unique: true, sparse: true, index: true, select: false },
    authorityExpiresAt: { type: Date, default: null },
    issuedAt: { type: Date, default: Date.now, required: true, immutable: true },
    exchangedAt: { type: Date, default: null },
    consumingAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, immutable: true },
}, { timestamps: true });

adminRecoveryGrantSchema.index({ subjectUser: 1, state: 1, expiresAt: 1 });
adminRecoveryGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdminRecoveryGrant', adminRecoveryGrantSchema);
