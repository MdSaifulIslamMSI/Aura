// server/services/notificationService.js
const UserNotification = require('../models/UserNotification');
const { sendMessageToUser } = require('./socketService');
const logger = require('../utils/logger');

/**
 * Creates a persistent notification in the database and broadcasts it in real-time.
 * 
 * @param {ObjectId|string} userId - The recipient user
 * @param {string} title - The notification title
 * @param {string} message - The notification body
 * @param {Object} options - Additional options
 * @param {string} [options.type='system'] - Type of notification
 * @param {ObjectId|string} [options.relatedEntity] - Optional related ID
 * @param {string} [options.actionUrl] - Optional frontend URL to redirect to
 */
exports.sendPersistentNotification = async (userId, title, message, options = {}) => {
    try {
        const {
            type = 'system',
            priority = 'medium',
            relatedEntity,
            actionUrl,
            actionLabel = '',
            metadata = {},
        } = options;

        const notification = await UserNotification.create({
            user: userId,
            title,
            message,
            type,
            priority,
            relatedEntity,
            actionUrl,
            actionLabel,
            metadata,
        });

        // Broadcast to user if they are online
        sendMessageToUser(userId, 'user:notification:new', notification);

        return notification;
    } catch (error) {
        logger.error(`Failed to send persistent notification to ${userId}: ${error.message}`);
        throw error;
    }
};
