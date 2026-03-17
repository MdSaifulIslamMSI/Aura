const UserNotification = require('../models/UserNotification');
const AppError = require('../utils/AppError');

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
exports.getNotifications = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const unreadOnly = req.query.unreadOnly === 'true';

        const query = { user: req.user._id };
        if (unreadOnly) {
            query.isRead = false;
        }

        const startIndex = (page - 1) * limit;

        const notifications = await UserNotification.find(query)
            .sort({ createdAt: -1 })
            .skip(startIndex)
            .limit(limit);

        const total = await UserNotification.countDocuments(query);
        const unreadCount = await UserNotification.countDocuments({ user: req.user._id, isRead: false });

        res.status(200).json({
            success: true,
            count: notifications.length,
            total,
            unreadCount,
            page,
            totalPages: Math.ceil(total / limit),
            data: notifications
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark specific notifications as read
// @route   PUT /api/notifications/read
// @access  Private
exports.markAsRead = async (req, res, next) => {
    try {
        const { notificationIds } = req.body;

        if (!notificationIds || !Array.isArray(notificationIds)) {
            return next(new AppError('Please provide an array of notification IDs', 400));
        }

        await UserNotification.updateMany(
            { _id: { $in: notificationIds }, user: req.user._id },
            { $set: { isRead: true } }
        );

        res.status(200).json({
            success: true,
            message: 'Notifications marked as read'
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
exports.markAllAsRead = async (req, res, next) => {
    try {
        await UserNotification.updateMany(
            { user: req.user._id, isRead: false },
            { $set: { isRead: true } }
        );

        res.status(200).json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        next(error);
    }
};
