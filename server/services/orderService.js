const mongoose = require('mongoose');
const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const OrderEmailNotification = require('../models/OrderEmailNotification');
const CouponRedemption = require('../models/CouponRedemption');
const AdminNotification = require('../models/AdminNotification');
const AppError = require('../utils/AppError');
const { notifyAdminActionToUser } = require('./email/adminActionEmailService');
const { sendPersistentNotification } = require('./notificationService');
const {
    createRefundForIntent,
    scheduleRefundTask,
    setTerminalCaptureFailureHandler,
} = require('./payments/paymentService');
const { reverseLoyaltyPoints } = require('./loyaltyService');
const { emitOrderEventNotification } = require('./orderNotificationService');
const { recordOrderEvent } = require('../middleware/metrics');
const { DIGITAL_METHODS } = require('./payments/constants');
const { toStoredMinorUnits } = require('./payments/moneyStorage');
const { getRefundCommandStatus } = require('./payments/refundState');

const DIGITAL_PAYMENT_METHODS = new Set(DIGITAL_METHODS);
const isRetryableTransactionError = (error) => (
    (Array.isArray(error?.errorLabels) && error.errorLabels.includes('TransientTransactionError'))
    || /please retry the operation|catalog changes|TransactionExceededLifetimeLimitSeconds|unable to acquire (?:ix|x|w) lock|write conflict|writeconflict|lock timeout|lock wait timeout/i.test(String(error?.message || ''))
);

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
const createCommandId = (prefix = 'cmd') => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

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
const resolveOrderItemForCommand = (order, payload = {}, { strict = false } = {}) => {
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

    if (strict && (requestedProductId || requestedItemTitle)) return null;
    return orderItems[0];
};

/**
 * Post-purchase policy gates shared by the command-center endpoints.
 */
const DEFAULT_RETURN_WINDOW_DAYS = 7;
const PRE_SHIPMENT_STATUSES = new Set(['placed', 'processing']);
const ACTIVE_COMMAND_REQUEST_STATUSES = new Set(['pending', 'approved']);

const getReturnWindowDays = () => {
    const parsed = Number.parseInt(String(process.env.ORDER_RETURN_WINDOW_DAYS || ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETURN_WINDOW_DAYS;
};

const isOrderDelivered = (order) => order?.isDelivered === true || String(order?.orderStatus || '') === 'delivered';

const isPreShipmentOrder = (order) => (
    !isOrderDelivered(order) && PRE_SHIPMENT_STATUSES.has(String(order?.orderStatus || ''))
);

// Delivered orders accept refund/replacement requests only inside the return
// window. Legacy orders without deliveredAt stay reviewable rather than being
// silently locked out.
const isInsideReturnWindow = (order, now = new Date()) => {
    if (!isOrderDelivered(order)) return true;
    const deliveredAt = order?.deliveredAt ? new Date(order.deliveredAt) : null;
    if (!Number.isFinite(deliveredAt?.getTime())) return true;
    return (now.getTime() - deliveredAt.getTime()) <= getReturnWindowDays() * 24 * 60 * 60 * 1000;
};

const hasActiveCommandRequest = (order, listKey) => (
    Array.isArray(order?.commandCenter?.[listKey]) ? order.commandCenter[listKey] : []
).some((entry) => ACTIVE_COMMAND_REQUEST_STATUSES.has(String(entry?.status || '').toLowerCase()));

/**
 * Reverses the commerce side effects of a cancelled order: frees the
 * one-per-user coupon redemption consumed by THIS order and claws back the
 * loyalty points captured at placement.
 */
const releaseCouponRedemptionForOrder = async ({ order, session }) => {
    const couponCode = String(order?.couponCode || '').trim().toUpperCase();
    const ownerId = order?.user?._id || order?.user;
    if (!couponCode || !ownerId) return false;
    const result = await CouponRedemption.deleteOne(
        { code: couponCode, user: ownerId, order: order._id },
        session ? { session } : {}
    );
    return Boolean(result?.deletedCount);
};

const reverseLoyaltyPointsForOrder = async ({ order, session }) => {
    const points = Number(order?.loyaltyPointsAwarded || 0);
    const ownerId = order?.user?._id || order?.user;
    if (!Number.isFinite(points) || points <= 0 || !ownerId) return 0;
    const result = await reverseLoyaltyPoints({
        userId: ownerId,
        points,
        refId: String(order._id),
        reason: 'Order cancellation clawback',
        session,
    });
    return Number(result?.reversed || 0);
};

/**
 * Retires a write-ahead refund task after the inline refund already succeeded,
 * so the outbox worker never executes it a second time.
 */
const retireRefundOutboxTask = async ({ intentId, requestId }) => {
    if (!intentId || !requestId) return;
    await PaymentOutboxTask.updateOne(
        {
            taskType: 'refund',
            intentId,
            'payload.requestId': String(requestId),
            status: { $in: ['pending', 'processing'] },
        },
        { $set: { status: 'done', lastError: '', lockedAt: null, lockedBy: null } }
    );
};

/**
 * Shipment lifecycle. The order-level orderStatus enum stays untouched;
 * granular progress (packed / out_for_delivery / returned) lives on the
 * shipment checkpoints and is projected onto the order only at the two
 * delivery-relevant moments (shipped, delivered).
 */
const MAX_SHIPMENT_CHECKPOINTS = 50;
const SHIPMENT_STATUS_TRANSITIONS = {
    pending: new Set(['packed', 'cancelled']),
    packed: new Set(['shipped', 'cancelled']),
    shipped: new Set(['out_for_delivery', 'returned', 'exception']),
    out_for_delivery: new Set(['delivered', 'exception']),
    delivered: new Set(['returned']),
    exception: new Set(['shipped', 'cancelled']),
    cancelled: new Set([]),
    returned: new Set([]),
};

const canTransitionShipmentStatus = ({ currentStatus, targetStatus }) => {
    const allowed = SHIPMENT_STATUS_TRANSITIONS[currentStatus];
    return Boolean(allowed && allowed.has(targetStatus));
};

const syncOrderFromShipmentStatus = (targetStatus) => {
    if (targetStatus === 'shipped') {
        return { orderStatus: 'shipped' };
    }
    if (targetStatus === 'delivered') {
        return { orderStatus: 'delivered', isDelivered: true, deliveredAt: new Date() };
    }
    return null;
};

const SHIPMENT_EVENT_TITLES = {
    shipped: 'Your order has shipped',
    out_for_delivery: 'Your order is out for delivery',
    delivered: 'Your order was delivered',
    returned: 'Your return was received',
    exception: 'Your delivery hit a snag',
};

/**
 * Admin dispatch: creates a shipment on the order and stamps its first
 * checkpoint. Stock is expected to have been decremented by the caller
 * (replacement dispatch does that itself; forward fulfillment ships units
 * that were decremented at placement).
 */
const dispatchOrderShipment = async ({
    orderId,
    items = [],
    courier = '',
    trackingId = '',
    initialStatus = 'shipped',
    promisedDate = null,
    requestId = '',
}) => {
    if (!['packed', 'shipped'].includes(initialStatus)) {
        throw new AppError(`Invalid initial shipment status: ${initialStatus}`, 400);
    }

    const order = await Order.findById(orderId).select('_id user orderStatus orderItems shipments couponCode statusTimeline totalPrice');
    if (!order) {
        throw new AppError('Order not found', 404);
    }
    if (order.orderStatus === 'cancelled' || order.cancelledAt) {
        throw new AppError('Cancelled orders cannot be shipped', 409);
    }

    const resolvedItems = (Array.isArray(items) && items.length > 0
        ? items
        : (order.orderItems || []).map((item) => ({
            productId: String(item.product || item.productId || ''),
            title: item.title || '',
            quantity: Number(item.quantity || 1),
        }))).map((item) => ({
        productId: String(item.productId || ''),
        title: String(item.title || ''),
        quantity: Math.max(Number(item.quantity || 1), 1),
    }));

    const now = new Date();
    const shipmentId = createCommandId('shp');
    const checkpoint = {
        status: initialStatus,
        message: initialStatus === 'shipped' ? 'Shipment dispatched' : 'Packed at warehouse',
        actor: 'admin',
        at: now,
    };

    const updatedOrder = await Order.findOneAndUpdate(
        {
            _id: order._id,
            orderStatus: { $ne: 'cancelled' },
        },
        {
            $push: {
                shipments: {
                    shipmentId,
                    items: resolvedItems,
                    courier: String(courier || '').trim(),
                    trackingId: String(trackingId || '').trim(),
                    status: initialStatus,
                    checkpoints: [checkpoint],
                    promisedDate: promisedDate || null,
                    dispatchedAt: initialStatus === 'shipped' ? now : null,
                    createdAt: now,
                },
                statusTimeline: {
                    status: initialStatus === 'shipped' ? 'shipped' : (order.orderStatus || 'placed'),
                    message: initialStatus === 'shipped'
                        ? `Shipment ${shipmentId} dispatched${courier ? ` via ${courier}` : ''}`
                        : `Shipment ${shipmentId} packed`,
                    actor: 'admin',
                    at: now,
                },
            },
            $set: {
                ...(initialStatus === 'shipped' && !['delivered'].includes(order.orderStatus)
                    ? { orderStatus: 'shipped' }
                    : {}),
                updatedAt: now,
            },
        },
        { returnDocument: 'after' }
    );

    if (!updatedOrder) {
        throw new AppError('Order state changed concurrently, retry dispatch', 409);
    }

    await emitOrderEventNotification({
        order: updatedOrder,
        eventType: initialStatus === 'shipped' ? 'order_shipped' : 'order_confirmed',
        title: initialStatus === 'shipped' ? SHIPMENT_EVENT_TITLES.shipped : 'Your order is being packed',
        message: initialStatus === 'shipped'
            ? `Your order has shipped${courier ? ` via ${courier}` : ''}.`
            : 'Your order has been packed and will ship soon.',
        trackingId,
        requestId,
    });

    return updatedOrder;
};

/**
 * Admin/courier checkpoint advance. The transition is guarded by the shipment
 * map and executed with a status precondition so two concurrent webhook or
 * admin writers cannot double-apply.
 */
const recordShipmentCheckpoint = async ({
    orderId,
    shipmentId,
    status,
    message = '',
    location = '',
    actor = 'admin',
    requestId = '',
}) => {
    if (!SHIPMENT_STATUS_TRANSITIONS[status]) {
        throw new AppError(`Unknown shipment status: ${status}`, 400);
    }

    const order = await Order.findOne(
        { _id: orderId, 'shipments.shipmentId': shipmentId },
        { _id: 1, user: 1, orderStatus: 1, shipments: { $elemMatch: { shipmentId } } }
    );
    if (!order || !Array.isArray(order.shipments) || order.shipments.length === 0) {
        throw new AppError('Shipment not found', 404);
    }

    const shipment = order.shipments[0];
    if (!canTransitionShipmentStatus({ currentStatus: shipment.status, targetStatus: status })) {
        throw new AppError(`Invalid shipment transition from ${shipment.status} to ${status}`, 409);
    }

    const now = new Date();
    const checkpoint = {
        status,
        message: String(message || '').trim(),
        location: String(location || '').trim(),
        actor,
        at: now,
    };
    const orderSync = syncOrderFromShipmentStatus(status);
    const shipmentSets = {
        'shipments.$.status': status,
        'shipments.$.updatedAt': now,
    };
    if (status === 'shipped' && !shipment.dispatchedAt) {
        shipmentSets['shipments.$.dispatchedAt'] = now;
    }
    if (status === 'delivered') {
        shipmentSets['shipments.$.deliveredAt'] = now;
    }

    const updatedOrder = await Order.findOneAndUpdate(
        {
            _id: order._id,
            orderStatus: { $ne: 'cancelled' },
            shipments: { $elemMatch: { shipmentId, status: shipment.status } },
        },
        {
            $set: {
                ...shipmentSets,
                ...(orderSync || {}),
            },
            $push: {
                'shipments.$.checkpoints': { $each: [checkpoint], $slice: -MAX_SHIPMENT_CHECKPOINTS },
                statusTimeline: {
                    status: orderSync?.orderStatus || order.orderStatus || 'placed',
                    message: message || `Shipment ${shipmentId} marked ${status.replace(/_/g, ' ')}`,
                    actor,
                    at: now,
                },
            },
        },
        { returnDocument: 'after' }
    );

    recordOrderEvent(`shipment_${status}`);
    if (!updatedOrder) {
        throw new AppError('Shipment state changed concurrently, retry checkpoint', 409);
    }

    await emitOrderEventNotification({
        order: updatedOrder,
        eventType: status === 'delivered' ? 'order_delivered' : `order_${status}`,
        title: SHIPMENT_EVENT_TITLES[status] || 'Your order has an update',
        message: message || `Your order shipment is now ${status.replace(/_/g, ' ')}.`,
        trackingId: shipment.trackingId || '',
        requestId,
    });

    return updatedOrder;
};

/**
 * Compensation for a payment capture that permanently failed in the outbox:
 * the order sits in placed/processing holding reserved stock and will never
 * be paid. Cancels with a system actor (no auto-refund — nothing was
 * captured; the provider releases the authorization), restocks, reverses
 * coupon/loyalty, notifies the customer and raises a critical admin alert.
 */
const cancelOrderForFailedCapture = async ({
    intentId,
    reason = 'Payment capture failed after retries',
    alertActionKey = 'order_capture_failed_cancelled',
    alertTitle = 'Order auto-cancelled after capture failure',
    alertSummary = '',
}) => {
    const order = await Order.findOne({
        paymentIntentId: intentId,
        orderStatus: { $in: Array.from(PRE_SHIPMENT_STATUSES) },
        cancelledAt: null,
        isDelivered: { $ne: true },
    });
    if (!order) return { handled: false, reason: 'no_cancelable_order' };

    const isTransientTxError = isRetryableTransactionError;
    const MAX_COMPENSATION_TX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_COMPENSATION_TX_ATTEMPTS; attempt += 1) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const cancelUpdate = await Order.updateOne(
                {
                    _id: order._id,
                    orderStatus: { $in: Array.from(PRE_SHIPMENT_STATUSES) },
                    cancelledAt: null,
                },
                {
                    $set: {
                        orderStatus: 'cancelled',
                        cancelledAt: new Date(),
                        cancelReason: String(reason),
                    },
                    $push: {
                        statusTimeline: {
                            status: 'cancelled',
                            message: String(reason),
                            actor: 'system',
                            at: new Date(),
                        },
                    },
                },
                { session }
            );
            if (!cancelUpdate.modifiedCount) {
                await session.abortTransaction();
                session.endSession();
                return { handled: false, reason: 'order_state_changed' };
            }

            for (const item of order.orderItems || []) {
                const restockResult = await Product.updateOne(
                    { _id: item.product },
                    { $inc: { stock: Number(item.quantity || 0) } },
                    { session }
                );
                if (Number(restockResult?.matchedCount || 0) !== 1) {
                    throw new AppError('Order item product is unavailable for restock', 409);
                }
            }

            await releaseCouponRedemptionForOrder({ order, session });
            await reverseLoyaltyPointsForOrder({ order, session });

            await session.commitTransaction();
            session.endSession();
            break;
        } catch (error) {
            await session.abortTransaction().catch(() => {});
            session.endSession();
            if (isTransientTxError(error) && attempt < MAX_COMPENSATION_TX_ATTEMPTS) {
                // Single-node replica sets (CI in-memory Mongo, catalog churn
                // from concurrent index builds) can reject every immediate
                // retry with a catalog-changes TransientTransactionError, so
                // back off briefly instead of retrying in a hot loop.
                await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
                continue;
            }
            console.error(`Capture-failure compensation failed for order ${order._id}:`, error.message);
            return { handled: false, reason: 'compensation_failed', error: error.message };
        }
    }

    try {
        await sendPersistentNotification(
            order.user,
            'Order Cancelled Automatically',
            'We could not confirm your payment, so the order was cancelled and the items were released. No money was captured.',
            'order',
            { relatedEntity: String(order._id), actionUrl: '/orders' }
        );
    } catch (notifyError) {
        console.error(`Capture-failure customer notification failed for order ${order._id}:`, notifyError.message);
    }

    try {
        await AdminNotification.create({
            notificationId: crypto.randomUUID(),
            source: 'system',
            actionKey: alertActionKey,
            title: alertTitle,
            summary: alertSummary
                || `Order ${order._id} was cancelled and restocked after capture retries were exhausted (intent ${intentId}).`,
            severity: 'critical',
            actorRole: 'system',
            entityType: 'order',
            entityId: String(order._id),
            highlights: [`Intent: ${intentId}`, `Order total: ${order.totalPrice}`],
            metadata: { intentId, orderId: String(order._id), reason },
            requestId: 'capture_failure_compensation',
        });
    } catch (alertError) {
        console.error(`Capture-failure admin alert failed for order ${order._id}:`, alertError.message);
    }

    return { handled: true, orderId: String(order._id) };
};

setTerminalCaptureFailureHandler(cancelOrderForFailedCapture);

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
    if (order.orderStatus === 'shipped') {
        throw new AppError('Shipped orders cannot be cancelled', 409);
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
        if (txOrder.orderStatus === 'shipped') throw new AppError('Shipped orders cannot be cancelled', 409);
        if (txOrder.isDelivered || txOrder.orderStatus === 'delivered') throw new AppError('Delivered orders cannot be cancelled', 409);

        // Restore stock
        for (const item of txOrder.orderItems || []) {
            const restockResult = await Product.updateOne(
                { _id: item.product },
                { $inc: { stock: Number(item.quantity || 0) } }
            ).session(session);
            if (Number(restockResult?.matchedCount || 0) !== 1) {
                throw new AppError('Order item product is unavailable for restock', 409);
            }
        }

        // Clawback: free the coupon consumed by this order and reverse the
        // loyalty points awarded at placement.
        await releaseCouponRedemptionForOrder({ order: txOrder, session });
        await reverseLoyaltyPointsForOrder({ order: txOrder, session });

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
                        amountMinor: toStoredMinorUnits(
                            Number(order.totalPrice || 0),
                            order.settlementCurrency || order.refundSummary?.settlementCurrency || 'INR'
                        ),
                        reason: `Order cancellation: ${cancelReason}`,
                        status: 'pending',
                        message: 'Cancellation refund request created',
                        createdAt: now,
                    },
                },
                $set: { 'commandCenter.lastUpdatedAt': now },
            }
        );

        // Write-ahead: the retry task exists before the provider call, so a
        // crash after the cancel commit can never strand a cancelled paid
        // order without a refund path. The task is deduped by requestId and
        // starts after 20s — long enough for the immediate attempt below to
        // retire it on success.
        try {
            await scheduleRefundTask({
                intentId: order.paymentIntentId,
                amount: Number(order.totalPrice || 0),
                reason: `order_cancelled:${cancelReason}`,
                orderId: order._id,
                requestId,
                actorUserId,
            });
        } catch (scheduleError) {
            console.error(`Write-ahead refund scheduling failed for order ${order._id}:`, scheduleError.message);
        }

        try {
            const refundResult = await createRefundForIntent({
                actorUserId,
                isAdmin: isAdminActor,
                intentId: order.paymentIntentId,
                reason: `order_cancelled:${cancelReason}`,
                requestId,
            });

            await retireRefundOutboxTask({ intentId: order.paymentIntentId, requestId });

            const refundStatus = getRefundCommandStatus(refundResult.status);
            await Order.updateOne(
                { _id: order._id, 'commandCenter.refunds.requestId': requestId },
                {
                    $set: {
                        'commandCenter.refunds.$.status': refundStatus,
                        'commandCenter.refunds.$.message': refundStatus === 'processed'
                            ? `Cancellation refund processed (${refundResult.status})`
                            : `Cancellation refund ${refundStatus} (${refundResult.status})`,
                        'commandCenter.refunds.$.refundId': refundResult.refundId || '',
                        'commandCenter.refunds.$.processedAt': refundStatus === 'processed' ? new Date() : null,
                        'commandCenter.lastUpdatedAt': new Date(),
                    },
                }
            );
            refundMessage = refundStatus === 'processed' ? 'Refund processed' : `Refund ${refundStatus}`;
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

    recordOrderEvent('cancelled');
    try {
        await emitOrderEventNotification({
            order,
            eventType: 'order_cancelled',
            title: 'Your order was cancelled',
            message: refundMessage
                ? `Your order was cancelled. ${refundMessage}.`
                : 'Your order has been cancelled and the items were released.',
        });
    } catch (notifyError) {
        console.error(`Cancellation notification failed for order ${order._id}:`, notifyError.message);
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
    getReturnWindowDays,
    isOrderDelivered,
    isPreShipmentOrder,
    isInsideReturnWindow,
    hasActiveCommandRequest,
    releaseCouponRedemptionForOrder,
    reverseLoyaltyPointsForOrder,
    cancelOrderForFailedCapture,
    canTransitionShipmentStatus,
    dispatchOrderShipment,
    recordShipmentCheckpoint,
    getOrderTimelineData,
    DIGITAL_PAYMENT_METHODS,
    isRetryableTransactionError,
};
