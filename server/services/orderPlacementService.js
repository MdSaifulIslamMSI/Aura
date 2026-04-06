const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    PRICING_VERSION,
    buildOrderQuote,
} = require('./orderPricingService');
const {
    validatePaymentIntentForOrder,
    linkIntentToOrder,
    releaseIntentOrderClaim,
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
const { clearCartAfterCheckout } = require('./cartService');
const { emitCartRealtimeUpdate } = require('./cartRealtimeService');

const transactionFallbackEnabled = paymentFlags.nodeEnv !== 'production';

const isUnsupportedTransactionError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('transaction numbers are only allowed on a replica set member or mongos')
        || message.includes('transactions are not supported')
    );
};

const assertQuoteSnapshot = (quoteSnapshot, pricing, cart = null) => {
    if (!quoteSnapshot || quoteSnapshot.totalPrice === undefined || quoteSnapshot.totalPrice === null) {
        return;
    }

    if (quoteSnapshot.baseAmount !== undefined && quoteSnapshot.baseAmount !== null) {
        const baseDelta = Math.abs(Number(quoteSnapshot.baseAmount) - Number(pricing?.baseAmount || 0));
        if (baseDelta > 0.01) {
            throw new AppError('Base currency quote expired. Please recalculate before placing the order.', 409);
        }
    }
    if (quoteSnapshot.baseCurrency && pricing?.baseCurrency) {
        if (String(quoteSnapshot.baseCurrency).trim().toUpperCase() !== String(pricing.baseCurrency).trim().toUpperCase()) {
            throw new AppError('Base currency quote mismatch. Please recalculate before placing the order.', 409);
        }
    }

    if (quoteSnapshot.displayAmount !== undefined && quoteSnapshot.displayAmount !== null) {
        const displayDelta = Math.abs(Number(quoteSnapshot.displayAmount) - Number(pricing?.displayAmount || 0));
        if (displayDelta > 0.01) {
            throw new AppError('Display currency quote expired. Please recalculate before placing the order.', 409);
        }
    }
    if (quoteSnapshot.displayCurrency && pricing?.displayCurrency) {
        if (String(quoteSnapshot.displayCurrency).trim().toUpperCase() !== String(pricing.displayCurrency).trim().toUpperCase()) {
            throw new AppError('Display currency quote mismatch. Please recalculate before placing the order.', 409);
        }
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

    if (cart && quoteSnapshot.cartVersion !== undefined && quoteSnapshot.cartVersion !== null) {
        const snapshotVersion = Number(quoteSnapshot.cartVersion);
        if (Number.isInteger(snapshotVersion) && snapshotVersion !== Number(cart?.version || 0)) {
            throw new AppError('Cart changed. Refresh checkout before placing the order.', 409);
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
    market = null,
    session = null,
}) => {
    const quote = await buildOrderQuote(body, {
        session,
        checkStock: true,
        market,
        userId,
    });
    assertQuoteSnapshot(body.quoteSnapshot, quote.pricing, quote.cart);

    const paymentValidation = await validatePaymentIntentForOrder({
        userId,
        paymentIntentId: body.paymentIntentId,
        paymentMethod: quote.normalized.paymentMethod,
        baseAmount: quote.pricing.baseAmount,
        baseCurrency: quote.pricing.baseCurrency,
        displayAmount: quote.pricing.displayAmount,
        displayCurrency: quote.pricing.displayCurrency,
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
        baseAmount: quote.pricing.baseAmount ?? quote.pricing.totalPrice,
        baseCurrency: quote.pricing.baseCurrency || 'INR',
        displayAmount: quote.pricing.displayAmount ?? quote.pricing.presentmentTotalPrice ?? quote.pricing.totalPrice,
        displayCurrency: quote.pricing.displayCurrency || quote.pricing.presentmentCurrency || 'INR',
        fxRateLocked: quote.pricing.fxRateLocked ?? 1,
        fxTimestamp: quote.pricing.fxTimestamp || new Date().toISOString(),
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

    const cartSnapshot = quote.normalized.checkoutSource !== 'directBuy'
        ? await clearCartAfterCheckout({
            userId,
            expectedVersion: quote.cart?.version ?? quote.normalized.cartVersion,
            market,
            session,
        })
        : null;

    if (paymentIntent?.intentId && paymentIntent.status === 'authorized') {
        await scheduleCaptureTask({ intentId: paymentIntent.intentId, session });
    }

    return {
        createdOrder,
        cartSnapshot,
    };
};

const placeOrderWithIdempotency = async ({
    body,
    user,
    userId,
    authUid = '',
    requestId,
    idempotencyKey,
    userKey,
    market = null,
}) => withIdempotency({
    key: idempotencyKey,
    userKey,
    route: 'orders:create',
    requestPayload: body,
    handler: async () => {
        if (emailFlags.orderEmailsEnabled && !EMAIL_REGEX.test(String(user?.email || '').trim())) {
            throw new AppError('A valid account email is required to place order', 400);
        }

        const releaseClaimLock = async () => {
            if (!body?.paymentIntentId || !idempotencyKey) return;

            try {
                await releaseIntentOrderClaim({
                    intentId: body.paymentIntentId,
                    claimKey: idempotencyKey,
                });
            } catch (releaseError) {
                logger.warn('order.release_payment_claim_failed', {
                    requestId,
                    userId: String(userId),
                    intentId: body.paymentIntentId,
                    error: releaseError.message,
                });
            }
        };

        let session = null;
        let transactionStarted = false;

        try {
            session = await mongoose.startSession();
            session.startTransaction();
            transactionStarted = true;

            const { createdOrder, cartSnapshot } = await executeOrderCreation({
                body,
                user,
                userId,
                requestId,
                idempotencyKey,
                market,
                session,
            });
            await session.commitTransaction();
            if (cartSnapshot) {
                emitCartRealtimeUpdate({
                    socketUserId: userId,
                    authUid,
                    cart: cartSnapshot,
                    reason: 'checkout_cart_cleared',
                    requestId,
                    source: 'order_placement_service',
                });
            }
            return {
                statusCode: 201,
                response: {
                    ...(createdOrder.toObject ? createdOrder.toObject() : createdOrder),
                    cart: cartSnapshot,
                },
            };
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
                    const { createdOrder, cartSnapshot } = await executeOrderCreation({
                        body,
                        user,
                        userId,
                        requestId,
                        idempotencyKey,
                        market,
                        session: null,
                    });
                    if (cartSnapshot) {
                        emitCartRealtimeUpdate({
                            socketUserId: userId,
                            authUid,
                            cart: cartSnapshot,
                            reason: 'checkout_cart_cleared',
                            requestId,
                            source: 'order_placement_service',
                        });
                    }
                    return {
                        statusCode: 201,
                        response: {
                            ...(createdOrder.toObject ? createdOrder.toObject() : createdOrder),
                            cart: cartSnapshot,
                        },
                    };
                } catch (fallbackError) {
                    await releaseClaimLock();
                    logger.error('order.create_failed', {
                        requestId,
                        userId: String(userId),
                        error: fallbackError.message,
                    });
                    throw fallbackError;
                }
            }

            await releaseClaimLock();
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
