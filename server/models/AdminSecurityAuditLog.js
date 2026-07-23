const mongoose = require('mongoose');

const adminSecurityAuditLogSchema = new mongoose.Schema({
    event: { type: String, required: true, index: true, immutable: true },
    outcome: {
        type: String,
        enum: ['success', 'failure', 'blocked', 'issued', 'consumed'],
        required: true,
        immutable: true,
    },
    reasonCode: { type: String, default: '', maxlength: 120, immutable: true },
    subjectUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true, immutable: true },
    grantId: { type: String, default: '', index: true, immutable: true },
    requestId: { type: String, default: '', index: true, immutable: true },
    ipHash: { type: String, default: '', immutable: true },
    userAgentHash: { type: String, default: '', immutable: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
    createdAt: { type: Date, default: Date.now, index: true, immutable: true },
}, { versionKey: false });

const immutableHook = function immutableAdminSecurityAuditLog() {
    throw new Error('Admin security audit logs are immutable');
};

adminSecurityAuditLogSchema.pre('updateOne', immutableHook);
adminSecurityAuditLogSchema.pre('updateMany', immutableHook);
adminSecurityAuditLogSchema.pre('findOneAndUpdate', immutableHook);
adminSecurityAuditLogSchema.pre('deleteOne', immutableHook);
adminSecurityAuditLogSchema.pre('deleteMany', immutableHook);
adminSecurityAuditLogSchema.pre('findOneAndDelete', immutableHook);

module.exports = mongoose.model('AdminSecurityAuditLog', adminSecurityAuditLogSchema);
