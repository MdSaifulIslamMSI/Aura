const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    PRICING_VERSION,
    buildOrderQuote,
} = require('./orderPricingService');
const {
    validatePaymentIntentForOrder,
    linkIntentToOrder,
    scheduleCaptureTask,
} = require('./payments/paymentService');
const {
    enqueueOrderPlacedEmail,
} = require('./email/orderEmailQueueService');
const { awardLoyaltyPoints } = require('./loyaltyService');
const { flags: paymentFlags } = require('../config/paymentFlags');
const { flags: emailFlags, EMAIL_REGEX } = require('../config/emailFlags');
const {
    withIdempotency,
} = require('./payments/idempotencyService');
const { scanForMarketplaceAnomalies } = require('./marketplaceIntegrityService');

const transactionFallbackEnabled = paymentFlags.nodeEnv !== 'production';

const isUnsupportedTransactionError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('transaction numbers are only allowed on a replica set member or mongos')
        || message.includes('transactions are not supported')
    );
};

const assertQuoteSnapshot = (quoteSnapshot, pricing) => {
    if (!quoteSnapshot || quoteSnapshot.totalPrice === undefined || quoteSnapshot.totalPrice === null) {
        return;
    }

    const provided = Number(quoteSnapshot.totalPrice);
    if (!Number.isFinite(provided)) return;

    const delta = Math.abs(provided - Number(pricing?.totalPrice || 0));
    if (delta > 0.01) {
        throw new AppError('Quote expired. Please recalculate before placing the order.', 409);
    }

    const presentmentProvided = Number(quoteSnapshot.presentmentTotalPrice);
    if (Number.isFinite(presentmentProvided) && pricing?.presentmentTotalPrice !== undefined) {
        const presentmentDelta = Math.abs(presentmentProvided - Number(pricing.presentmentTotalPrice || 0));
        if (presentmentDelta > 0.01) {
            throw new AppError('Presentment quote expired. Please recalculate before placing the order.', 409);
        }
    }
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
        const query = Product.updateOne(
            { id: item.productId, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } }
        );
        const update = session ? await query.session(session) : await query;

        if (update.modifiedCount !== 1) {
            throw new AppError(`Unable to reserve stock for product ${item.productId}`, 409);
        }
    }
};

const executeOrderCreation = async ({
    body,
    user,
    userId,
    requestId,
    idempotencyKey,
    session = null,
}) => {
    const quote = await buildOrderQuote(body, { session, checkStock: true });
    assertQuoteSnapshot(body.quoteSnapshot, quote.pricing);

    const paymentValidation = await validatePaymentIntentForOrder({
        userId,
        paymentIntentId: body.paymentIntentId,
        paymentMethod: quote.normalized.paymentMethod,
        totalPrice: quote.pricing.totalPrice,
        presentmentTotalPrice: quote.pricing.presentmentTotalPrice,
        presentmentCurrency: quote.pricing.presentmentCurrency,
        session,
        claimForOrder: true,
        claimKey: idempotencyKey,
    });

    await decrementStockAtomically(quote.resolvedItems, session);

    // NP-Hard: Marketplace Integrity Sweep (Subgraph Isomorphism)
    // In a production system, neighborhoodData would be populated from 
    // real referral and transaction graphs.
    const simulatedNeighborhood = [
        [userId.toString(), 'u_neighbor_1'],
        ['u_neighbor_1', 'u_neighbor_2'],
        ['u_neighbor_2', userId.toString()] // Intentional Circular Referral Pattern
    ];
    const integrityResults = await scanForMarketplaceAnomalies(userId, simulatedNeighborhood);
    
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
        settlementCurrency: quote.pricing.settlementCurrency || 'INR',
        settlementAmount: quote.pricing.settlementAmount ?? quote.pricing.totalPrice,
        presentmentCurrency: quote.pricing.presentmentCurrency || quote.pricing.settlementCurrency || 'INR',
        presentmentTotalPrice: quote.pricing.presentmentTotalPrice ?? quote.pricing.totalPrice,
        marketCountryCode: quote.pricing.market?.countryCode || 'IN',
        couponCode: quote.normalized.couponCode || '',
        couponDiscount: quote.pricing.couponDiscount,
        paymentAdjustment: quote.pricing.paymentAdjustment,
        deliveryOption: quote.normalized.deliveryOption,
        deliverySlot: quote.normalized.deliverySlot || undefined,
        checkoutSource: quote.normalized.checkoutSource,
        pricingVersion: quote.pricing.pricingVersion || PRICING_VERSION,
        priceBreakdown: {
            ...quote.pricing.priceBreakdown,
            market: quote.pricing.market || null,
            charge: quote.pricing.charge || null,
            integrityInsights: integrityResults
        },
        paymentIntentId: paymentIntent?.intentId || body.paymentIntentId || '',
        paymentProvider: paymentIntent?.provider || '',
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
                email_address: user.email || '',
            }
            : undefined,
        isPaid: paymentValidation.isPaid,
        paidAt: paymentValidation.isPaid ? new Date() : undefined,
        orderStatus: 'placed',
        refundSummary: {
            totalRefunded: 0,
            settlementCurrency: quote.pricing.settlementCurrency || 'INR',
            presentmentCurrency: quote.pricing.presentmentCurrency || quote.pricing.settlementCurrency || 'INR',
            presentmentTotalRefunded: 0,
            fullyRefunded: false,
            refunds: [],
        },
    });

    const createdOrder = session ? await order.save({ session }) : await order.save();
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
            requestId,
            userId: String(userId),
            orderId: String(createdOrder._id),
            error: rewardError.message,
        });
    }

    if (emailFlags.orderEmailsEnabled) {
        const notification = await enqueueOrderPlacedEmail({
            order: createdOrder,
            user,
            requestId,
            session,
        });

        if (notification?.notificationId) {
            createdOrder.confirmationEmailStatus = 'pending';
            createdOrder.confirmationEmailNotificationId = notification.notificationId;
            createdOrder.confirmationEmailSentAt = null;
            if (session) {
                await createdOrder.save({ session });
            } else {
                await createdOrder.save();
            }
        }
    } else {
        createdOrder.confirmationEmailStatus = 'skipped';
        createdOrder.confirmationEmailNotificationId = '';
        createdOrder.confirmationEmailSentAt = null;
        if (session) {
            await createdOrder.save({ session });
        } else {
            await createdOrder.save();
        }
    }

    if (quote.normalized.checkoutSource !== 'directBuy') {
        const cartClearQuery = User.updateOne(
            { _id: userId },
            {
                $set: {
                    cart: [],
                    cartSyncedAt: new Date(),
                },
                $inc: { cartRevision: 1 },
            }
        );
        if (session) {
            await cartClearQuery.session(session);
        } else {
            await cartClearQuery;
        }
    }

    if (paymentIntent?.intentId && paymentIntent.status === 'authorized') {
        await scheduleCaptureTask({ intentId: paymentIntent.intentId, session });
    }

    return createdOrder;
};

const placeOrderWithIdempotency = async ({
    body,
    user,
    userId,
    requestId,
    idempotencyKey,
    userKey,
}) => withIdempotency({
    key: idempotencyKey,
    userKey,
    route: 'orders:create',
    requestPayload: body,
    handler: async () => {
        if (emailFlags.orderEmailsEnabled && !EMAIL_REGEX.test(String(user?.email || '').trim())) {
            throw new AppError('A valid account email is required to place order', 400);
        }

        let session = null;
        let transactionStarted = false;

        try {
            session = await mongoose.startSession();
            session.startTransaction();
            transactionStarted = true;

            const createdOrder = await executeOrderCreation({
                body,
                user,
                userId,
                requestId,
                idempotencyKey,
                session,
            });
            await session.commitTransaction();
            return { statusCode: 201, response: createdOrder };
        } catch (innerError) {
            if (transactionStarted) {
                try {
                    await session.abortTransaction();
                } catch (abortError) {
                    logger.warn('order.create_abort_failed', {
                        requestId,
                        userId: String(userId),
                        error: abortError.message,
                    });
                }
            }

            if (transactionFallbackEnabled && isUnsupportedTransactionError(innerError)) {
                logger.warn('order.create_transaction_fallback', {
                    requestId,
                    userId: String(userId),
                    reason: innerError.message,
                });
                try {
                    const createdOrder = await executeOrderCreation({
                        body,
                        user,
                        userId,
                        requestId,
                        idempotencyKey,
                        session: null,
                    });
                    return { statusCode: 201, response: createdOrder };
                } catch (fallbackError) {
                    logger.error('order.create_failed', {
                        requestId,
                        userId: String(userId),
                        error: fallbackError.message,
                    });
                    throw fallbackError;
                }
            }

            logger.error('order.create_failed', {
                requestId,
                userId: String(userId),
                error: innerError.message,
            });
            throw innerError;
        } finally {
            if (session) {
                session.endSession();
            }
        }
    },
});

module.exports = {
    placeOrderWithIdempotency,
};
