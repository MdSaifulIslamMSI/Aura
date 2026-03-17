const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const OrderEmailNotification = require('../models/OrderEmailNotification');
const AppError = require('../utils/AppError');
const { notifyAdminActionToUser } = require('./email/adminActionEmailService');
const { sendPersistentNotification } = require('./notificationService');
const {
    createRefundForIntent,
    scheduleRefundTask,
} = require('./payments/paymentService');
const { sendMessageToUser } = require('./socketService');

const DIGITAL_PAYMENT_METHODS = new Set(['UPI', 'CARD', 'WALLET']);

/**
 * Normalizes command center objects to ensure all arrays exist
 */
const normalizeCommandCenter = (order) => ({
    refunds: Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds : [],
    replacements: Array.isArray(order?.commandCenter?.replacements) ? order.commandCenter.replacements : [],
    supportChats: Array.isArray(order?.commandCenter?.supportChats) ? order.commandCenter.supportChats : [],
    warrantyClaims: Array.isArray(order?.commandCenter?.warrantyClaims) ? order.commandCenter.warrantyClaims : [],
    lastUpdatedAt: order?.commandCenter?.lastUpdatedAt || null,
});

/**
 * Generates a unique command ID
 */
const createCommandId = (prefix = 'cmd') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Appends a status event to the order's timeline
 */
const appendOrderStatusEvent = (order, {
    status,
    message,
    actor = 'system',
}) => {
    order.statusTimeline = Array.isArray(order.statusTimeline) ? order.statusTimeline : [];
    order.statusTimeline.push({
        status: status || order.orderStatus || 'placed',
        message: String(message || '').trim(),
        actor,
        at: new Date(),
    });
};

/**
 * Resolves an order item based on product ID or title
 */
const resolveOrderItemForCommand = (order, payload = {}) => {
    const orderItems = Array.isArray(order?.orderItems) ? order.orderItems : [];
    if (orderItems.length === 0) return null;

    const requestedProductId = payload?.itemProductId !== undefined && payload?.itemProductId !== null
        ? String(payload.itemProductId)
        : '';
    const requestedItemTitle = String(payload?.itemTitle || '').trim().toLowerCase();

    if (requestedProductId) {
        const byProductId = orderItems.find((item) => String(item?.product || item?.productId || '') === requestedProductId);
        if (byProductId) return byProductId;
    }

    if (requestedItemTitle) {
        const byTitle = orderItems.find((item) => String(item?.title || '').trim().toLowerCase() === requestedItemTitle);
        if (byTitle) return byTitle;
    }

    return orderItems[0];
};

/**
 * Notifies the order owner about an admin action
 */
const notifyOrderOwnerAdminAction = async ({
    order,
    req,
    actionKey,
    actionTitle,
    actionSummary,
    highlights = [],
}) => {
    const ownerId = order?.user?._id || order?.user;
    if (!ownerId) return;

    const targetUser = await User.findById(ownerId).select('name email').lean();
    if (!targetUser?.email) return;

    await notifyAdminActionToUser({
        targetUser: { ...targetUser, _id: ownerId },
        actorUser: req.user,
        actionKey,
        actionTitle,
        actionSummary,
        highlights,
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
    });

    try {
        await sendPersistentNotification(
            ownerId,
            actionTitle,
            actionSummary,
            'order',
            {
                relatedEntity: String(order._id || order),
                actionUrl: `/orders`
            }
        );
    } catch (err) {
        console.error(`Failed to send persistent notification for order ${order._id || order}:`, err);
    }
};

/**
 * Core logic for cancelling an order (Customer or Admin)
 */
const cancelOrderByActor = async ({
    orderId,
    actorUserId,
    actorRole = 'customer',
    cancelReasonInput = '',
}) => {
    const isAdminActor = actorRole === 'admin';
    const ownerFilter = isAdminActor ? {} : { user: actorUserId };
    const baseFilter = { _id: orderId, ...ownerFilter };
    const actorLabel = isAdminActor ? 'admin' : 'customer';
    const cancelReason = String(cancelReasonInput || '').trim() || (isAdminActor ? 'Cancelled by admin' : 'Cancelled by customer');

    const order = await Order.findOne(baseFilter);
    if (!order) {
        throw new AppError('Order not found', 404);
    }
    if (order.orderStatus === 'cancelled' || order.cancelledAt) {
        throw new AppError('Order is already cancelled', 409);
    }
    if (order.isDelivered || order.orderStatus === 'delivered') {
        throw new AppError('Delivered orders cannot be cancelled', 409);
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const txOrder = await Order.findOne(baseFilter).session(session);
        if (!txOrder) throw new AppError('Order not found', 404);
        if (txOrder.orderStatus === 'cancelled' || txOrder.cancelledAt) throw new AppError('Order is already cancelled', 409);
        if (txOrder.isDelivered || txOrder.orderStatus === 'delivered') throw new AppError('Delivered orders cannot be cancelled', 409);

        // Restore stock
        for (const item of txOrder.orderItems || []) {
            await Product.updateOne(
                { _id: item.product },
                { $inc: { stock: Number(item.quantity || 0) } }
            ).session(session);
        }

        txOrder.orderStatus = 'cancelled';
        txOrder.cancelledAt = new Date();
        txOrder.cancelReason = cancelReason;
        txOrder.commandCenter = txOrder.commandCenter || {};
        txOrder.commandCenter.lastUpdatedAt = new Date();
        appendOrderStatusEvent(txOrder, {
            status: 'cancelled',
            message: cancelReason,
            actor: actorLabel,
        });
        await txOrder.save({ session });

        await session.commitTransaction();
        session.endSession();
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw (error instanceof AppError ? error : new AppError(error.message || 'Unable to cancel order', 500));
    }

    // Handle Automatic Refund
    let refundMessage = '';
    const canAutoRefund = Boolean(order.paymentIntentId)
        && DIGITAL_PAYMENT_METHODS.has(String(order.paymentMethod || '').toUpperCase())
        && !order.refundSummary?.fullyRefunded;

    if (canAutoRefund) {
        const requestId = createCommandId('rfnd');
        const now = new Date();
        await Order.updateOne(
            { _id: order._id },
            {
                $push: {
                    'commandCenter.refunds': {
                        requestId,
                        amount: Number(order.totalPrice || 0),
                        reason: `Order cancellation: ${cancelReason}`,
                        status: 'pending',
                        message: 'Cancellation refund request created',
                        createdAt: now,
                    },
                },
                $set: { 'commandCenter.lastUpdatedAt': now },
            }
        );

        try {
            const refundResult = await createRefundForIntent({
                actorUserId,
                isAdmin: isAdminActor,
                intentId: order.paymentIntentId,
                reason: `order_cancelled:${cancelReason}`,
            });

            await Order.updateOne(
                { _id: order._id, 'commandCenter.refunds.requestId': requestId },
                {
                    $set: {
                        'commandCenter.refunds.$.status': 'processed',
                        'commandCenter.refunds.$.message': `Cancellation refund processed (${refundResult.status})`,
                        'commandCenter.refunds.$.refundId': refundResult.refundId || '',
                        'commandCenter.refunds.$.processedAt': new Date(),
                        'commandCenter.lastUpdatedAt': new Date(),
                    },
                }
            );
            refundMessage = 'Refund processed';
        } catch (error) {
            const isTransient = Number(error?.statusCode || 500) >= 500;
            if (isTransient) {
                await scheduleRefundTask({
                    intentId: order.paymentIntentId,
                    amount: Number(order.totalPrice || 0),
                    reason: `order_cancelled:${cancelReason}`,
                    orderId: order._id,
                    requestId,
                    actorUserId,
                });
            }
            await Order.updateOne(
                { _id: order._id, 'commandCenter.refunds.requestId': requestId },
                {
                    $set: {
                        'commandCenter.refunds.$.status': isTransient ? 'pending' : 'rejected',
                        'commandCenter.refunds.$.message': error.message || 'Cancellation refund failed',
                        'commandCenter.refunds.$.processedAt': new Date(),
                        'commandCenter.lastUpdatedAt': new Date(),
                    },
                }
            );
            refundMessage = isTransient ? 'Refund queued for retry' : 'Refund rejected';
        }
    }

    const updatedOrder = await Order.findById(order._id).lean();
    return { updatedOrder, refundMessage };
};

const getOrderTimelineData = async (orderId, userId) => {
    const order = await Order.findOne({ _id: orderId, user: userId }).lean();
    if (!order) {
        throw new AppError('Order not found', 404);
    }

    const [paymentIntent, paymentEvents, emailNotification] = await Promise.all([
        order.paymentIntentId
            ? PaymentIntent.findOne({ intentId: order.paymentIntentId, user: userId }).lean()
            : null,
        order.paymentIntentId
            ? PaymentEvent.find({ intentId: order.paymentIntentId }).sort({ receivedAt: 1 }).lean()
            : [],
        order.confirmationEmailNotificationId
            ? OrderEmailNotification.findOne({ notificationId: order.confirmationEmailNotificationId, user: userId }).lean()
            : OrderEmailNotification.findOne({ order: order._id, user: userId }).lean(),
    ]);

    return { order, paymentIntent, paymentEvents, emailNotification };
};

module.exports = {
    normalizeCommandCenter,
    createCommandId,
    appendOrderStatusEvent,
    resolveOrderItemForCommand,
    notifyOrderOwnerAdminAction,
    cancelOrderByActor,
    getOrderTimelineData,
    DIGITAL_PAYMENT_METHODS,
};
