const mongoose = require('mongoose');
const { EMERGENCY_FLAG_KEYS } = require('../config/emergencyControlConstants');

const emergencyAuditLogSchema = new mongoose.Schema({
    action: {
        type: String,
        enum: ['ACTIVATE', 'DEACTIVATE', 'EXTEND', 'UPDATE_MESSAGE', 'FAILED_ATTEMPT'],
        required: true,
        index: true,
    },
    flagKey: {
        type: String,
        enum: EMERGENCY_FLAG_KEYS,
        required: true,
        index: true,
        trim: true,
        uppercase: true,
    },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    performedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    performedByEmail: { type: String, default: '', lowercase: true, trim: true, index: true },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    reason: { type: String, default: '', maxlength: 2000 },
    requestId: { type: String, default: '', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    previousHash: { type: String, default: '', immutable: true },
    currentHash: { type: String, default: '', immutable: true, index: true },
    createdAt: { type: Date, default: Date.now, immutable: true, index: true },
}, {
    versionKey: false,
});

const immutableHook = function immutableAuditLog() {
    throw new Error('Emergency audit logs are immutable');
};

emergencyAuditLogSchema.pre('updateOne', immutableHook);
emergencyAuditLogSchema.pre('updateMany', immutableHook);
emergencyAuditLogSchema.pre('findOneAndUpdate', immutableHook);
emergencyAuditLogSchema.pre('deleteOne', immutableHook);
emergencyAuditLogSchema.pre('deleteMany', immutableHook);
emergencyAuditLogSchema.pre('findOneAndDelete', immutableHook);

module.exports = mongoose.model('EmergencyAuditLog', emergencyAuditLogSchema);
