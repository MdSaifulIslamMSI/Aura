jest.mock('../services/email/orderEmailQueueService', () => ({
    enqueueOrderPlacedEmail: jest.fn(async () => ({ notificationId: 'notif_coupon_test' })),
}));

jest.mock('../services/loyaltyService', () => ({
    awardLoyaltyPoints: jest.fn(async () => null),
}));

const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const CouponRedemption = require('../models/CouponRedemption');
const { addOrderItems } = require('../controllers/orderController');
const { buildOrderQuote } = require('../services/orderPricingService');

const makeUser = async (overrides = {}) => User.create({
    name: 'Coupon User',
    email: `coupon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeProduct = async (overrides = {}) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return Product.create({
        id: Number(`9${Math.floor(10000000 + Math.random() * 89999999)}`),
        title: `Coupon Product ${suffix}`,
        brand: 'AuraTest',
        category: 'Electronics',
        price: 2000,
        image: `https://example.com/${suffix}.jpg`,
        stock: 5,
        isPublished: true,
        catalogVersion: 'legacy-v1',
        source: 'manual',
        ...overrides,
    });
};

const invokeAddOrderItems = async ({ user, body, idempotencyKey }) => {
    const res = {
        statusCode: 200,
        payload: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        },
    };
    let nextError = null;

    await addOrderItems({
        user,
        body,
        headers: { 'idempotency-key': idempotencyKey },
        requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
        ip: '127.0.0.1',
        method: 'POST',
        originalUrl: '/api/orders',
    }, res, (error) => {
        nextError = error || null;
    });

    return { res, nextError };
};

const placeCodOrder = async ({ user, product, couponCode, idempotencyKey }) => {
    const body = {
        orderItems: [{ product: product.id, quantity: 1 }],
        shippingAddress: {
            address: '42 Main Road',
            city: 'Pune',
            postalCode: '411001',
            country: 'India',
        },
        paymentMethod: 'COD',
        checkoutSource: 'directBuy',
        ...(couponCode ? { couponCode } : {}),
    };

    const quote = await buildOrderQuote(body, { userId: user._id });

    return invokeAddOrderItems({
        user: { _id: user._id, email: user.email, name: user.name },
        body: {
            ...body,
            quoteSnapshot: { totalPrice: quote.pricing.totalPrice },
        },
        idempotencyKey,
    });
};

describe('Coupon redemption ledger', () => {
    test('records the first redemption and blocks reuse by the same user', async () => {
        const product = await makeProduct({ price: 2000, stock: 5 });
        const buyer = await makeUser();

        const first = await placeCodOrder({
            user: buyer,
            product,
            couponCode: 'AURA10',
            idempotencyKey: 'coupon-first-order',
        });

        expect(first.nextError).toBeNull();
        expect(first.res.statusCode).toBe(201);
        expect(first.res.payload.couponCode).toBe('AURA10');
        expect(first.res.payload.couponDiscount).toBe(200);

        const redemptions = await CouponRedemption.find({ code: 'AURA10', user: buyer._id }).lean();
        expect(redemptions).toHaveLength(1);
        expect(redemptions[0].discount).toBe(200);
        expect(redemptions[0].discountMinor).toBe(20000);
        expect(String(redemptions[0].order)).toBe(String(first.res.payload._id));

        const stockAfterFirst = (await Product.findById(product._id).lean()).stock;
        expect(stockAfterFirst).toBe(4);

        const second = await placeCodOrder({
            user: buyer,
            product,
            couponCode: 'AURA10',
            idempotencyKey: 'coupon-second-order',
        });

        expect(second.nextError).toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/already been used/i),
        });

        const orders = await Order.countDocuments({ user: buyer._id });
        expect(orders).toBe(1);
        expect((await Product.findById(product._id).lean()).stock).toBe(4);
    }, 20000);

    test('the same coupon stays available to other users', async () => {
        const product = await makeProduct({ price: 2000, stock: 5 });
        const firstBuyer = await makeUser();
        const secondBuyer = await makeUser();

        const first = await placeCodOrder({
            user: firstBuyer,
            product,
            couponCode: 'AURA10',
            idempotencyKey: 'coupon-other-user-1',
        });
        expect(first.nextError).toBeNull();

        const second = await placeCodOrder({
            user: secondBuyer,
            product,
            couponCode: 'AURA10',
            idempotencyKey: 'coupon-other-user-2',
        });

        expect(second.nextError).toBeNull();
        expect(second.res.statusCode).toBe(201);
        expect(second.res.payload.couponDiscount).toBe(200);

        const redemptions = await CouponRedemption.countDocuments({ code: 'AURA10' });
        expect(redemptions).toBe(2);
    }, 20000);

    test('unique index backstops concurrent redemptions of the same coupon', async () => {
        const buyer = await makeUser();
        const orderRef = new (require('mongoose').Types.ObjectId)();

        await CouponRedemption.create({
            code: 'AURA10',
            user: buyer._id,
            order: orderRef,
            discount: 200,
        });

        await expect(CouponRedemption.create({
            code: 'AURA10',
            user: buyer._id,
            order: orderRef,
            discount: 200,
        })).rejects.toMatchObject({ code: 11000 });
    });
});
