const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const OrderEmailNotification = require('../models/OrderEmailNotification');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    PRICING_VERSION,
    buildOrderQuote,
    normalizePaymentSimulation,
    simulatePaymentResult,
} = require('../services/orderPricingService');
const {
    validatePaymentIntentForOrder,
    linkIntentToOrder,
    scheduleCaptureTask,
    scheduleRefundTask,
    createRefundForIntent,
} = require('../services/payments/paymentService');
const {
    enqueueOrderPlacedEmail,
} = require('../services/email/orderEmailQueueService');
const { notifyAdminActionToUser } = require('../services/email/adminActionEmailService');
const { awardLoyaltyPoints } = require('../services/loyaltyService');
const {
    getRequiredIdempotencyKey,
    getStableUserKey,
    withIdempotency,
} = require('../services/payments/idempotencyService');
const { flags: paymentFlags } = require('../config/paymentFlags');
const { flags: emailFlags, EMAIL_REGEX } = require('../config/emailFlags');

const assertQuoteSnapshot = (quoteSnapshot, totalPrice) => {
    if (!quoteSnapshot || quoteSnapshot.totalPrice === undefined || quoteSnapshot.totalPrice === null) {
        return;
    }

    const provided = Number(quoteSnapshot.totalPrice);
    if (!Number.isFinite(provided)) return;

    const delta = Math.abs(provided - totalPrice);
    if (delta > 0.01) {
        throw new AppError('Quote expired. Please recalculate before placing the order.', 409);
    }
};

const toTimelineDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
};

const sortTimelineEvents = (events = []) => (
    [...events].sort((a, b) => {
        const aTime = toTimelineDate(a.at)?.getTime() || 0;
        const bTime = toTimelineDate(b.at)?.getTime() || 0;
        return aTime - bTime;
    })
);

const createCommandId = (prefix = 'cmd') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const eventSeverityFromState = (state = '') => {
    const normalized = String(state || '').toLowerCase();
    if (normalized.includes('fail') || normalized.includes('blocked')) return 'critical';
    if (normalized.includes('pending') || normalized.includes('retry') || normalized.includes('challenge')) return 'warning';
    return 'ok';
};

const getItemFromOrderForCommand = (order, payload = {}) => {
    const orderItems = Array.isArray(order?.orderItems) ? order.orderItems : [];
    if (orderItems.length === 0) {
        return { itemProductId: '', itemTitle: 'Unknown item' };
    }

    const requestedProductId = payload?.itemProductId !== undefined && payload?.itemProductId !== null
        ? String(payload.itemProductId)
        : '';
    const requestedItemTitle = String(payload?.itemTitle || '').trim();

    const exactItem = requestedProductId
        ? orderItems.find((item) => String(item?.product || item?.productId || '') === requestedProductId)
        : null;

    if (exactItem) {
        return {
            itemProductId: String(exactItem.product || exactItem.productId || ''),
            itemTitle: exactItem.title || requestedItemTitle || 'Unknown item',
        };
    }

    if (requestedItemTitle) {
        const byTitle = orderItems.find((item) =>
            String(item.title || '').toLowerCase() === requestedItemTitle.toLowerCase()
        );
        if (byTitle) {
            return {
                itemProductId: String(byTitle.product || byTitle.productId || ''),
                itemTitle: byTitle.title || requestedItemTitle,
            };
        }
    }

    const fallback = orderItems[0];
    return {
        itemProductId: String(fallback.product || fallback.productId || ''),
        itemTitle: fallback.title || requestedItemTitle || 'Unknown item',
    };
};

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

const DIGITAL_PAYMENT_METHODS = new Set(['UPI', 'CARD', 'WALLET']);

const normalizeCommandCenter = (order) => ({
    refunds: Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds : [],
    replacements: Array.isArray(order?.commandCenter?.replacements) ? order.commandCenter.replacements : [],
    supportChats: Array.isArray(order?.commandCenter?.supportChats) ? order.commandCenter.supportChats : [],
    warrantyClaims: Array.isArray(order?.commandCenter?.warrantyClaims) ? order.commandCenter.warrantyClaims : [],
    lastUpdatedAt: order?.commandCenter?.lastUpdatedAt || null,
});

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

const getCommandCenterArray = (order, key) => {
    order.commandCenter = order.commandCenter || {};
    order.commandCenter[key] = Array.isArray(order.commandCenter[key]) ? order.commandCenter[key] : [];
    return order.commandCenter[key];
};

const touchCommandCenter = (order) => {
    order.commandCenter = order.commandCenter || {};
    order.commandCenter.lastUpdatedAt = new Date();
};

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
};

const mapToDbOrderItems = (resolvedItems) => resolvedItems.map((item) => ({
    title: item.title,
    quantity: item.quantity,
    image: item.image,
    price: item.price,
    product: item.mongoProductId,
}));

const decrementStockAtomically = async (resolvedItems, session) => {
    for (const item of resolvedItems) {
        const update = await Product.updateOne(
            { id: item.productId, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } }
        ).session(session);

        if (update.modifiedCount !== 1) {
            throw new AppError(`Unable to reserve stock for product ${item.productId}`, 409);
        }
    }
};

// @desc    Quote order pricing
// @route   POST /api/orders/quote
// @access  Private
const quoteOrder = asyncHandler(async (req, res, next) => {
    try {
        const quote = await buildOrderQuote(req.body, { checkStock: true });
        res.json({
            itemsPrice: quote.pricing.itemsPrice,
            couponDiscount: quote.pricing.couponDiscount,
            paymentAdjustment: quote.pricing.paymentAdjustment,
            shippingPrice: quote.pricing.shippingPrice,
            taxPrice: quote.pricing.taxPrice,
            totalPrice: quote.pricing.totalPrice,
            appliedCoupon: quote.pricing.appliedCoupon,
            deliveryEstimate: quote.pricing.deliveryEstimate,
            priceBreakdown: quote.pricing.priceBreakdown,
            pricingVersion: PRICING_VERSION,
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to quote order', 500));
    }
});

// @desc    Simulate digital payment result
// @route   POST /api/orders/simulate-payment
// @access  Private
const simulatePayment = asyncHandler(async (req, res, next) => {
    try {
        if (paymentFlags.paymentProvider !== 'simulated' && paymentFlags.nodeEnv === 'production') {
            return next(new AppError('Simulation is disabled in production payment mode', 403));
        }
        const result = simulatePaymentResult(req.body);
        res.json(result);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Payment simulation failed', 500));
    }
});

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const addOrderItems = asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
        return next(new AppError('User not found / Not authorized', 401));
    }

    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: 'orders:create',
            requestPayload: req.body,
            handler: async () => {
                if (emailFlags.orderEmailsEnabled && !EMAIL_REGEX.test(String(req.user?.email || '').trim())) {
                    throw new AppError('A valid account email is required to place order', 400);
                }

                const session = await mongoose.startSession();
                session.startTransaction();

                try {
                    const quote = await buildOrderQuote(req.body, { session, checkStock: true });
                    assertQuoteSnapshot(req.body.quoteSnapshot, quote.pricing.totalPrice);

                    const paymentValidation = await validatePaymentIntentForOrder({
                        userId,
                        paymentIntentId: req.body.paymentIntentId,
                        paymentMethod: quote.normalized.paymentMethod,
                        totalPrice: quote.pricing.totalPrice,
                        paymentSimulation: normalizePaymentSimulation(req.body.paymentSimulation || {}),
                        session,
                        claimForOrder: true,
                        claimKey: idempotencyKey,
                    });

                    await decrementStockAtomically(quote.resolvedItems, session);

                    const paymentIntent = paymentValidation.paymentIntent;
                    const order = new Order({
                        user: userId,
                        orderItems: mapToDbOrderItems(quote.resolvedItems),
                        shippingAddress: quote.normalized.shippingAddress,
                        paymentMethod: quote.normalized.paymentMethod,
                        itemsPrice: quote.pricing.itemsPrice,
                        taxPrice: quote.pricing.taxPrice,
                        shippingPrice: quote.pricing.shippingPrice,
                        totalPrice: quote.pricing.totalPrice,
                        couponCode: quote.normalized.couponCode || '',
                        couponDiscount: quote.pricing.couponDiscount,
                        paymentAdjustment: quote.pricing.paymentAdjustment,
                        deliveryOption: quote.normalized.deliveryOption,
                        deliverySlot: quote.normalized.deliverySlot || undefined,
                        checkoutSource: quote.normalized.checkoutSource,
                        pricingVersion: quote.pricing.pricingVersion || PRICING_VERSION,
                        priceBreakdown: quote.pricing.priceBreakdown,
                        paymentIntentId: paymentIntent?.intentId || req.body.paymentIntentId || '',
                        paymentProvider: paymentIntent?.provider || (paymentFlags.paymentProvider === 'simulated' ? 'simulated' : ''),
                        paymentState: paymentValidation.paymentState,
                        paymentAuthorizedAt: paymentIntent?.authorizedAt || null,
                        paymentCapturedAt: paymentIntent?.capturedAt || null,
                        riskSnapshot: paymentIntent?.riskSnapshot || {},
                        statusTimeline: [{
                            status: 'placed',
                            message: 'Order created',
                            actor: 'system',
                            at: new Date(),
                        }],
                        paymentResult: paymentIntent
                            ? {
                                id: paymentIntent.providerPaymentId || '',
                                status: paymentIntent.status,
                                update_time: new Date().toISOString(),
                                email_address: req.user.email || '',
                            }
                            : req.body.paymentSimulation
                                ? {
                                    id: req.body.paymentSimulation.referenceId || '',
                                    status: req.body.paymentSimulation.status,
                                    update_time: new Date().toISOString(),
                                    email_address: req.user.email || '',
                                }
                                : undefined,
                        isPaid: paymentValidation.isPaid,
                        paidAt: paymentValidation.isPaid ? new Date() : undefined,
                        orderStatus: 'placed',
                    });

                    const createdOrder = await order.save({ session });
                    if (paymentIntent?.intentId) {
                        await linkIntentToOrder({
                            intentId: paymentIntent.intentId,
                            orderId: createdOrder._id,
                            session,
                            claimKey: paymentValidation.claimKey || idempotencyKey,
                        });
                    }

                    try {
                        await awardLoyaltyPoints({
                            userId,
                            action: 'order_placed',
                            orderTotal: quote.pricing.totalPrice,
                            refId: String(createdOrder._id),
                            session,
                        });
                    } catch (rewardError) {
                        logger.warn('loyalty.order_reward_failed', {
                            requestId: req.requestId,
                            userId: String(userId),
                            orderId: String(createdOrder._id),
                            error: rewardError.message,
                        });
                    }

                    if (emailFlags.orderEmailsEnabled) {
                        const notification = await enqueueOrderPlacedEmail({
                            order: createdOrder,
                            user: req.user,
                            requestId: req.requestId,
                            session,
                        });

                        if (notification?.notificationId) {
                            createdOrder.confirmationEmailStatus = 'pending';
                            createdOrder.confirmationEmailNotificationId = notification.notificationId;
                            createdOrder.confirmationEmailSentAt = null;
                            await createdOrder.save({ session });
                        }
                    } else {
                        createdOrder.confirmationEmailStatus = 'skipped';
                        createdOrder.confirmationEmailNotificationId = '';
                        createdOrder.confirmationEmailSentAt = null;
                        await createdOrder.save({ session });
                    }

                    if (quote.normalized.checkoutSource !== 'directBuy') {
                        await User.updateOne(
                            { _id: userId },
                            { $set: { cart: [] } }
                        ).session(session);
                    }

                    if (paymentIntent?.intentId && paymentIntent.status === 'authorized') {
                        await scheduleCaptureTask({ intentId: paymentIntent.intentId, session });
                    }

                    await session.commitTransaction();
                    session.endSession();

                    return { statusCode: 201, response: createdOrder };
                } catch (innerError) {
                    await session.abortTransaction();
                    session.endSession();
                    logger.error('order.create_failed', {
                        requestId: req.requestId,
                        userId: String(userId),
                        error: innerError.message,
                    });
                    throw innerError;
                }
            },
        });

        res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) {
            return next(error);
        }

        return next(new AppError(error.message || 'Order creation failed', 500));
    }
});

// @desc    Get trust timeline for a specific order
// @route   GET /api/orders/:id/timeline
// @access  Private
const getMyOrderTimeline = asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;
    const orderId = req.params.id;

    const order = await Order.findOne({ _id: orderId, user: userId }).lean();
    if (!order) {
        return next(new AppError('Order not found', 404));
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

    const timeline = [];
    const pushEvent = (event) => {
        const at = toTimelineDate(event?.at);
        if (!at) return;
        timeline.push({
            at,
            stage: event.stage || 'system',
            type: event.type || 'info',
            title: event.title || 'Event',
            detail: event.detail || '',
            severity: event.severity || 'ok',
            meta: event.meta || {},
        });
    };

    pushEvent({
        at: order.createdAt,
        stage: 'order',
        type: 'order_created',
        title: 'Order Placed',
        detail: `Order created with ${order.orderItems?.length || 0} item(s).`,
        severity: 'ok',
    });

    pushEvent({
        at: order.createdAt,
        stage: 'payment',
        type: 'payment_method_selected',
        title: 'Payment Method Selected',
        detail: order.paymentMethod || 'Unknown payment method',
        severity: 'ok',
    });

    if (order.paymentAuthorizedAt) {
        pushEvent({
            at: order.paymentAuthorizedAt,
            stage: 'payment',
            type: 'payment_authorized',
            title: 'Payment Authorized',
            detail: order.paymentProvider ? `Provider: ${order.paymentProvider}` : 'Authorization accepted',
            severity: 'ok',
        });
    }

    if (order.paymentCapturedAt) {
        pushEvent({
            at: order.paymentCapturedAt,
            stage: 'payment',
            type: 'payment_captured',
            title: 'Payment Captured',
            detail: 'Amount capture confirmed by provider.',
            severity: 'ok',
        });
    }

    if (order.paymentState && ['failed', 'expired'].includes(String(order.paymentState).toLowerCase())) {
        pushEvent({
            at: order.updatedAt || order.createdAt,
            stage: 'payment',
            type: 'payment_failed',
            title: 'Payment Issue Detected',
            detail: `Payment state: ${order.paymentState}`,
            severity: 'critical',
        });
    }

    if (order.isPaid && order.paidAt) {
        pushEvent({
            at: order.paidAt,
            stage: 'payment',
            type: 'payment_confirmed',
            title: 'Payment Confirmed',
            detail: 'Order marked as paid.',
            severity: 'ok',
        });
    }

    if (paymentIntent) {
        pushEvent({
            at: paymentIntent.createdAt,
            stage: 'risk',
            type: 'risk_evaluated',
            title: 'Risk Evaluation Complete',
            detail: `Decision: ${paymentIntent.riskSnapshot?.decision || 'allow'} (${paymentIntent.riskSnapshot?.score ?? 0})`,
            severity: eventSeverityFromState(paymentIntent.riskSnapshot?.decision || 'allow'),
            meta: {
                decision: paymentIntent.riskSnapshot?.decision || 'allow',
                score: paymentIntent.riskSnapshot?.score ?? 0,
                factors: paymentIntent.riskSnapshot?.factors || [],
            },
        });

        if (paymentIntent.challenge?.required) {
            pushEvent({
                at: paymentIntent.createdAt,
                stage: 'risk',
                type: 'risk_challenge_required',
                title: 'Security Challenge Required',
                detail: `Challenge status: ${paymentIntent.challenge?.status || 'pending'}`,
                severity: eventSeverityFromState(paymentIntent.challenge?.status || 'pending'),
            });

            if (paymentIntent.challenge?.verifiedAt) {
                pushEvent({
                    at: paymentIntent.challenge.verifiedAt,
                    stage: 'risk',
                    type: 'risk_challenge_verified',
                    title: 'Security Challenge Verified',
                    detail: 'Challenge verification completed successfully.',
                    severity: 'ok',
                });
            }
        }
    }

    paymentEvents.forEach((event) => {
        pushEvent({
            at: event.receivedAt || event.createdAt,
            stage: 'payment',
            type: event.type || 'payment_event',
            title: `Gateway Event: ${event.type || 'unknown'}`,
            detail: `Source: ${event.source || 'system'}`,
            severity: eventSeverityFromState(event.type || ''),
            meta: {
                source: event.source || 'system',
                eventId: event.eventId || '',
            },
        });
    });

    if (emailNotification) {
        pushEvent({
            at: emailNotification.createdAt,
            stage: 'email',
            type: 'email_queued',
            title: 'Order Email Queued',
            detail: `Recipient: ${emailNotification.recipientEmail}`,
            severity: eventSeverityFromState(emailNotification.status || 'pending'),
        });

        (emailNotification.attempts || []).forEach((attempt) => {
            pushEvent({
                at: attempt.at,
                stage: 'email',
                type: `email_attempt_${attempt.status}`,
                title: `Email Attempt #${attempt.attempt}`,
                detail: attempt.errorMessage || `Status: ${attempt.status}`,
                severity: eventSeverityFromState(attempt.status || ''),
            });
        });

        if (emailNotification.sentAt) {
            pushEvent({
                at: emailNotification.sentAt,
                stage: 'email',
                type: 'email_sent',
                title: 'Order Email Delivered',
                detail: 'Confirmation email sent successfully.',
                severity: 'ok',
            });
        } else if (emailNotification.status === 'failed') {
            pushEvent({
                at: emailNotification.lastAttemptAt || emailNotification.updatedAt,
                stage: 'email',
                type: 'email_failed',
                title: 'Email Delivery Failed',
                detail: emailNotification.lastErrorMessage || 'Notification delivery reached terminal failure.',
                severity: 'critical',
            });
        }
    }

    if (order.isDelivered && order.deliveredAt) {
        pushEvent({
            at: order.deliveredAt,
            stage: 'delivery',
            type: 'order_delivered',
            title: 'Order Delivered',
            detail: 'Delivery marked as complete.',
            severity: 'ok',
        });
    }

    if (order.orderStatus === 'cancelled' || order.cancelledAt) {
        pushEvent({
            at: order.cancelledAt || order.updatedAt || order.createdAt,
            stage: 'order',
            type: 'order_cancelled',
            title: 'Order Cancelled',
            detail: order.cancelReason || 'Order was cancelled by customer.',
            severity: 'warning',
        });
    }

    (Array.isArray(order.statusTimeline) ? order.statusTimeline : []).forEach((statusEvent) => {
        pushEvent({
            at: statusEvent.at || order.updatedAt || order.createdAt,
            stage: 'status',
            type: `status_${statusEvent.status || 'updated'}`,
            title: `Status: ${(statusEvent.status || 'updated').toUpperCase()}`,
            detail: statusEvent.message || '',
            severity: eventSeverityFromState(statusEvent.status || ''),
            meta: {
                actor: statusEvent.actor || 'system',
            },
        });
    });

    const commandCenter = normalizeCommandCenter(order);
    commandCenter.refunds.forEach((refund) => {
        pushEvent({
            at: refund.processedAt || refund.createdAt,
            stage: 'command_center',
            type: 'command_refund',
            title: `Refund ${refund.status || 'pending'}`,
            detail: refund.message || refund.reason || 'Refund workflow updated',
            severity: eventSeverityFromState(refund.status || 'pending'),
        });
    });
    commandCenter.replacements.forEach((replacement) => {
        pushEvent({
            at: replacement.processedAt || replacement.createdAt,
            stage: 'command_center',
            type: 'command_replacement',
            title: `Replacement ${replacement.status || 'pending'}`,
            detail: replacement.message || replacement.reason || 'Replacement workflow updated',
            severity: eventSeverityFromState(replacement.status || 'pending'),
        });
    });
    commandCenter.supportChats.forEach((chat) => {
        pushEvent({
            at: chat.createdAt,
            stage: 'command_center',
            type: 'command_support',
            title: `Support ${chat.actor || 'message'}`,
            detail: String(chat.message || '').slice(0, 220) || 'Support thread updated',
            severity: 'ok',
        });
    });
    commandCenter.warrantyClaims.forEach((claim) => {
        pushEvent({
            at: claim.processedAt || claim.createdAt,
            stage: 'command_center',
            type: 'command_warranty',
            title: `Warranty ${claim.status || 'pending'}`,
            detail: claim.resolutionNote || claim.issue || 'Warranty workflow updated',
            severity: eventSeverityFromState(claim.status || 'pending'),
        });
    });

    res.json({
        orderId: String(order._id),
        summary: {
            paymentMethod: order.paymentMethod,
            paymentState: order.paymentState,
            isPaid: order.isPaid,
            isDelivered: order.isDelivered,
            orderStatus: order.orderStatus || 'placed',
            emailStatus: order.confirmationEmailStatus || 'pending',
            totalPrice: order.totalPrice,
        },
        timeline: sortTimelineEvents(timeline),
    });
});

// @desc    Get post-purchase command center state for an order
// @route   GET /api/orders/:id/command-center
// @access  Private
const getMyOrderCommandCenter = asyncHandler(async (req, res, next) => {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const commandCenter = normalizeCommandCenter(order);
    res.json({
        orderId: String(order._id),
        paymentState: order.paymentState || 'pending',
        isDelivered: Boolean(order.isDelivered),
        summary: {
            totalPrice: Number(order.totalPrice || 0),
            items: Array.isArray(order.orderItems) ? order.orderItems.length : 0,
            deliveryOption: order.deliveryOption || 'standard',
        },
        actionAvailability: {
            canRequestRefund: !order.refundSummary?.fullyRefunded,
            canRequestReplacement: order.orderStatus !== 'cancelled',
            canOpenWarrantyClaim: true,
            canOpenSupportChat: true,
            canCancelOrder: !order.isDelivered && order.orderStatus !== 'cancelled',
        },
        commandCenter,
    });
});

// @desc    Create refund request in command center
// @route   POST /api/orders/:id/command-center/refund
// @access  Private
const createOrderRefundRequest = asyncHandler(async (req, res, next) => {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const requestedAmount = Number(req.body.amount);
    const amount = Number.isFinite(requestedAmount) && requestedAmount > 0
        ? requestedAmount
        : Number(order.totalPrice || 0);

    if (amount <= 0) {
        return next(new AppError('Invalid refund amount', 400));
    }

    const requestId = createCommandId('rfnd');
    const now = new Date();
    const reason = String(req.body.reason || '').trim();

    await Order.updateOne(
        { _id: order._id, user: req.user._id },
        {
            $push: {
                'commandCenter.refunds': {
                    requestId,
                    amount,
                    reason,
                    status: 'pending',
                    message: 'Refund request received',
                    createdAt: now,
                },
            },
            $set: { 'commandCenter.lastUpdatedAt': now },
        }
    );

    let message = 'Refund request submitted';
    const canProcessAutomatically = Boolean(order.paymentIntentId) && DIGITAL_PAYMENT_METHODS.has(String(order.paymentMethod || '').toUpperCase());

    if (canProcessAutomatically) {
        try {
            const refundResult = await createRefundForIntent({
                actorUserId: req.user._id,
                isAdmin: false,
                intentId: order.paymentIntentId,
                amount,
                reason,
            });

            await Order.updateOne(
                { _id: order._id, user: req.user._id, 'commandCenter.refunds.requestId': requestId },
                {
                    $set: {
                        'commandCenter.refunds.$.status': 'processed',
                        'commandCenter.refunds.$.message': `Refund processed (${refundResult.status})`,
                        'commandCenter.refunds.$.refundId': refundResult.refundId || '',
                        'commandCenter.refunds.$.processedAt': new Date(),
                        'commandCenter.lastUpdatedAt': new Date(),
                    },
                }
            );
            message = 'Refund processed successfully';
        } catch (error) {
            const isTransient = Number(error?.statusCode || 500) >= 500;
            if (isTransient) {
                await scheduleRefundTask({
                    intentId: order.paymentIntentId,
                    amount,
                    reason,
                    orderId: order._id,
                    requestId,
                    actorUserId: req.user._id,
                });
            }
            await Order.updateOne(
                { _id: order._id, user: req.user._id, 'commandCenter.refunds.requestId': requestId },
                {
                    $set: {
                        'commandCenter.refunds.$.status': isTransient ? 'pending' : 'rejected',
                        'commandCenter.refunds.$.message': error.message || 'Automatic refund failed',
                        'commandCenter.refunds.$.processedAt': new Date(),
                        'commandCenter.lastUpdatedAt': new Date(),
                    },
                }
            );
            message = isTransient
                ? 'Refund queued for retry due to provider issue'
                : 'Refund request rejected';
        }
    }

    const updatedOrder = await Order.findById(order._id).lean();
    res.status(201).json({
        success: true,
        message,
        commandCenter: normalizeCommandCenter(updatedOrder),
        refundSummary: updatedOrder?.refundSummary || null,
    });
});

// @desc    Create replacement request in command center
// @route   POST /api/orders/:id/command-center/replace
// @access  Private
const createOrderReplacementRequest = asyncHandler(async (req, res, next) => {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) {
        return next(new AppError('Order not found', 404));
    }
    if (order.orderStatus === 'cancelled' || order.cancelledAt) {
        return next(new AppError('Cancelled orders cannot be replaced', 409));
    }

    const targetOrderItem = resolveOrderItemForCommand(order, req.body);
    if (!targetOrderItem) {
        return next(new AppError('No order item found for replacement', 400));
    }

    const activeReplacementExists = (order.commandCenter?.replacements || []).some((replacement) => {
        const sameProduct = String(replacement.itemProductId || '') === String(targetOrderItem.product || '');
        const active = ['pending', 'approved', 'shipped'].includes(String(replacement.status || '').toLowerCase());
        return sameProduct && active;
    });
    if (activeReplacementExists) {
        return next(new AppError('An active replacement request already exists for this item', 409));
    }

    const requestedQuantity = Number(req.body.quantity);
    const quantity = Number.isFinite(requestedQuantity) && requestedQuantity > 0
        ? Math.min(Math.floor(requestedQuantity), Number(targetOrderItem.quantity || 1))
        : 1;

    const itemProductId = String(targetOrderItem.product || targetOrderItem.productId || '');
    const itemTitle = targetOrderItem.title || String(req.body.itemTitle || '').trim() || 'Unknown item';

    let status = 'pending';
    let message = 'Replacement request created. Awaiting stock allocation.';
    let trackingId = '';
    let processedAt = null;

    const stockUpdate = await Product.findOneAndUpdate(
        { _id: targetOrderItem.product, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: true }
    );

    if (stockUpdate) {
        status = 'shipped';
        trackingId = createCommandId('trk');
        processedAt = new Date();
        message = 'Replacement approved and dispatched.';
    }

    order.commandCenter = order.commandCenter || {};
    order.commandCenter.replacements = Array.isArray(order.commandCenter.replacements) ? order.commandCenter.replacements : [];
    order.commandCenter.replacements.push({
        requestId: createCommandId('rplc'),
        reason: String(req.body.reason || '').trim(),
        itemProductId,
        itemTitle,
        quantity,
        status,
        message,
        trackingId,
        createdAt: new Date(),
        processedAt,
    });
    order.commandCenter.lastUpdatedAt = new Date();
    if (status === 'shipped' && order.orderStatus !== 'cancelled') {
        order.orderStatus = 'processing';
        order.statusTimeline = Array.isArray(order.statusTimeline) ? order.statusTimeline : [];
        order.statusTimeline.push({
            status: 'processing',
            message: `Replacement dispatched for ${itemTitle}`,
            actor: 'system',
            at: new Date(),
        });
    }
    await order.save();

    res.status(201).json({
        success: true,
        message,
        commandCenter: normalizeCommandCenter(order),
    });
});

// @desc    Post customer support message in command center
// @route   POST /api/orders/:id/command-center/support
// @access  Private
const createOrderSupportMessage = asyncHandler(async (req, res, next) => {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    order.commandCenter = order.commandCenter || {};
    order.commandCenter.supportChats = Array.isArray(order.commandCenter.supportChats) ? order.commandCenter.supportChats : [];
    order.commandCenter.supportChats.push({
        messageId: createCommandId('msg'),
        actor: 'customer',
        message: String(req.body.message || '').trim(),
        createdAt: new Date(),
    });
    order.commandCenter.lastUpdatedAt = new Date();
    await order.save();

    res.status(201).json({
        success: true,
        message: 'Support message sent',
        commandCenter: normalizeCommandCenter(order),
    });
});

// @desc    Create warranty claim in command center
// @route   POST /api/orders/:id/command-center/warranty
// @access  Private
const createOrderWarrantyClaim = asyncHandler(async (req, res, next) => {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const { itemProductId, itemTitle } = getItemFromOrderForCommand(order, req.body);

    order.commandCenter = order.commandCenter || {};
    order.commandCenter.warrantyClaims = Array.isArray(order.commandCenter.warrantyClaims) ? order.commandCenter.warrantyClaims : [];
    order.commandCenter.warrantyClaims.push({
        claimId: createCommandId('wrnty'),
        issue: String(req.body.issue || '').trim(),
        itemProductId,
        itemTitle,
        status: 'pending',
        createdAt: new Date(),
    });
    order.commandCenter.lastUpdatedAt = new Date();
    await order.save();

    res.status(201).json({
        success: true,
        message: 'Warranty claim submitted',
        commandCenter: normalizeCommandCenter(order),
    });
});

// @desc    Process refund request from command center (admin)
// @route   PATCH /api/orders/:id/command-center/refund/:requestId/admin
// @access  Private/Admin
const processOrderRefundRequestAdmin = asyncHandler(async (req, res, next) => {
    const order = await Order.findById(req.params.id);
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const refunds = getCommandCenterArray(order, 'refunds');
    const requestId = String(req.params.requestId || '').trim();
    const refundIndex = refunds.findIndex((entry) => String(entry?.requestId || '') === requestId);
    if (refundIndex < 0) {
        return next(new AppError('Refund request not found', 404));
    }

    const refund = refunds[refundIndex];
    const previousStatus = String(refund.status || 'pending').toLowerCase();
    if (['processed', 'rejected'].includes(previousStatus)) {
        return next(new AppError(`Refund request already ${previousStatus}`, 409));
    }

    const requestedStatus = String(req.body.status || '').trim().toLowerCase();
    const note = String(req.body.note || '').trim();
    const externalReference = String(req.body.externalReference || '').trim();
    const requestedAmount = Number(req.body.amount);
    const amount = Number.isFinite(requestedAmount) && requestedAmount > 0
        ? requestedAmount
        : Number(refund.amount || order.totalPrice || 0);

    if (amount <= 0) {
        return next(new AppError('Invalid refund amount', 400));
    }

    let finalStatus = requestedStatus;
    let finalMessage = note || 'Refund request updated by admin';
    let finalRefundId = String(refund.refundId || externalReference || '');
    let processedAt = null;
    const reasonForProvider = note || String(refund.reason || '').trim() || 'admin_refund_review';

    if (requestedStatus === 'rejected') {
        finalStatus = 'rejected';
        finalMessage = note || 'Refund request rejected by admin review';
        processedAt = new Date();
    } else if (Boolean(order.paymentIntentId) && DIGITAL_PAYMENT_METHODS.has(String(order.paymentMethod || '').toUpperCase())) {
        try {
            const refundResult = await createRefundForIntent({
                actorUserId: req.user._id,
                isAdmin: true,
                intentId: order.paymentIntentId,
                amount,
                reason: reasonForProvider,
            });

            finalStatus = 'processed';
            finalRefundId = String(refundResult?.refundId || finalRefundId || '');
            finalMessage = note || `Refund processed via payment provider (${refundResult?.status || 'processed'})`;
            processedAt = new Date();
        } catch (error) {
            const isTransient = Number(error?.statusCode || 500) >= 500;
            if (isTransient && order.paymentIntentId) {
                await scheduleRefundTask({
                    intentId: order.paymentIntentId,
                    amount,
                    reason: reasonForProvider,
                    orderId: order._id,
                    requestId,
                    actorUserId: req.user._id,
                });
            }
            finalStatus = isTransient ? 'pending' : 'rejected';
            finalMessage = error.message || 'Provider refund failed';
            if (!isTransient) {
                processedAt = new Date();
            }
        }
    } else {
        finalStatus = requestedStatus === 'processed' ? 'processed' : 'approved';
        finalMessage = note || (
            finalStatus === 'processed'
                ? 'Manual refund marked completed by admin'
                : 'Refund approved for manual bank transfer'
        );
        if (externalReference) {
            finalRefundId = externalReference;
        }
        if (finalStatus === 'processed') {
            processedAt = new Date();
            const refundSummary = order.refundSummary || { totalRefunded: 0, fullyRefunded: false, refunds: [] };
            refundSummary.refunds = Array.isArray(refundSummary.refunds) ? refundSummary.refunds : [];
            refundSummary.refunds.push({
                refundId: finalRefundId || createCommandId('manual-rfnd'),
                amount,
                reason: reasonForProvider,
                status: 'processed',
                createdAt: new Date(),
            });
            refundSummary.totalRefunded = Number(refundSummary.totalRefunded || 0) + amount;
            refundSummary.fullyRefunded = refundSummary.totalRefunded >= Number(order.totalPrice || 0) - 0.01;
            order.refundSummary = refundSummary;
        }
    }

    refund.status = finalStatus;
    refund.amount = amount;
    refund.message = finalMessage;
    refund.refundId = finalRefundId;
    refund.adminNote = note;
    refund.updatedAt = new Date();
    if (processedAt) {
        refund.processedAt = processedAt;
    }

    touchCommandCenter(order);
    appendOrderStatusEvent(order, {
        status: order.orderStatus || 'placed',
        message: `Admin set refund request ${requestId} to ${finalStatus}`,
        actor: 'admin',
    });
    order.markModified('commandCenter');
    await order.save();

    await notifyOrderOwnerAdminAction({
        order,
        req,
        actionKey: 'admin.order.refund_request',
        actionTitle: 'Refund Request Updated by Admin',
        actionSummary: 'An administrator processed your refund workflow update.',
        highlights: [
            `Order ID: ${String(order._id)}`,
            `Request ID: ${requestId}`,
            `Previous status: ${previousStatus}`,
            `Current status: ${finalStatus}`,
            `Refund amount: ${amount} INR`,
            `Reference: ${finalRefundId || 'pending'}`,
            `Admin note: ${note || 'No note provided'}`,
        ],
    });

    return res.json({
        success: true,
        message: finalMessage,
        commandCenter: normalizeCommandCenter(order),
        refundSummary: order.refundSummary || null,
    });
});

// @desc    Process replacement request from command center (admin)
// @route   PATCH /api/orders/:id/command-center/replace/:requestId/admin
// @access  Private/Admin
const processOrderReplacementRequestAdmin = asyncHandler(async (req, res, next) => {
    const order = await Order.findById(req.params.id);
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const replacements = getCommandCenterArray(order, 'replacements');
    const requestId = String(req.params.requestId || '').trim();
    const replacementIndex = replacements.findIndex((entry) => String(entry?.requestId || '') === requestId);
    if (replacementIndex < 0) {
        return next(new AppError('Replacement request not found', 404));
    }

    const replacement = replacements[replacementIndex];
    const previousStatus = String(replacement.status || 'pending').toLowerCase();
    if (['rejected', 'shipped'].includes(previousStatus)) {
        return next(new AppError(`Replacement request already ${previousStatus}`, 409));
    }

    const nextStatus = String(req.body.status || '').trim().toLowerCase();
    const note = String(req.body.note || '').trim();
    const providedTrackingId = String(req.body.trackingId || '').trim();
    const quantity = Math.max(Number(replacement.quantity || 1), 1);
    const itemProductId = String(replacement.itemProductId || '');

    let finalStatus = nextStatus;
    let message = note || 'Replacement request updated by admin';
    let trackingId = String(replacement.trackingId || '');
    let processedAt = null;

    if (nextStatus === 'rejected') {
        finalStatus = 'rejected';
        message = note || 'Replacement request rejected by admin';
        processedAt = new Date();
    } else if (nextStatus === 'approved') {
        finalStatus = 'approved';
        message = note || 'Replacement request approved by admin';
    } else {
        if (!itemProductId) {
            return next(new AppError('Replacement item reference is missing', 409));
        }

        const stockReserved = await Product.findOneAndUpdate(
            { _id: itemProductId, stock: { $gte: quantity } },
            { $inc: { stock: -quantity } },
            { new: true }
        );

        if (!stockReserved) {
            return next(new AppError('Insufficient stock to dispatch replacement', 409));
        }

        finalStatus = 'shipped';
        trackingId = providedTrackingId || trackingId || createCommandId('trk');
        message = note || 'Replacement dispatched by admin';
        processedAt = new Date();
    }

    replacement.status = finalStatus;
    replacement.message = message;
    replacement.adminNote = note;
    replacement.updatedAt = new Date();
    if (trackingId) {
        replacement.trackingId = trackingId;
    }
    if (processedAt) {
        replacement.processedAt = processedAt;
    }

    if (finalStatus === 'shipped' && order.orderStatus !== 'cancelled' && order.orderStatus !== 'delivered') {
        order.orderStatus = 'processing';
    }

    touchCommandCenter(order);
    appendOrderStatusEvent(order, {
        status: order.orderStatus || 'placed',
        message: `Admin set replacement request ${requestId} to ${finalStatus}`,
        actor: 'admin',
    });
    order.markModified('commandCenter');
    await order.save();

    await notifyOrderOwnerAdminAction({
        order,
        req,
        actionKey: 'admin.order.replacement_request',
        actionTitle: 'Replacement Request Updated by Admin',
        actionSummary: 'An administrator updated your replacement workflow.',
        highlights: [
            `Order ID: ${String(order._id)}`,
            `Request ID: ${requestId}`,
            `Previous status: ${previousStatus}`,
            `Current status: ${finalStatus}`,
            `Tracking ID: ${trackingId || 'pending'}`,
            `Admin note: ${note || 'No note provided'}`,
        ],
    });

    return res.json({
        success: true,
        message,
        commandCenter: normalizeCommandCenter(order),
    });
});

// @desc    Reply to support thread in command center (admin)
// @route   POST /api/orders/:id/command-center/support/admin-reply
// @access  Private/Admin
const replyOrderSupportMessageAdmin = asyncHandler(async (req, res, next) => {
    const order = await Order.findById(req.params.id);
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const replyMessage = String(req.body.message || '').trim();
    const supportChats = getCommandCenterArray(order, 'supportChats');
    supportChats.push({
        messageId: createCommandId('sup'),
        actor: 'support',
        message: replyMessage,
        createdAt: new Date(),
    });

    touchCommandCenter(order);
    appendOrderStatusEvent(order, {
        status: order.orderStatus || 'placed',
        message: 'Admin support replied to customer',
        actor: 'admin',
    });
    order.markModified('commandCenter');
    await order.save();

    await notifyOrderOwnerAdminAction({
        order,
        req,
        actionKey: 'admin.order.support_reply',
        actionTitle: 'Support Reply from Admin Team',
        actionSummary: 'The support team replied to your order conversation.',
        highlights: [
            `Order ID: ${String(order._id)}`,
            `Reply: ${replyMessage.slice(0, 180)}`,
        ],
    });

    return res.status(201).json({
        success: true,
        message: 'Support reply sent',
        commandCenter: normalizeCommandCenter(order),
    });
});

// @desc    Process warranty claim in command center (admin)
// @route   PATCH /api/orders/:id/command-center/warranty/:claimId/admin
// @access  Private/Admin
const processOrderWarrantyClaimAdmin = asyncHandler(async (req, res, next) => {
    const order = await Order.findById(req.params.id);
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const claims = getCommandCenterArray(order, 'warrantyClaims');
    const claimId = String(req.params.claimId || '').trim();
    const claimIndex = claims.findIndex((entry) => String(entry?.claimId || '') === claimId);
    if (claimIndex < 0) {
        return next(new AppError('Warranty claim not found', 404));
    }

    const claim = claims[claimIndex];
    const previousStatus = String(claim.status || 'pending').toLowerCase();
    if (['approved', 'rejected'].includes(previousStatus)) {
        return next(new AppError(`Warranty claim already ${previousStatus}`, 409));
    }

    const nextStatus = String(req.body.status || '').trim().toLowerCase();
    const note = String(req.body.note || '').trim();
    const finalStatus = nextStatus;
    const message = note || `Warranty claim moved to ${finalStatus} by admin`;
    const processedAt = ['approved', 'rejected'].includes(finalStatus) ? new Date() : null;

    claim.status = finalStatus;
    claim.resolutionNote = note;
    if (processedAt) {
        claim.processedAt = processedAt;
    }

    touchCommandCenter(order);
    appendOrderStatusEvent(order, {
        status: order.orderStatus || 'placed',
        message: `Admin set warranty claim ${claimId} to ${finalStatus}`,
        actor: 'admin',
    });
    order.markModified('commandCenter');
    await order.save();

    await notifyOrderOwnerAdminAction({
        order,
        req,
        actionKey: 'admin.order.warranty_claim',
        actionTitle: 'Warranty Claim Updated by Admin',
        actionSummary: 'An administrator reviewed your warranty claim request.',
        highlights: [
            `Order ID: ${String(order._id)}`,
            `Claim ID: ${claimId}`,
            `Previous status: ${previousStatus}`,
            `Current status: ${finalStatus}`,
            `Admin note: ${note || 'No note provided'}`,
        ],
    });

    return res.json({
        success: true,
        message,
        commandCenter: normalizeCommandCenter(order),
    });
});

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
        txOrder.statusTimeline = Array.isArray(txOrder.statusTimeline) ? txOrder.statusTimeline : [];
        txOrder.statusTimeline.push({
            status: 'cancelled',
            message: cancelReason,
            actor: actorLabel,
            at: new Date(),
        });
        await txOrder.save({ session });

        await session.commitTransaction();
        session.endSession();
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw (error instanceof AppError ? error : new AppError(error.message || 'Unable to cancel order', 500));
    }

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

// @desc    Cancel an order and trigger refund if eligible
// @route   POST /api/orders/:id/cancel
// @access  Private
const cancelOrder = asyncHandler(async (req, res) => {
    const { updatedOrder, refundMessage } = await cancelOrderByActor({
        orderId: req.params.id,
        actorUserId: req.user._id,
        actorRole: 'customer',
        cancelReasonInput: req.body?.reason,
    });

    res.status(200).json({
        success: true,
        message: refundMessage
            ? `Order cancelled. ${refundMessage}.`
            : 'Order cancelled successfully.',
        order: updatedOrder,
        commandCenter: normalizeCommandCenter(updatedOrder),
    });
});

// @desc    Cancel any order as admin (stock-safe + refund-safe)
// @route   POST /api/orders/:id/admin-cancel
// @access  Private/Admin
const cancelOrderAdmin = asyncHandler(async (req, res) => {
    const { updatedOrder, refundMessage } = await cancelOrderByActor({
        orderId: req.params.id,
        actorUserId: req.user._id,
        actorRole: 'admin',
        cancelReasonInput: req.body?.reason,
    });

    await notifyOrderOwnerAdminAction({
        order: updatedOrder,
        req,
        actionKey: 'admin.order.cancel',
        actionTitle: 'Order Cancelled by Admin',
        actionSummary: 'An administrator cancelled your order and updated the payment workflow.',
        highlights: [
            `Order ID: ${String(updatedOrder?._id || req.params.id)}`,
            `Order status: ${updatedOrder?.orderStatus || 'cancelled'}`,
            `Reason: ${String(req.body?.reason || 'Cancelled by admin').trim() || 'Cancelled by admin'}`,
            `Refund update: ${refundMessage || 'No automatic refund required'}`,
        ],
    });

    res.status(200).json({
        success: true,
        message: refundMessage
            ? `Order cancelled by admin. ${refundMessage}.`
            : 'Order cancelled by admin.',
        order: updatedOrder,
        commandCenter: normalizeCommandCenter(updatedOrder),
    });
});

const normalizeOrderStatus = (order) => {
    if (order?.orderStatus) return order.orderStatus;
    if (order?.isDelivered) return 'delivered';
    return 'placed';
};

const ALLOWED_ORDER_STATUS_TRANSITIONS = {
    placed: new Set(['processing', 'shipped']),
    processing: new Set(['shipped']),
    shipped: new Set(['delivered']),
    delivered: new Set([]),
    cancelled: new Set([]),
};

// @desc    Update order shipping state (admin)
// @route   PATCH /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatusAdmin = asyncHandler(async (req, res, next) => {
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError('Order not found', 404));

    const currentStatus = normalizeOrderStatus(order);
    const nextStatus = String(req.body.status || '').trim();
    const note = String(req.body.note || '').trim();

    if (currentStatus === nextStatus) {
        return res.json({
            success: true,
            message: `Order already in ${nextStatus} state`,
            order,
        });
    }

    const allowed = ALLOWED_ORDER_STATUS_TRANSITIONS[currentStatus] || new Set();
    if (!allowed.has(nextStatus)) {
        return next(new AppError(`Invalid transition from ${currentStatus} to ${nextStatus}`, 409));
    }

    order.orderStatus = nextStatus;
    if (nextStatus === 'delivered') {
        order.isDelivered = true;
        order.deliveredAt = new Date();
    } else if (order.orderStatus !== 'delivered') {
        order.isDelivered = false;
        order.deliveredAt = null;
    }

    order.statusTimeline = Array.isArray(order.statusTimeline) ? order.statusTimeline : [];
    order.statusTimeline.push({
        status: nextStatus,
        message: note || `Order marked ${nextStatus} by admin`,
        actor: 'admin',
        at: new Date(),
    });

    await order.save();

    await notifyOrderOwnerAdminAction({
        order,
        req,
        actionKey: 'admin.order.status_update',
        actionTitle: 'Order Status Updated by Admin',
        actionSummary: 'An administrator updated your order lifecycle state.',
        highlights: [
            `Order ID: ${String(order._id)}`,
            `Previous status: ${currentStatus}`,
            `Current status: ${nextStatus}`,
            `Admin note: ${note || 'No note provided'}`,
        ],
    });

    return res.json({
        success: true,
        message: `Order moved to ${nextStatus}`,
        order,
    });
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
const getOrders = asyncHandler(async (req, res) => {
    const orders = await Order.find({})
        .populate('user', 'id name email')
        .sort({ createdAt: -1 });
    res.json(orders);
});

module.exports = {
    quoteOrder,
    simulatePayment,
    addOrderItems,
    getMyOrderTimeline,
    getMyOrderCommandCenter,
    createOrderRefundRequest,
    createOrderReplacementRequest,
    createOrderSupportMessage,
    createOrderWarrantyClaim,
    processOrderRefundRequestAdmin,
    processOrderReplacementRequestAdmin,
    replyOrderSupportMessageAdmin,
    processOrderWarrantyClaimAdmin,
    cancelOrder,
    cancelOrderAdmin,
    updateOrderStatusAdmin,
    getMyOrders,
    getOrders,
};
