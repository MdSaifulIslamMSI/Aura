const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema({
    ticket: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SupportTicket',
        required: true,
        index: true,
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    isAdmin: {
        type: Boolean,
        default: false,
    },
    isSystem: {
        type: Boolean,
        default: false,
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
}, { timestamps: true });

// Optimize history loading by ticket and time
supportMessageSchema.index({ ticket: 1, sentAt: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
