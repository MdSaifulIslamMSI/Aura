const mongoose = require('mongoose');

const assistantProductSnapshotSchema = new mongoose.Schema({
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
    productId: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    score: {
        type: Number,
        default: 0,
    },
    source: {
        type: String,
        trim: true,
        default: 'retrieval',
    },
    snapshot: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});

assistantProductSnapshotSchema.index({ thread: 1, productId: 1, createdAt: -1 });

module.exports = mongoose.model('AssistantProductSnapshot', assistantProductSnapshotSchema);
