const mongoose = require('mongoose');

const userGovernanceLogSchema = new mongoose.Schema({
    actionId: { type: String, required: true, unique: true, index: true },
    actionType: {
        type: String,
        enum: ['warn', 'suspend', 'dismiss_warning', 'reactivate', 'delete'],
        required: true,
        index: true,
    },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetEmail: { type: String, default: '' },
    actorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorEmail: { type: String, default: '' },
    reason: { type: String, default: '', maxlength: 500 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

userGovernanceLogSchema.index({ targetUser: 1, createdAt: -1 });
userGovernanceLogSchema.index({ actorUser: 1, createdAt: -1 });

module.exports = mongoose.model('UserGovernanceLog', userGovernanceLogSchema);

