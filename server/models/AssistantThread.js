const mongoose = require('mongoose');

const assistantThreadSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        index: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    assistantMode: {
        type: String,
        enum: ['chat', 'voice', 'compare', 'bundle'],
        default: 'chat',
    },
    status: {
        type: String,
        enum: ['active', 'archived'],
        default: 'active',
        index: true,
    },
    title: {
        type: String,
        trim: true,
        default: 'New chat',
    },
    preview: {
        type: String,
        trim: true,
        default: 'Start a new assistant thread.',
    },
    originPath: {
        type: String,
        trim: true,
        default: '/',
    },
    lastRoute: {
        type: String,
        trim: true,
        default: '',
    },
    lastProvider: {
        type: String,
        trim: true,
        default: '',
    },
    lastProviderModel: {
        type: String,
        trim: true,
        default: '',
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    messageCount: {
        type: Number,
        default: 0,
        min: 0,
    },
    assistantSessionState: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});

assistantThreadSchema.index({ user: 1, status: 1, lastMessageAt: -1 });

module.exports = mongoose.model('AssistantThread', assistantThreadSchema);
