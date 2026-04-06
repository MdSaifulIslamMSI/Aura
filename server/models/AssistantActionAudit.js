const mongoose = require('mongoose');

const assistantActionAuditSchema = new mongoose.Schema({
    thread: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AssistantThread',
        required: true,
        index: true,
    },
    message: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AssistantThreadMessage',
        required: true,
        index: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    sessionId: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    actionType: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['proposed', 'confirmed', 'cancelled', 'blocked', 'executed'],
        default: 'proposed',
        index: true,
    },
    requiresConfirmation: {
        type: Boolean,
        default: false,
    },
    payload: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    result: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});

assistantActionAuditSchema.index({ thread: 1, actionType: 1, createdAt: -1 });

module.exports = mongoose.model('AssistantActionAudit', assistantActionAuditSchema);
