const express = require('express');
const request = require('supertest');

const mockAuthUsers = new Map();

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        const user = mockAuthUsers.get(token);
        if (!user) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
        req.user = user;
        req.authUid = user.authUid || String(user._id);
        req.authToken = {
            uid: req.authUid,
            email: user.email,
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        return next();
    },
    requireOtpAssurance: (_req, _res, next) => next(),
    requireActiveAccount: (_req, _res, next) => next(),
    admin: (_req, res) => res.status(403).json({ message: 'Not authorized as an admin' }),
    protectOptional: (_req, _res, next) => next(),
    seller: (_req, res) => res.status(403).json({ message: 'Seller account required' }),
    invalidateUserCache: jest.fn(),
    invalidateUserCacheByEmail: jest.fn(),
}));

jest.mock('../services/email/orderEmailQueueService', () => ({
    enqueueOrderPlacedEmail: jest.fn(async () => null),
}));

jest.mock('../services/cartRealtimeService', () => ({
    emitCartRealtimeUpdate: jest.fn(),
}));

const Order = require('../models/Order');
const Product = require('../models/Product');
const orderRoutes = require('../routes/orderRoutes');
const {
    assertSafeStatus,
    buildBearer,
    createFakeProduct,
    createTestUser,
    expectDocumentUnchanged,
} = require('./helpers/securityTestHelpers');

const register = (token, user) => {
    mockAuthUsers.set(token, {
        _id: user._id,
        id: String(user._id),
        email: user.email,
        phone: user.phone,
        name: user.name,
        authUid: user.authUid,
        accountState: user.accountState || 'active',
        authAssurance: 'password+otp',
        authAssuranceAuthTime: Math.floor(Date.now() / 1000),
        loginOtpAssuranceExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
};

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/orders', orderRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message || 'Internal Server Error',
            code: err.code,
        });
    });
    return app;
};

const shippingAddress = {
    address: '42 Checkout Road',
    city: 'Bengaluru',
    postalCode: '560001',
    country: 'India',
};

const directBuyBody = (product, overrides = {}) => ({
    orderItems: [{ product: product.id, quantity: 1 }],
    shippingAddress,
    paymentMethod: 'COD',
    checkoutSource: 'directBuy',
    ...overrides,
});

describe('e-commerce business logic security', () => {
    let app;
    let user;

    beforeEach(async () => {
        mockAuthUsers.clear();
        app = buildApp();
        user = await createTestUser({ name: 'Business Logic User' });
        register('token-user', user);
    });

    test.each([
        ['negative quantity', -1],
        ['zero quantity', 0],
    ])('checkout rejects %s and does not create an order or change stock', async (_label, quantity) => {
        const product = await createFakeProduct({ stock: 5, price: 1200 });
        const beforeProduct = await Product.findById(product._id).lean();
        const beforeOrders = await Order.countDocuments({ user: user._id });

        const response = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', `bad-qty-${quantity}-security`)
            .send(directBuyBody(product, {
                orderItems: [{ product: product.id, quantity }],
            }));

        assertSafeStatus(response, [400]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
        await expect(Order.countDocuments({ user: user._id })).resolves.toBe(beforeOrders);
    });

    test('checkout rejects out-of-stock item and leaves inventory unchanged', async () => {
        const product = await createFakeProduct({ stock: 0, price: 999 });
        const beforeProduct = await Product.findById(product._id).lean();
        const beforeOrders = await Order.countDocuments({ user: user._id });

        const response = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'out-of-stock-security')
            .send(directBuyBody(product));

        assertSafeStatus(response, [400, 404, 409]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
        await expect(Order.countDocuments({ user: user._id })).resolves.toBe(beforeOrders);
    });

    test('checkout rejects disabled product and leaves database state unchanged', async () => {
        const product = await createFakeProduct({ stock: 5, price: 999, isActive: false });
        const beforeProduct = await Product.findById(product._id).lean();
        const beforeOrders = await Order.countDocuments({ user: user._id });

        const response = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'disabled-product-security')
            .send(directBuyBody(product));

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
        await expect(Order.countDocuments({ user: user._id })).resolves.toBe(beforeOrders);
    });

    test('checkout rejects unpublished product and leaves database state unchanged', async () => {
        const product = await createFakeProduct({ stock: 5, price: 999, isPublished: false });
        const beforeProduct = await Product.findById(product._id).lean();
        const beforeOrders = await Order.countDocuments({ user: user._id });

        const response = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'unpublished-product-security')
            .send(directBuyBody(product));

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
        await expect(Order.countDocuments({ user: user._id })).resolves.toBe(beforeOrders);
    });

    test('checkout rejects client-manipulated quote totals and does not reserve stock', async () => {
        const product = await createFakeProduct({ stock: 4, price: 2500 });
        const beforeProduct = await Product.findById(product._id).lean();
        const beforeOrders = await Order.countDocuments({ user: user._id });

        const response = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'manipulated-total-security')
            .send(directBuyBody(product, {
                quoteSnapshot: {
                    totalPrice: 1,
                    pricingVersion: 'attacker-price',
                },
                totalPrice: 1,
                shippingPrice: -999,
            }));

        assertSafeStatus(response, [409]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
        await expect(Order.countDocuments({ user: user._id })).resolves.toBe(beforeOrders);
    });

    test('fake frontend payment success cannot create a paid digital order without a valid intent', async () => {
        const product = await createFakeProduct({ stock: 4, price: 2500 });
        const beforeProduct = await Product.findById(product._id).lean();
        const beforeOrders = await Order.countDocuments({ user: user._id });

        const response = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'fake-payment-success-security')
            .send(directBuyBody(product, {
                paymentMethod: 'CARD',
                isPaid: true,
                paidAt: new Date().toISOString(),
                paymentState: 'captured',
                paymentResult: {
                    id: 'pay_fake_frontend',
                    status: 'captured',
                },
            }));

        assertSafeStatus(response, [400]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
        await expect(Order.countDocuments({ user: user._id })).resolves.toBe(beforeOrders);
    });

    test('duplicate checkout idempotency does not create a second order or reduce stock twice', async () => {
        const product = await createFakeProduct({ stock: 5, price: 1500 });
        const body = directBuyBody(product);

        const first = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'duplicate-checkout-security')
            .send(body);
        expect(first.statusCode).toBe(201);

        const second = await request(app)
            .post('/api/orders')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'duplicate-checkout-security')
            .send(body);
        expect(second.statusCode).toBe(201);

        const orders = await Order.find({ user: user._id }).lean();
        expect(orders).toHaveLength(1);
        const refreshedProduct = await Product.findById(product._id).lean();
        expect(refreshedProduct.stock).toBe(4);
    });
});
