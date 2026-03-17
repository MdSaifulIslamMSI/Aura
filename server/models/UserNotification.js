const mongoose = require('mongoose');

const userNotificationSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['order', 'payment', 'listing', 'governance', 'support', 'system'],
        required: true,
        default: 'system'
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    relatedEntity: {
        type: mongoose.Schema.Types.ObjectId,
        // Could refer to Order, Product, Listing, Ticket, etc.
    },
    actionUrl: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Index for efficient fetching of a user's unread notifications
userNotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
userNotificationSchema.index({ user: 1, createdAt: -1 });

const UserNotification = mongoose.model('UserNotification', userNotificationSchema);

module.exports = UserNotification;
