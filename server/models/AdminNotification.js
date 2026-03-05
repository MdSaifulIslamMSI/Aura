const mongoose = require('mongoose');

const adminNotificationSchema = new mongoose.Schema({
    notificationId: { type: String, required: true, unique: true, index: true },
    source: { type: String, enum: ['user_action', 'system', 'admin_action'], default: 'user_action', index: true },
    actionKey: { type: String, required: true, index: true },
    title: { type: String, required: true, maxlength: 180 },
    summary: { type: String, default: '', maxlength: 500 },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info', index: true },
    method: { type: String, default: '', maxlength: 12 },
    path: { type: String, default: '', maxlength: 260 },
    statusCode: { type: Number, default: 200 },
    durationMs: { type: Number, default: 0 },
    actorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorName: { type: String, default: '', maxlength: 120 },
    actorEmail: { type: String, default: '', maxlength: 160, index: true },
    actorRole: { type: String, enum: ['user', 'seller', 'admin', 'guest', 'system'], default: 'user', index: true },
    entityType: { type: String, default: '', maxlength: 60, index: true },
    entityId: { type: String, default: '', maxlength: 120, index: true },
    highlights: { type: [String], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestId: { type: String, default: '', maxlength: 120, index: true },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    readBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

adminNotificationSchema.index({ isRead: 1, createdAt: -1 });
adminNotificationSchema.index({ source: 1, createdAt: -1 });
adminNotificationSchema.index({ actionKey: 1, createdAt: -1 });
adminNotificationSchema.index({ actorRole: 1, createdAt: -1 });
adminNotificationSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model('AdminNotification', adminNotificationSchema);

