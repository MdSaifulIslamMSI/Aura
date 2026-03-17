jest.mock('../services/email/orderEmailQueueService', () => ({
    enqueueOrderPlacedEmail: jest.fn(async () => ({ notificationId: 'notif_test_123' })),
}));

jest.mock('../services/loyaltyService', () => ({
    awardLoyaltyPoints: jest.fn(async () => null),
}));

const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const { addOrderItems } = require('../controllers/orderController');
const { buildOrderQuote } = require('../services/orderPricingService');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const AppError = require('../utils/AppError');

const makeUser = async (overrides = {}) => User.create({
    name: 'Checkout User',
    email: `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    cart: [],
    ...overrides,
});

const makeProduct = async (overrides = {}) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return Product.create({
        id: Number(`9${Math.floor(10000000 + Math.random() * 89999999)}`),
        title: `Integrity Product ${suffix}`,
        brand: 'AuraTest',
        category: 'Electronics',
        price: 1000,
        image: `https://example.com/${suffix}.jpg`,
        stock: 5,
        isPublished: true,
        catalogVersion: 'legacy-v1',
        source: 'manual',
        ...overrides,
    });
};

const makeAuthorizedIntent = async ({
    userId,
    amount,
    method = 'CARD',
    intentId = `pi_${Math.random().toString(36).slice(2, 10)}`,
} = {}) => PaymentIntent.create({
    intentId,
    user: userId,
    provider: 'simulated',
    providerOrderId: `sim_order_${Math.random().toString(36).slice(2, 10)}`,
    providerPaymentId: `sim_payment_${Math.random().toString(36).slice(2, 10)}`,
    amount,
    currency: 'INR',
    method,
    status: PAYMENT_STATUSES.AUTHORIZED,
    authorizedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    riskSnapshot: {
        score: 0,
        decision: 'allow',
        factors: [],
        mode: 'shadow',
    },
    challenge: {
        required: false,
        status: 'none',
        verifiedAt: null,
    },
    orderClaim: {
        state: 'none',
        key: '',
        lockedAt: null,
    },
    metadata: {},
});

const createMockRes = () => {
    const res = {
        statusCode: 200,
        payload: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.payload = body;
            return this;
        },
    };
    return res;
};

const invokeAddOrderItems = async ({ user, body, idempotencyKey }) => {
    const req = {
        user,
        body,
        headers: {
            'idempotency-key': idempotencyKey,
        },
        requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
        ip: '127.0.0.1',
        method: 'POST',
        originalUrl: '/api/orders',
    };
    const res = createMockRes();
    let nextError = null;

    await addOrderItems(req, res, (error) => {
        nextError = error || null;
    });

    return { res, nextError };
};

describe('Order Controller Create Integrity', () => {
    test('creates a digital order, consumes the intent, schedules capture, and clears cart', async () => {
        const product = await makeProduct({ stock: 7, price: 1000 });
        const user = await makeUser({
            cart: [{
                id: product.id,
                title: product.title,
                price: product.price,
                image: product.image,
                quantity: 1,
                stock: product.stock,
            }],
        });

        const body = {
            orderItems: [{ product: product.id, quantity: 1 }],
            shippingAddress: {
                address: '42 Main Road',
                city: 'Pune',
                postalCode: '411001',
                country: 'India',
            },
            paymentMethod: 'CARD',
            checkoutSource: 'cart',
        };

        const quote = await buildOrderQuote(body);
        const intent = await makeAuthorizedIntent({
            userId: user._id,
            amount: quote.pricing.totalPrice,
            method: 'CARD',
        });

        const { res, nextError } = await invokeAddOrderItems({
            user: { _id: user._id, email: user.email, name: user.name },
            body: {
                ...body,
                paymentIntentId: intent.intentId,
                quoteSnapshot: { totalPrice: quote.pricing.totalPrice },
            },
            idempotencyKey: 'order-create-alpha',
        });

        expect(nextError).toBeNull();
        expect(res.statusCode).toBe(201);
        expect(res.payload).toBeTruthy();

        const orders = await Order.find({ user: user._id }).lean();
        const outboxTasks = await PaymentOutboxTask.find({ taskType: 'capture', intentId: intent.intentId }).lean();
        const refreshedIntent = await PaymentIntent.findOne({ intentId: intent.intentId }).lean();
        const refreshedUser = await User.findById(user._id).lean();
        const refreshedProduct = await Product.findById(product._id).lean();

        expect(orders).toHaveLength(1);
        expect(outboxTasks).toHaveLength(1);
        expect(outboxTasks[0].status).toBe('pending');
        expect(refreshedIntent.order).toBeTruthy();
        expect(refreshedIntent.orderClaim.state).toBe('consumed');
        expect(refreshedUser.cart).toHaveLength(0);
        expect(refreshedProduct.stock).toBe(6);
        expect(orders[0].paymentIntentId).toBe(intent.intentId);
        expect(orders[0].paymentState).toBe(PAYMENT_STATUSES.AUTHORIZED);
        expect(orders[0].confirmationEmailStatus).toBe('pending');
    }, 15000);

    test('replays the same create-order response for the same idempotency key without duplicating orders or capture tasks', async () => {
        const product = await makeProduct({ stock: 4, price: 1500 });
        const user = await makeUser();

        const body = {
            orderItems: [{ product: product.id, quantity: 1 }],
            shippingAddress: {
                address: 'Sector 9',
                city: 'Bengaluru',
                postalCode: '560001',
                country: 'India',
            },
            paymentMethod: 'CARD',
            checkoutSource: 'directBuy',
        };

        const quote = await buildOrderQuote(body);
        const intent = await makeAuthorizedIntent({
            userId: user._id,
            amount: quote.pricing.totalPrice,
            method: 'CARD',
        });

        const payload = {
            ...body,
            paymentIntentId: intent.intentId,
            quoteSnapshot: { totalPrice: quote.pricing.totalPrice },
        };

        const first = await invokeAddOrderItems({
            user: { _id: user._id, email: user.email, name: user.name },
            body: payload,
            idempotencyKey: 'order-create-beta',
        });
        const second = await invokeAddOrderItems({
            user: { _id: user._id, email: user.email, name: user.name },
            body: payload,
            idempotencyKey: 'order-create-beta',
        });

        expect(first.nextError).toBeNull();
        expect(second.nextError).toBeNull();
        expect(first.res.statusCode).toBe(201);
        expect(second.res.statusCode).toBe(201);
        expect(String(second.res.payload._id)).toBe(String(first.res.payload._id));

        const orders = await Order.find({ user: user._id }).lean();
        const outboxTasks = await PaymentOutboxTask.find({ taskType: 'capture', intentId: intent.intentId }).lean();
        const idempotencyRecords = await IdempotencyRecord.find({ key: 'order-create-beta' }).lean();

        expect(orders).toHaveLength(1);
        expect(outboxTasks).toHaveLength(1);
        expect(idempotencyRecords).toHaveLength(1);
    }, 15000);

    test('rejects a second order attempt with a different idempotency key against an already-consumed intent', async () => {
        const product = await makeProduct({ stock: 4, price: 1200 });
        const user = await makeUser();

        const body = {
            orderItems: [{ product: product.id, quantity: 1 }],
            shippingAddress: {
                address: 'MG Road',
                city: 'Mumbai',
                postalCode: '400001',
                country: 'India',
            },
            paymentMethod: 'CARD',
            checkoutSource: 'directBuy',
        };

        const quote = await buildOrderQuote(body);
        const intent = await makeAuthorizedIntent({
            userId: user._id,
            amount: quote.pricing.totalPrice,
            method: 'CARD',
        });

        const payload = {
            ...body,
            paymentIntentId: intent.intentId,
            quoteSnapshot: { totalPrice: quote.pricing.totalPrice },
        };

        const first = await invokeAddOrderItems({
            user: { _id: user._id, email: user.email, name: user.name },
            body: payload,
            idempotencyKey: 'order-create-gamma-1',
        });
        const second = await invokeAddOrderItems({
            user: { _id: user._id, email: user.email, name: user.name },
            body: payload,
            idempotencyKey: 'order-create-gamma-2',
        });

        expect(first.nextError).toBeNull();
        expect(second.nextError).toBeTruthy();
        expect(second.nextError.statusCode).toBe(409);
        expect(second.nextError.message).toMatch(/already being used/i);

        const orders = await Order.find({ user: user._id }).lean();
        expect(orders).toHaveLength(1);
    }, 15000);
});
