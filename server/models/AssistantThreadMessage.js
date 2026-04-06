const mongoose = require('mongoose');

const assistantThreadMessageSchema = new mongoose.Schema({
    thread: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AssistantThread',
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
    role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true,
    },
    content: {
        type: String,
        trim: true,
        default: '',
    },
    route: {
        type: String,
        trim: true,
        default: '',
    },
    provider: {
        type: String,
        trim: true,
        default: '',
    },
    providerModel: {
        type: String,
        trim: true,
        default: '',
    },
    retrievalHitCount: {
        type: Number,
        default: 0,
        min: 0,
    },
    assistantTurn: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    grounding: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});

assistantThreadMessageSchema.index({ sessionId: 1, createdAt: 1 });
assistantThreadMessageSchema.index({ thread: 1, createdAt: 1 });

module.exports = mongoose.model('AssistantThreadMessage', assistantThreadMessageSchema);
