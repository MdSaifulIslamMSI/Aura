const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    getRequiredIdempotencyKey,
    getStableUserKey,
    withIdempotency,
} = require('../services/payments/idempotencyService');
const {
    getEmailOpsSummary,
    listEmailDeliveries,
    listOrderEmailNotifications,
    getOrderEmailNotificationById,
    retryOrderEmailNotification,
    sendAdminTestEmail,
} = require('../services/email/emailOpsAdminService');

const wrapUnexpected = (error, message, next) => {
    if (error instanceof AppError) return next(error);
    return next(new AppError(error.message || message, 500));
};

const getAdminEmailOpsSummary = asyncHandler(async (req, res, next) => {
    try {
        const summary = await getEmailOpsSummary();
        return res.json({ success: true, summary });
    } catch (error) {
        return wrapUnexpected(error, 'Failed to load email operations summary', next);
    }
});

const listAdminEmailDeliveries = asyncHandler(async (req, res, next) => {
    try {
        const result = await listEmailDeliveries(req.query || {});
        return res.json({ success: true, ...result });
    } catch (error) {
        return wrapUnexpected(error, 'Failed to load email delivery logs', next);
    }
});

const listAdminEmailQueue = asyncHandler(async (req, res, next) => {
    try {
        const result = await listOrderEmailNotifications(req.query || {});
        return res.json({
            success: true,
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 20),
            total: result.total,
            items: result.items,
        });
    } catch (error) {
        return wrapUnexpected(error, 'Failed to load order email queue', next);
    }
});

const getAdminEmailQueueItem = asyncHandler(async (req, res, next) => {
    try {
        const item = await getOrderEmailNotificationById(req.params.notificationId);
        return res.json({ success: true, item });
    } catch (error) {
        return wrapUnexpected(error, 'Failed to load order email item', next);
    }
});

const retryAdminEmailQueueItem = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: `email-ops:retry:${req.params.notificationId}`,
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
                        success: true,
                        item: {
                            notificationId: updated.notificationId,
                            status: updated.status,
                            attemptCount: updated.attemptCount,
                            maxAttempts: updated.maxAttempts,
                            nextAttemptAt: updated.nextAttemptAt,
                        },
                    },
                };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        return wrapUnexpected(error, 'Failed to retry order email item', next);
    }
});

const sendAdminEmailOpsTest = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: 'email-ops:test-send',
            requestPayload: req.body || {},
            handler: async () => {
                const delivery = await sendAdminTestEmail({
                    actorEmail: req.user?.email || '',
                    actorName: req.user?.name || '',
                    recipientEmail: req.body?.recipientEmail || '',
                    requestId: req.requestId,
                });
                return {
                    statusCode: 200,
                    response: {
                        success: true,
                        delivery,
                    },
                };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        return wrapUnexpected(error, 'Failed to send admin test email', next);
    }
});

module.exports = {
    getAdminEmailOpsSummary,
    listAdminEmailDeliveries,
    listAdminEmailQueue,
    getAdminEmailQueueItem,
    retryAdminEmailQueueItem,
    sendAdminEmailOpsTest,
};
