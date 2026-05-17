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
    admin: (req, res, next) => {
        if (req.user?.softDeleted || req.user?.accountState === 'deleted' || req.user?.accountState === 'suspended') {
            return res.status(403).json({ message: 'Admin account is not active' });
        }
        if (!req.user?.isAdmin) {
            return res.status(403).json({ message: 'Not authorized as an admin' });
        }
        return next();
    },
    protectOptional: (_req, _res, next) => next(),
    requireOtpAssurance: (_req, _res, next) => next(),
    requireActiveAccount: (_req, _res, next) => next(),
    seller: (_req, res) => res.status(403).json({ message: 'Seller account required' }),
    invalidateUserCache: jest.fn(),
    invalidateUserCacheByEmail: jest.fn(),
}));

const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const adminUserRoutes = require('../routes/adminUserRoutes');
const adminProductRoutes = require('../routes/adminProductRoutes');
const adminPaymentRoutes = require('../routes/adminPaymentRoutes');
const orderRoutes = require('../routes/orderRoutes');
const {
    assertSafeStatus,
    buildBearer,
    createAdminUser,
    createBlockedUser,
    createDeletedUser,
    createFakeOrder,
    createFakePaymentIntent,
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
        isAdmin: Boolean(user.isAdmin),
        adminRoles: user.adminRoles || [],
        accountState: user.accountState || 'active',
        softDeleted: Boolean(user.softDeleted),
    });
};

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/users', adminUserRoutes);
    app.use('/api/admin/products', adminProductRoutes);
    app.use('/api/admin/payments', adminPaymentRoutes);
    app.use('/api/orders', orderRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message || 'Internal Server Error',
        });
    });
    return app;
};

describe('admin privilege escalation security', () => {
    let app;
    let user;
    let adminUser;

    beforeEach(async () => {
        mockAuthUsers.clear();
        app = buildApp();
        user = await createTestUser({ name: 'Privilege User' });
        adminUser = await createAdminUser({ name: 'Privilege Admin' });
        register('token-user', user);
        register('token-admin', adminUser);
    });

    test('normal user cannot call admin user-management endpoints or mutate target user', async () => {
        const target = await createTestUser({ name: 'Target User' });
        const before = await User.findById(target._id).lean();

        const response = await request(app)
            .post(`/api/admin/users/${target._id}/suspend`)
            .set('Authorization', buildBearer('token-user'))
            .send({ reason: 'attacker privilege escalation attempt' });

        assertSafeStatus(response, [403]);
        await expectDocumentUnchanged(User, target._id, before);
    });

    test('normal user cannot access admin user list or user detail', async () => {
        const target = await createTestUser();

        const list = await request(app)
            .get('/api/admin/users')
            .set('Authorization', buildBearer('token-user'));
        assertSafeStatus(list, [403]);

        const detail = await request(app)
            .get(`/api/admin/users/${target._id}`)
            .set('Authorization', buildBearer('token-user'));
        assertSafeStatus(detail, [403]);
        expect(JSON.stringify(list.body)).not.toContain(target.email);
        expect(JSON.stringify(detail.body)).not.toContain(target.email);
    });

    test('normal user cannot create or edit products through admin catalog routes', async () => {
        const product = await createFakeProduct({ price: 4999, stock: 10 });
        const beforeProduct = await Product.findById(product._id).lean();

        const createResponse = await request(app)
            .post('/api/admin/products')
            .set('Authorization', buildBearer('token-user'))
            .send({
                title: 'Attacker Product',
                brand: 'Bad',
                category: 'Bad',
                price: 1,
                image: 'https://example.test/bad.jpg',
                stock: 999,
            });
        assertSafeStatus(createResponse, [403]);

        const priceResponse = await request(app)
            .patch(`/api/admin/products/${product._id}/pricing`)
            .set('Authorization', buildBearer('token-user'))
            .send({ price: 1, stock: 9999 });
        assertSafeStatus(priceResponse, [403]);

        await expectDocumentUnchanged(Product, product._id, beforeProduct);
        await expect(Product.findOne({ title: 'Attacker Product' })).resolves.toBeNull();
    });

    test('normal user cannot mark another order delivered or cancel through admin route', async () => {
        const owner = await createTestUser({ name: 'Order Owner' });
        const order = await createFakeOrder({ userId: owner._id, orderStatus: 'placed' });
        const before = await Order.findById(order._id).lean();

        const statusResponse = await request(app)
            .patch(`/api/orders/${order._id}/status`)
            .set('Authorization', buildBearer('token-user'))
            .send({ status: 'delivered', note: 'attacker delivered' });
        assertSafeStatus(statusResponse, [403]);

        const cancelResponse = await request(app)
            .post(`/api/orders/${order._id}/admin-cancel`)
            .set('Authorization', buildBearer('token-user'))
            .send({ reason: 'attacker cancel' });
        assertSafeStatus(cancelResponse, [403]);

        await expectDocumentUnchanged(Order, order._id, before);
    });

    test('normal user cannot capture or expire payment intents through admin payment routes', async () => {
        const owner = await createTestUser({ name: 'Payment Owner' });
        const intent = await createFakePaymentIntent({ userId: owner._id, status: 'authorized' });
        const before = await PaymentIntent.findById(intent._id).lean();

        const captureResponse = await request(app)
            .post(`/api/admin/payments/${intent.intentId}/capture`)
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'normal-user-capture-denied');
        assertSafeStatus(captureResponse, [403]);

        const expireResponse = await request(app)
            .post('/api/admin/payments/ops/expire-stale')
            .set('Authorization', buildBearer('token-user'))
            .set('Idempotency-Key', 'normal-user-expire-denied')
            .send({ limit: 10 });
        assertSafeStatus(expireResponse, [403]);

        await expectDocumentUnchanged(PaymentIntent, intent._id, before);
    });

    test('deleted or blocked admin accounts cannot use admin routes', async () => {
        const deletedAdmin = await createDeletedUser({ isAdmin: true, adminRoles: ['ADMIN'] });
        const blockedAdmin = await createBlockedUser({ isAdmin: true, adminRoles: ['ADMIN'] });
        register('token-deleted-admin', deletedAdmin);
        register('token-blocked-admin', blockedAdmin);

        const deletedResponse = await request(app)
            .get('/api/admin/users')
            .set('Authorization', buildBearer('token-deleted-admin'));
        assertSafeStatus(deletedResponse, [403]);

        const blockedResponse = await request(app)
            .get('/api/admin/users')
            .set('Authorization', buildBearer('token-blocked-admin'));
        assertSafeStatus(blockedResponse, [403]);
    });
});
