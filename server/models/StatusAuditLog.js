const mongoose = require('mongoose');

const statusAuditLogSchema = new mongoose.Schema({
    action: { type: String, required: true, trim: true, maxlength: 120, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actor: { type: String, default: '', trim: true, maxlength: 160 },
    targetType: { type: String, default: '', trim: true, maxlength: 120, index: true },
    targetId: { type: String, default: '', trim: true, maxlength: 120, index: true },
    requestId: { type: String, default: '', trim: true, maxlength: 120 },
    ip: { type: String, default: '', trim: true, maxlength: 120 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

statusAuditLogSchema.index({ action: 1, createdAt: -1 });
statusAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('StatusAuditLog', statusAuditLogSchema);
