const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    getRequiredIdempotencyKey,
    getStableUserKey,
    withIdempotency,
} = require('../services/payments/idempotencyService');
const {
    listOrderEmailNotifications,
    getOrderEmailNotificationById,
    retryOrderEmailNotification,
} = require('../services/email/orderEmailQueueService');

// @desc    List order email notifications
// @route   GET /api/admin/order-emails
// @access  Private/Admin
const listAdminOrderEmails = asyncHandler(async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const result = await listOrderEmailNotifications({
            page,
            limit,
            status: req.query.status,
            orderId: req.query.orderId,
            recipient: req.query.recipient,
        });

        return res.json({
            page,
            limit,
            total: result.total,
            items: result.items,
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch order email notifications', 500));
    }
});

// @desc    Get order email notification detail
// @route   GET /api/admin/order-emails/:notificationId
// @access  Private/Admin
const getAdminOrderEmailById = asyncHandler(async (req, res, next) => {
    try {
        const item = await getOrderEmailNotificationById(req.params.notificationId);
        return res.json(item);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch order email notification', 500));
    }
});

// @desc    Retry order email notification delivery
// @route   POST /api/admin/order-emails/:notificationId/retry
// @access  Private/Admin
const retryAdminOrderEmail = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: `order-emails:retry:${req.params.notificationId}`,
            requestPayload: req.body || {},
            handler: async () => {
                const updated = await retryOrderEmailNotification({
                    notificationId: req.params.notificationId,
                    actorUserId: req.user?._id,
                    requestId: req.requestId,
                });
                return {
                    statusCode: 200,
                    response: {
                        notificationId: updated.notificationId,
                        status: updated.status,
                        attemptCount: updated.attemptCount,
                        maxAttempts: updated.maxAttempts,
                        nextAttemptAt: updated.nextAttemptAt,
                    },
                };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to retry order email notification', 500));
    }
});

module.exports = {
    listAdminOrderEmails,
    getAdminOrderEmailById,
    retryAdminOrderEmail,
};
