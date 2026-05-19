const mongoose = require('mongoose');

const NOTIFICATION_LEVELS = [
    'all',
    'major',
    'maintenance',
];

const statusSubscriberSchema = new mongoose.Schema({
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 254 },
    verifiedAt: { type: Date, default: null },
    unsubscribeTokenHash: { type: String, required: true, index: true },
    selectedComponentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent' }],
    selectedGroupIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponentGroup' }],
    notificationLevel: { type: String, enum: NOTIFICATION_LEVELS, default: 'all', index: true },
}, { timestamps: true });

statusSubscriberSchema.index({ notificationLevel: 1, createdAt: -1 });

module.exports = mongoose.model('StatusSubscriber', statusSubscriberSchema);
module.exports.NOTIFICATION_LEVELS = NOTIFICATION_LEVELS;
