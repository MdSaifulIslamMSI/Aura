const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['open', 'resolved', 'closed'],
        default: 'open',
        index: true,
    },
    subject: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    category: {
        type: String,
        enum: ['moderation_appeal', 'general_support', 'order_issue', 'other'],
        required: true,
        index: true,
    },
    priority: {
        type: String,
        enum: ['normal', 'high', 'urgent'],
        default: 'normal',
        index: true,
    },
    relatedActionId: {
        type: String,
        default: '',
    },
    userActionRequired: {
        type: Boolean,
        default: false,
    },
    lastActorRole: {
        type: String,
        enum: ['user', 'admin', 'system'],
        default: 'user',
    },
    resolutionSummary: {
        type: String,
        trim: true,
        maxlength: 800,
        default: '',
    },
    resolvedAt: {
        type: Date,
        default: null,
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    unreadByUser: {
        type: Number,
        default: 0,
        min: 0,
    },
    unreadByAdmin: {
        type: Number,
        default: 0,
        min: 0,
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    lastMessagePreview: {
        type: String,
        default: '',
        maxlength: 200,
    },
}, { timestamps: true });

// Optimize query for active user tickets
supportTicketSchema.index({ user: 1, lastMessageAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
