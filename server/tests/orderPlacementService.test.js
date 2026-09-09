const loadPlaceOrderService = ({
    buildOrderQuoteImpl,
    validatePaymentIntentForOrderImpl,
    linkIntentToOrderImpl,
} = {}) => {
    jest.resetModules();

    const startTransaction = jest.fn();
    const abortTransaction = jest.fn(async () => {});
    const commitTransaction = jest.fn(async () => {});
    const endSession = jest.fn();
    const startSession = jest.fn(async () => ({
        startTransaction,
        abortTransaction,
        commitTransaction,
        endSession,
    }));

    const buildOrderQuote = jest.fn(
        buildOrderQuoteImpl || (async (_body, _options = {}) => ({
            pricing: {
                itemsPrice: 1200,
                taxPrice: 0,
                shippingPrice: 0,
                totalPrice: 1200,
                baseAmount: 1200,
                baseCurrency: 'INR',
                displayAmount: 1200,
                displayCurrency: 'INR',
                fxRateLocked: 1,
                fxTimestamp: '2026-04-18T00:00:00.000Z',
                settlementCurrency: 'INR',
                settlementAmount: 1200,
                presentmentCurrency: 'INR',
                presentmentTotalPrice: 1200,
                couponDiscount: 0,
                paymentAdjustment: 0,
                pricingVersion: 'v2',
                priceBreakdown: {},
                market: { countryCode: 'IN' },
                charge: null,
            },
            normalized: {
                shippingAddress: {
                    address: '42 Main Road',
                    city: 'Pune',
                    postalCode: '411001',
                    country: 'India',
                },
                paymentMethod: 'CARD',
                deliveryOption: 'standard',
                deliverySlot: null,
                checkoutSource: 'directBuy',
                couponCode: '',
            },
            resolvedItems: [{
                title: 'Aura Test Product',
                quantity: 1,
                image: 'https://example.com/product.jpg',
                price: 1200,
                mongoProductId: 'prod_1',
                productId: 'sku_1',
            }],
            cart: null,
        }))
    );

    const validatePaymentIntentForOrder = jest.fn(
        validatePaymentIntentForOrderImpl || (async ({
            paymentIntentId,
            claimKey,
        }) => ({
            paymentIntent: {
                intentId: paymentIntentId,
                provider: 'razorpay',
                status: 'authorized',
                authorizedAt: new Date('2026-04-18T00:00:00.000Z'),
                riskSnapshot: {},
            },
            isPaid: false,
            paymentState: 'authorized',
            claimKey,
        }))
    );

    const linkIntentToOrder = jest.fn(
        linkIntentToOrderImpl || (async ({ intentId, orderId, claimKey }) => ({
            intentId,
            order: orderId,
            orderClaim: {
                state: 'consumed',
                key: claimKey,
                lockedAt: new Date('2026-04-18T00:00:00.000Z'),
            },
        }))
    );

    const releaseIntentOrderClaim = jest.fn(async () => null);
    const scheduleCaptureTask = jest.fn(async () => ({ _id: 'capture_task_1' }));
    const awardLoyaltyPoints = jest.fn(async () => null);
    const enqueueOrderPlacedEmail = jest.fn(async () => ({ notificationId: 'notif_1' }));
    const withIdempotency = jest.fn(async ({ handler }) => handler());
    const scanForMarketplaceAnomalies = jest.fn(async () => ([]));
    const clearCartAfterCheckout = jest.fn(async () => null);
    const emitCartRealtimeUpdate = jest.fn();
    const logger = {
        warn: jest.fn(),
        error: jest.fn(),
    };

    class FakeOrder {
        constructor(doc = {}) {
            Object.assign(this, doc);
            this._id = this._id || 'order_test_1';
        }

        async save() {
            return this;
        }

        toObject() {
            return { ...this };
        }
    }
    FakeOrder.deleteOne = jest.fn(async () => ({ deletedCount: 1 }));

    const productUpdateOne = jest.fn(() => {
        const result = Promise.resolve({ modifiedCount: 1 });
        result.session = jest.fn(async () => ({ modifiedCount: 1 }));
        return result;
    });
    const userUpdateOne = jest.fn(async () => ({ modifiedCount: 1 }));

    const couponRedemptionFindOne = jest.fn(() => {
        const result = Promise.resolve(null);
        result.session = jest.fn(() => result);
        return result;
    });
    const couponRedemptionCreate = jest.fn(async () => [{}]);

    jest.doMock('mongoose', () => ({ startSession }));
    jest.doMock('../models/Order', () => FakeOrder);
    jest.doMock('../models/Product', () => ({ updateOne: productUpdateOne }));
    jest.doMock('../models/User', () => ({ updateOne: userUpdateOne }));
    jest.doMock('../models/CouponRedemption', () => ({
        findOne: couponRedemptionFindOne,
        create: couponRedemptionCreate,
    }));
    jest.doMock('../utils/logger', () => logger);
    jest.doMock('../services/orderPricingService', () => ({
        PRICING_VERSION: 'v2',
        buildOrderQuote,
    }));
    jest.doMock('../services/payments/paymentService', () => ({
        validatePaymentIntentForOrder,
        linkIntentToOrder,
        releaseIntentOrderClaim,
        scheduleCaptureTask,
    }));
    jest.doMock('../services/email/orderEmailQueueService', () => ({
        enqueueOrderPlacedEmail,
    }));
    jest.doMock('../services/loyaltyService', () => ({
        awardLoyaltyPoints,
    }));
    jest.doMock('../config/paymentFlags', () => ({
        flags: { nodeEnv: 'test' },
    }));
    jest.doMock('../config/emailFlags', () => ({
        flags: { orderEmailsEnabled: false },
        EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    }));
    jest.doMock('../services/payments/idempotencyService', () => ({
        withIdempotency,
    }));
    jest.doMock('../services/marketplaceIntegrityService', () => ({
        scanForMarketplaceAnomalies,
    }));
    jest.doMock('../services/cartService', () => ({
        clearCartAfterCheckout,
    }));
    jest.doMock('../services/cartRealtimeService', () => ({
        emitCartRealtimeUpdate,
    }));

    const { placeOrderWithIdempotency } = require('../services/orderPlacementService');

    return {
        placeOrderWithIdempotency,
        buildOrderQuote,
        validatePaymentIntentForOrder,
        linkIntentToOrder,
        releaseIntentOrderClaim,
        scheduleCaptureTask,
        awardLoyaltyPoints,
        enqueueOrderPlacedEmail,
        withIdempotency,
        scanForMarketplaceAnomalies,
        clearCartAfterCheckout,
        emitCartRealtimeUpdate,
        logger,
        startSession,
        startTransaction,
        abortTransaction,
        commitTransaction,
        endSession,
        productUpdateOne,
        userUpdateOne,
        couponRedemptionFindOne,
        couponRedemptionCreate,
        orderDeleteOne: FakeOrder.deleteOne,
    };
};

describe('orderPlacementService hardening', () => {
    afterEach(() => {
        delete process.env.TEST_REQUIRE_TRANSACTION_MONGO;
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('mongoose');
    });

    test('fails closed for digital checkout when Mongo transactions are unavailable', async () => {
        process.env.TEST_REQUIRE_TRANSACTION_MONGO = 'true';
        const transactionError = new Error('Transactions are not supported');
        const {
            placeOrderWithIdempotency,
            buildOrderQuote,
            releaseIntentOrderClaim,
            logger,
        } = loadPlaceOrderService({
            buildOrderQuoteImpl: async (_body, options = {}) => {
                if (options.session) {
                    throw transactionError;
                }
                throw new Error('Digital checkout should not retry without transactions');
            },
        });

        await expect(placeOrderWithIdempotency({
            body: {
                paymentMethod: 'CARD',
                paymentIntentId: 'pi_live_1',
            },
            user: {
                _id: 'user_1',
                email: 'checkout@example.com',
                name: 'Checkout User',
            },
            userId: 'user_1',
            authUid: 'auth_uid_1',
            requestId: 'req_tx_required',
            idempotencyKey: 'order-key',
            userKey: 'user-key',
            market: null,
        })).rejects.toMatchObject({
            statusCode: 503,
            message: expect.stringMatching(/transaction support/i),
        });

        expect(buildOrderQuote).toHaveBeenCalledTimes(1);
        expect(releaseIntentOrderClaim).toHaveBeenCalledWith({
            intentId: 'pi_live_1',
            claimKey: 'order-key',
        });
        expect(logger.error).toHaveBeenCalledWith(
            'order.create_transaction_required',
            expect.objectContaining({
                requestId: 'req_tx_required',
                userId: 'user_1',
                paymentMethod: 'CARD',
            })
        );
    });

    test('rejects order creation when the payment intent cannot be linked back to the saved order', async () => {
        const {
            placeOrderWithIdempotency,
            linkIntentToOrder,
            releaseIntentOrderClaim,
            scheduleCaptureTask,
            commitTransaction,
        } = loadPlaceOrderService({
            linkIntentToOrderImpl: async () => null,
        });

        await expect(placeOrderWithIdempotency({
            body: {
                paymentMethod: 'CARD',
                paymentIntentId: 'pi_live_2',
                shippingAddress: {
                    address: '42 Main Road',
                    city: 'Pune',
                    postalCode: '411001',
                    country: 'India',
                },
            },
            user: {
                _id: 'user_2',
                email: 'checkout@example.com',
                name: 'Checkout User',
            },
            userId: 'user_2',
            authUid: 'auth_uid_2',
            requestId: 'req_link_required',
            idempotencyKey: 'order-key-2',
            userKey: 'user-key-2',
            market: null,
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/bind the payment intent/i),
        });

        expect(linkIntentToOrder).toHaveBeenCalledTimes(1);
        expect(scheduleCaptureTask).not.toHaveBeenCalled();
        expect(commitTransaction).not.toHaveBeenCalled();
        expect(releaseIntentOrderClaim).toHaveBeenCalledWith({
            intentId: 'pi_live_2',
            claimKey: 'order-key-2',
        });
    });

    test('does not run synthetic marketplace integrity analysis during order creation', async () => {
        const {
            placeOrderWithIdempotency,
            scanForMarketplaceAnomalies,
            commitTransaction,
        } = loadPlaceOrderService();

        const result = await placeOrderWithIdempotency({
            body: {
                paymentMethod: 'CARD',
                paymentIntentId: 'pi_live_3',
                shippingAddress: {
                    address: '42 Main Road',
                    city: 'Pune',
                    postalCode: '411001',
                    country: 'India',
                },
            },
            user: {
                _id: 'user_3',
                email: 'checkout@example.com',
                name: 'Checkout User',
            },
            userId: 'user_3',
            authUid: 'auth_uid_3',
            requestId: 'req_no_synthetic_integrity',
            idempotencyKey: 'order-key-3',
            userKey: 'user-key-3',
            market: null,
        });

        expect(result.statusCode).toBe(201);
        expect(result.response.orderItems[0]).toMatchObject({
            price: 1200,
            priceMinor: 120000,
        });
        expect(result.response).toMatchObject({
            itemsPriceMinor: 120000,
            taxPriceMinor: 0,
            shippingPriceMinor: 0,
            totalPriceMinor: 120000,
            baseAmountMinor: 120000,
            displayAmountMinor: 120000,
            settlementAmountMinor: 120000,
            presentmentTotalPriceMinor: 120000,
            couponDiscountMinor: 0,
            paymentAdjustmentMinor: 0,
            refundSummary: expect.objectContaining({
                totalRefundedMinor: 0,
                presentmentTotalRefundedMinor: 0,
            }),
        });
        expect(scanForMarketplaceAnomalies).not.toHaveBeenCalled();
        expect(result.response.priceBreakdown).not.toHaveProperty('integrityInsights');
        expect(commitTransaction).toHaveBeenCalledTimes(1);
    });

    test('increments the buyer lifetime-spend counter on placement', async () => {
        const {
            placeOrderWithIdempotency,
            userUpdateOne,
        } = loadPlaceOrderService();

        const result = await placeOrderWithIdempotency({
            body: {
                paymentMethod: 'COD',
                shippingAddress: {
                    address: '42 Main Road',
                    city: 'Pune',
                    postalCode: '411001',
                    country: 'India',
                },
            },
            user: {
                _id: 'user_spend',
                email: 'spend@example.com',
                name: 'Spend User',
            },
            userId: 'user_spend',
            authUid: 'auth_uid_spend',
            requestId: 'req_lifetime_spend',
            idempotencyKey: 'order-key-spend',
            userKey: 'user-key-spend',
            market: null,
        });

        expect(result.statusCode).toBe(201);
        expect(userUpdateOne).toHaveBeenCalledWith(
            { _id: 'user_spend' },
            { $inc: { lifetimeSpent: 1200, lifetimeSpentMinor: 120000 } },
            expect.anything()
        );
    });

    test('compensates the fallback placement when the coupon race loses the unique-index race', async () => {
        const {
            placeOrderWithIdempotency,
            startSession,
            couponRedemptionFindOne,
            couponRedemptionCreate,
            productUpdateOne,
            orderDeleteOne,
            logger,
        } = loadPlaceOrderService({
            buildOrderQuoteImpl: async () => ({
                pricing: {
                    itemsPrice: 1200,
                    taxPrice: 0,
                    shippingPrice: 0,
                    totalPrice: 1000,
                    baseAmount: 1000,
                    baseCurrency: 'INR',
                    displayAmount: 1000,
                    displayCurrency: 'INR',
                    fxRateLocked: 1,
                    fxTimestamp: '2026-09-09T00:00:00.000Z',
                    settlementCurrency: 'INR',
                    settlementAmount: 1000,
                    presentmentCurrency: 'INR',
                    presentmentTotalPrice: 1000,
                    couponDiscount: 200,
                    paymentAdjustment: 0,
                    pricingVersion: 'v2',
                    priceBreakdown: {},
                    market: { countryCode: 'IN' },
                    charge: null,
                },
                normalized: {
                    shippingAddress: {
                        address: '42 Main Road',
                        city: 'Pune',
                        postalCode: '411001',
                        country: 'India',
                    },
                    paymentMethod: 'COD',
                    deliveryOption: 'standard',
                    deliverySlot: null,
                    checkoutSource: 'directBuy',
                    couponCode: 'AURA10',
                },
                resolvedItems: [{
                    title: 'Aura Test Product',
                    quantity: 1,
                    image: 'https://example.com/product.jpg',
                    price: 1200,
                    mongoProductId: 'prod_1',
                    productId: 'sku_1',
                }],
                cart: null,
            }),
        });

        // Force the non-transactional fallback path (shared-tier Mongo).
        startSession.mockRejectedValue(new Error(
            'Transaction numbers are only allowed on a replica set member or mongos'
        ));
        // A concurrent placement won the coupon; the check-then-act findOne
        // passed but the redemption insert hits the unique index.
        couponRedemptionCreate.mockRejectedValue(
            Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
        );

        await expect(placeOrderWithIdempotency({
            body: {
                paymentMethod: 'COD',
                couponCode: 'AURA10',
                shippingAddress: {
                    address: '42 Main Road',
                    city: 'Pune',
                    postalCode: '411001',
                    country: 'India',
                },
            },
            user: {
                _id: 'user_coupon_race',
                email: 'coupon-race@example.com',
                name: 'Coupon Race User',
            },
            userId: 'user_coupon_race',
            authUid: 'auth_uid_coupon_race',
            requestId: 'req_coupon_fallback_race',
            idempotencyKey: 'order-key-coupon-race',
            userKey: 'user-key-coupon-race',
            market: null,
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/already been used/i),
        });

        // The discounted order must not survive without its redemption row.
        expect(orderDeleteOne).toHaveBeenCalledWith({ _id: 'order_test_1' });
        const restoreCall = productUpdateOne.mock.calls
            .map(([, update]) => update)
            .find((update) => update.$inc.stock > 0);
        expect(restoreCall).toEqual({ $inc: { stock: 1 } });
        expect(logger.warn).toHaveBeenCalledWith(
            'coupon.redemption_record_duplicate_fallback_abort',
            expect.objectContaining({ couponCode: 'AURA10' })
        );
    });
});
