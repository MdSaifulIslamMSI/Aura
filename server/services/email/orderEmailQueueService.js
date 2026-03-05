const crypto = require('crypto');
const os = require('os');
const mongoose = require('mongoose');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const Order = require('../../models/Order');
const OrderEmailNotification = require('../../models/OrderEmailNotification');
const { flags, EMAIL_REGEX } = require('../../config/emailFlags');
const { sendTransactionalEmail } = require('./index');
const { renderOrderPlacedTemplate } = require('./templates/orderPlacedTemplate');

const EVENT_ORDER_PLACED = 'order_placed';
const DEFAULT_RETRY_SCHEDULE_MINUTES = [1, 2, 5, 10, 30, 60, 180, 360];
const MAX_NOTIFICATIONS_PER_CYCLE = 20;

let orderEmailWorkerTimer = null;
const WORKER_ID = `${os.hostname()}-${process.pid}`;

const makeNotificationId = () => `oen_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;

const buildNotificationDedupeKey = ({ orderId, eventType, recipientEmail }) =>
    `${String(orderId)}:${String(eventType)}:${String(recipientEmail).trim().toLowerCase()}`;

const computeRetryDelayMs = (attemptCount, randomFn = Math.random) => {
    const index = Math.max(0, Math.min(attemptCount - 1, DEFAULT_RETRY_SCHEDULE_MINUTES.length - 1));
    const baseMs = DEFAULT_RETRY_SCHEDULE_MINUTES[index] * 60 * 1000;
    const jitterFactor = 0.8 + (Math.min(Math.max(randomFn(), 0), 1) * 0.4);
    return Math.round(baseMs * jitterFactor);
};

const sanitizeSnapshotItems = (orderItems = []) => {
    if (!Array.isArray(orderItems)) return [];
    return orderItems.slice(0, 50).map((item) => ({
        title: String(item.title || '').slice(0, 200),
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
    }));
};

const buildPayloadSnapshot = ({ order, user }) => ({
    orderId: String(order._id || ''),
    customerName: String(user?.name || 'Customer'),
    customerEmail: String(user?.email || '').trim().toLowerCase(),
    createdAt: order.createdAt || new Date(),
    orderItems: sanitizeSnapshotItems(order.orderItems),
    shippingAddress: order.shippingAddress || {},
    paymentMethod: order.paymentMethod || 'COD',
    paymentState: order.paymentState || 'pending',
    itemsPrice: Number(order.itemsPrice || 0),
    shippingPrice: Number(order.shippingPrice || 0),
    taxPrice: Number(order.taxPrice || 0),
    couponDiscount: Number(order.couponDiscount || 0),
    paymentAdjustment: Number(order.paymentAdjustment || 0),
    totalPrice: Number(order.totalPrice || 0),
    deliveryOption: order.deliveryOption || 'standard',
    deliverySlot: order.deliverySlot || null,
    checkoutSource: order.checkoutSource || 'cart',
    pricingVersion: order.pricingVersion || 'v1',
});

const assertRecipientEmail = (email) => {
    const candidate = String(email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(candidate)) {
        throw new AppError('A valid account email is required to place order', 400);
    }
    return candidate;
};

const enqueueOrderPlacedEmail = async ({
    order,
    user,
    requestId = '',
    session = null,
}) => {
    if (!flags.orderEmailsEnabled) {
        return null;
    }

    const recipientEmail = assertRecipientEmail(user?.email);
    const eventType = EVENT_ORDER_PLACED;
    const dedupeKey = buildNotificationDedupeKey({
        orderId: order._id,
        eventType,
        recipientEmail,
    });

    const existingQuery = OrderEmailNotification.findOne({ dedupeKey });
    if (session) existingQuery.session(session);
    const existing = await existingQuery;
    if (existing) return existing;

    const payloadSnapshot = buildPayloadSnapshot({ order, user });
    const notificationDoc = {
        notificationId: makeNotificationId(),
        order: order._id,
        user: user?._id || order.user,
        recipientEmail,
        eventType,
        status: 'pending',
        dedupeKey,
        attemptCount: 0,
        maxAttempts: flags.orderEmailMaxRetries,
        nextAttemptAt: new Date(),
        provider: flags.orderEmailProvider,
        requestId: String(requestId || ''),
        payloadSnapshot,
        attempts: [],
        adminActions: [],
    };

    try {
        const createResult = await OrderEmailNotification.create([notificationDoc], { session });
        return createResult[0];
    } catch (error) {
        if (error?.code === 11000) {
            const duplicateQuery = OrderEmailNotification.findOne({ dedupeKey });
            if (session) duplicateQuery.session(session);
            return duplicateQuery;
        }
        throw error;
    }
};

const classifyDeliveryError = (error) => {
    const code = String(error?.emailCode || error?.code || 'UNKNOWN_EMAIL_ERROR');
    const retryable = Boolean(
        error?.emailRetryable !== undefined
            ? error.emailRetryable
            : !['AUTH_FAILED', 'INVALID_RECIPIENT', 'CONFIG_ERROR'].includes(code)
    );

    return {
        code,
        retryable,
        message: String(error?.message || 'Email delivery failed'),
    };
};

const appendAttemptRecord = (notification, data) => {
    const attempts = Array.isArray(notification.attempts) ? notification.attempts : [];
    return [...attempts, data].slice(-50);
};

const markOrderEmailStatus = async ({ orderId, status, sentAt = null, notificationId = '' }) => {
    const update = {
        confirmationEmailStatus: status,
        confirmationEmailSentAt: sentAt,
    };
    if (notificationId) {
        update.confirmationEmailNotificationId = notificationId;
    }
    await Order.updateOne({ _id: orderId }, { $set: update });
};

const sendTerminalFailureAlert = async ({ notification, errorSummary }) => {
    if (!flags.orderEmailAlertTo || notification.alertSent) return false;

    const subject = `ALERT: Order email failed permanently (${notification.notificationId})`;
    const text = [
        'Order confirmation email failed permanently.',
        `Notification ID: ${notification.notificationId}`,
        `Order ID: ${notification.order}`,
        `Recipient: ${notification.recipientEmail}`,
        `Attempts: ${notification.attemptCount}/${notification.maxAttempts}`,
        `Error Code: ${errorSummary.code}`,
        `Error Message: ${errorSummary.message}`,
    ].join('\n');

    const html = `
        <p>Order confirmation email failed permanently.</p>
        <p><strong>Notification ID:</strong> ${notification.notificationId}</p>
        <p><strong>Order ID:</strong> ${notification.order}</p>
        <p><strong>Recipient:</strong> ${notification.recipientEmail}</p>
        <p><strong>Attempts:</strong> ${notification.attemptCount}/${notification.maxAttempts}</p>
        <p><strong>Error Code:</strong> ${errorSummary.code}</p>
        <p><strong>Error Message:</strong> ${errorSummary.message}</p>
    `;

    try {
        await sendTransactionalEmail({
            eventType: 'order_email_alert',
            to: flags.orderEmailAlertTo,
            subject,
            html,
            text,
            requestId: notification.requestId || notification.notificationId,
            headers: { 'X-Aura-Alert': 'order-email-terminal-failure' },
            meta: { notificationId: notification.notificationId, orderId: String(notification.order) },
            securityTags: ['order-email', 'alert', 'terminal-failure'],
        });
        return true;
    } catch (alertError) {
        logger.error('order_email.alert_send_failed', {
            notificationId: notification.notificationId,
            orderId: String(notification.order),
            alertTo: flags.orderEmailAlertTo,
            error: alertError.message,
            code: alertError.emailCode || alertError.code || 'UNKNOWN',
        });
        return false;
    }
};

const claimNextNotification = async () => OrderEmailNotification.findOneAndUpdate(
    {
        status: { $in: ['pending', 'retry'] },
        nextAttemptAt: { $lte: new Date() },
    },
    {
        $set: {
            status: 'processing',
            lastAttemptAt: new Date(),
            lockedAt: new Date(),
            lockedBy: WORKER_ID,
        },
    },
    {
        sort: { nextAttemptAt: 1, createdAt: 1 },
        new: true,
    }
);

const processNotification = async (notification) => {
    const notificationId = notification.notificationId;
    const orderId = String(notification.order);
    const nextAttempt = Number(notification.attemptCount || 0) + 1;

    try {
        const rendered = renderOrderPlacedTemplate(notification.payloadSnapshot || {});
        const sendResult = await sendTransactionalEmail({
            eventType: notification.eventType || EVENT_ORDER_PLACED,
            to: notification.recipientEmail,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            requestId: notification.requestId || notification.notificationId,
            headers: {
                'X-Aura-Notification-Id': notification.notificationId,
                'X-Aura-Event': notification.eventType,
            },
            meta: {
                notificationId: notification.notificationId,
                orderId,
                attempt: nextAttempt,
            },
            securityTags: ['order-email', 'transactional'],
        });

        const attempts = appendAttemptRecord(notification, {
            attempt: nextAttempt,
            at: new Date(),
            status: 'sent',
            providerMessageId: sendResult.providerMessageId || '',
        });

        await OrderEmailNotification.updateOne(
            { _id: notification._id },
            {
                $set: {
                    status: 'sent',
                    attemptCount: nextAttempt,
                    sentAt: new Date(),
                    providerMessageId: sendResult.providerMessageId || '',
                    providerResponse: sendResult.response || {},
                    lastErrorCode: '',
                    lastErrorMessage: '',
                    attempts,
                    lockedAt: null,
                    lockedBy: null,
                },
            }
        );
        await markOrderEmailStatus({
            orderId: notification.order,
            status: 'sent',
            sentAt: new Date(),
            notificationId: notification.notificationId,
        });

        logger.info('order_email.sent', {
            notificationId,
            orderId,
            recipient: notification.recipientEmail,
            attempt: nextAttempt,
            provider: sendResult.provider || flags.orderEmailProvider,
        });
    } catch (error) {
        const summary = classifyDeliveryError(error);
        const maxAttempts = Number(notification.maxAttempts || flags.orderEmailMaxRetries);
        const reachedMax = nextAttempt >= maxAttempts;
        const shouldRetry = !reachedMax && summary.retryable;
        const nextAttemptAt = shouldRetry
            ? new Date(Date.now() + computeRetryDelayMs(nextAttempt))
            : null;

        const status = shouldRetry ? 'retry' : 'failed';
        const attempts = appendAttemptRecord(notification, {
            attempt: nextAttempt,
            at: new Date(),
            status,
            errorCode: summary.code,
            errorMessage: summary.message.slice(0, 500),
        });

        const update = {
            status,
            attemptCount: nextAttempt,
            nextAttemptAt,
            lastErrorCode: summary.code,
            lastErrorMessage: summary.message.slice(0, 500),
            attempts,
            lockedAt: null,
            lockedBy: null,
        };

        await OrderEmailNotification.updateOne({ _id: notification._id }, { $set: update });

        if (status === 'failed') {
            const alertSent = await sendTerminalFailureAlert({ notification, errorSummary: summary });
            await OrderEmailNotification.updateOne(
                { _id: notification._id },
                { $set: { alertSent } }
            );
            await markOrderEmailStatus({
                orderId: notification.order,
                status: 'failed',
                sentAt: null,
                notificationId: notification.notificationId,
            });
        } else {
            await markOrderEmailStatus({
                orderId: notification.order,
                status: 'pending',
                sentAt: null,
                notificationId: notification.notificationId,
            });
        }

        logger.error('order_email.send_failed', {
            notificationId,
            orderId,
            recipient: notification.recipientEmail,
            attempt: nextAttempt,
            maxAttempts,
            status,
            nextAttemptAt: nextAttemptAt ? nextAttemptAt.toISOString() : null,
            errorCode: summary.code,
            error: summary.message,
        });
    }
};

const runOrderEmailQueueCycle = async () => {
    if (!flags.orderEmailsEnabled) return;

    // 1. Release stale locks
    const lockExpiry = new Date(Date.now() - 5 * 60 * 1000);
    await OrderEmailNotification.updateMany(
        { status: 'processing', lockedAt: { $lt: lockExpiry } },
        { $set: { status: 'pending', lockedAt: null, lockedBy: null } }
    );

    // 2. Fetch and process
    let processed = 0;
    while (processed < MAX_NOTIFICATIONS_PER_CYCLE) {
        const notification = await claimNextNotification();
        if (!notification) break;
        await processNotification(notification);
        processed += 1;
    }
};

const startOrderEmailWorker = () => {
    if (orderEmailWorkerTimer || !flags.orderEmailsEnabled) return;
    orderEmailWorkerTimer = setInterval(() => {
        runOrderEmailQueueCycle().catch((error) => {
            logger.error('order_email.worker_cycle_failed', { error: error.message });
        });
    }, flags.orderEmailWorkerPollMs);
};

const getOrderEmailQueueStats = async () => {
    const [pending, processing, retry, failed] = await Promise.all([
        OrderEmailNotification.countDocuments({ status: 'pending' }),
        OrderEmailNotification.countDocuments({ status: 'processing' }),
        OrderEmailNotification.countDocuments({ status: 'retry' }),
        OrderEmailNotification.countDocuments({ status: 'failed' }),
    ]);

    return {
        status: 'ok',
        pending,
        processing,
        retry,
        failed,
        workerRunning: Boolean(orderEmailWorkerTimer),
    };
};

const stopOrderEmailWorkerForTests = () => {
    if (!orderEmailWorkerTimer) return;
    clearInterval(orderEmailWorkerTimer);
    orderEmailWorkerTimer = null;
};

const listOrderEmailNotifications = async ({
    page = 1,
    limit = 20,
    status,
    orderId,
    recipient,
}) => {
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const query = {};
    if (status) query.status = status;
    if (orderId) {
        if (!mongoose.isValidObjectId(orderId)) {
            throw new AppError('orderId must be a valid identifier', 400);
        }
        query.order = orderId;
    }
    if (recipient) query.recipientEmail = { $regex: String(recipient).trim(), $options: 'i' };

    const [items, total] = await Promise.all([
        OrderEmailNotification.find(query)
            .populate('order', '_id totalPrice paymentMethod paymentState createdAt')
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Math.max(Number(limit), 1))
            .lean(),
        OrderEmailNotification.countDocuments(query),
    ]);

    return { items, total };
};

const getOrderEmailNotificationById = async (notificationId) => {
    const item = await OrderEmailNotification.findOne({ notificationId })
        .populate('order', '_id totalPrice paymentMethod paymentState createdAt')
        .populate('user', 'name email')
        .lean();
    if (!item) throw new AppError('Order email notification not found', 404);
    return item;
};

const retryOrderEmailNotification = async ({
    notificationId,
    actorUserId,
    requestId = '',
}) => {
    const notification = await OrderEmailNotification.findOne({ notificationId });
    if (!notification) throw new AppError('Order email notification not found', 404);

    if (notification.status === 'sent') {
        throw new AppError('Email has already been delivered', 409);
    }
    if (notification.status === 'processing') {
        throw new AppError('Email is currently being processed. Try again shortly.', 409);
    }
    if (!['failed', 'retry', 'pending'].includes(notification.status)) {
        throw new AppError(`Email cannot be retried from status: ${notification.status}`, 409);
    }

    notification.status = 'retry';
    notification.nextAttemptAt = new Date();
    notification.lastErrorCode = '';
    notification.lastErrorMessage = '';
    notification.adminActions = [
        ...(notification.adminActions || []),
        {
            actorUserId: String(actorUserId || ''),
            action: 'manual_retry',
            at: new Date(),
            requestId: String(requestId || ''),
        },
    ].slice(-30);

    await notification.save();
    await markOrderEmailStatus({
        orderId: notification.order,
        status: 'pending',
        sentAt: null,
        notificationId: notification.notificationId,
    });

    return notification.toObject();
};

module.exports = {
    EVENT_ORDER_PLACED,
    DEFAULT_RETRY_SCHEDULE_MINUTES,
    buildNotificationDedupeKey,
    computeRetryDelayMs,
    enqueueOrderPlacedEmail,
    runOrderEmailQueueCycle,
    startOrderEmailWorker,
    getOrderEmailQueueStats,
    stopOrderEmailWorkerForTests,
    listOrderEmailNotifications,
    getOrderEmailNotificationById,
    retryOrderEmailNotification,
};
