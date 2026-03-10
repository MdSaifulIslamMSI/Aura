const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true,
        index: true,
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    senderRole: {
        type: String,
        enum: ['buyer', 'seller', 'system'],
        required: true,
    },
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000,
    },
    sentAt: {
        type: Date,
        default: Date.now,
    },
    readAt: {
        type: Date,
        default: null,
    },
}, { 
    timestamps: true,
});

// For loading the history of a specific conversation chronologically
messageSchema.index({ conversation: 1, sentAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
