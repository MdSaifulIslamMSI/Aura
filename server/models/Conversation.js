const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    listing: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Listing',
        required: true,
        index: true,
    },
    seller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    buyer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    unreadBySeller: {
        type: Number,
        default: 0,
        min: 0,
    },
    unreadByBuyer: {
        type: Number,
        default: 0,
        min: 0,
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
    },
    lastMessagePreview: {
        type: String,
        default: '',
        maxlength: 180,
    },
    status: {
        type: String,
        enum: ['active', 'archived', 'blocked'],
        default: 'active',
    }
}, {
    timestamps: true,
});

// A buyer can only have one conversation thread per listing
conversationSchema.index({ listing: 1, buyer: 1 }, { unique: true });

// For querying a user's inbox sorted by recent activity
conversationSchema.index({ seller: 1, lastMessageAt: -1 });
conversationSchema.index({ buyer: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
