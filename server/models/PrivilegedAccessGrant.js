const mongoose = require('mongoose');

const privilegedAccessGrantSchema = new mongoose.Schema({
    grantId: { type: String, required: true, unique: true, index: true, immutable: true },
    subjectUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
    permission: { type: String, required: true, maxlength: 120, immutable: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'denied', 'revoked', 'expired'],
        default: 'pending',
        required: true,
        index: true,
    },
    reason: { type: String, required: true, maxlength: 500, immutable: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    deniedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deniedAt: { type: Date, default: null },
    deniedReason: { type: String, default: '', maxlength: 500 },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
}, { timestamps: true });

privilegedAccessGrantSchema.index({ subjectUser: 1, status: 1, expiresAt: 1 });
privilegedAccessGrantSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('PrivilegedAccessGrant', privilegedAccessGrantSchema);
