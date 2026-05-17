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
    protectOptional: (_req, _res, next) => next(),
    requireOtpAssurance: (_req, _res, next) => next(),
    requireActiveAccount: (req, res, next) => {
        if (req.user?.accountState === 'suspended') {
            return res.status(423).json({ message: 'Account suspended' });
        }
        return next();
    },
    admin: (req, res, next) => (req.user?.isAdmin
        ? next()
        : res.status(403).json({ message: 'Not authorized as an admin' })),
    seller: (req, res, next) => (req.user?.isSeller
        ? next()
        : res.status(403).json({ message: 'Seller account required' })),
    invalidateUserCache: jest.fn(),
    invalidateUserCacheByEmail: jest.fn(),
}));

const User = require('../models/User');
const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentMethod = require('../models/PaymentMethod');
const orderRoutes = require('../routes/orderRoutes');
const userRoutes = require('../routes/userRoutes');
const paymentRoutes = require('../routes/paymentRoutes');
const {
    assertSafeStatus,
    buildBearer,
    createAdminUser,
    createFakeOrder,
    createFakePaymentIntent,
    createFakePaymentMethod,
    createFakeProduct,
    createTestUser,
    expectDocumentUnchanged,
    objectId,
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
        isSeller: Boolean(user.isSeller),
        accountState: user.accountState || 'active',
        softDeleted: Boolean(user.softDeleted),
        authAssurance: 'password+otp',
        authAssuranceAuthTime: Math.floor(Date.now() / 1000),
        loginOtpAssuranceExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
};

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/orders', orderRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message || 'Internal Server Error',
            code: err.code,
        });
    });
    return app;
};

describe('IDOR/BOLA security coverage', () => {
    let app;
    let userA;
    let userB;
    let adminUser;

    beforeEach(async () => {
        mockAuthUsers.clear();
        app = buildApp();
        userA = await createTestUser({ name: 'IDOR User A' });
        userB = await createTestUser({
            name: 'IDOR User B',
            addresses: [{
                type: 'home',
                name: 'Victim Address',
                phone: '9876543210',
                address: 'Victim private lane',
                city: 'Delhi',
                state: 'Delhi',
                pincode: '110001',
                isDefault: true,
            }],
        });
        adminUser = await createAdminUser({ name: 'IDOR Admin' });
        register('token-user-a', userA);
        register('token-user-b', userB);
        register('token-admin', adminUser);
    });

    test('user cannot read another user order timeline and victim order remains unchanged', async () => {
        const victimOrder = await createFakeOrder({ userId: userB._id });
        const before = await Order.findById(victimOrder._id).lean();

        const response = await request(app)
            .get(`/api/orders/${victimOrder._id}/timeline`)
            .set('Authorization', buildBearer('token-user-a'));

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(Order, victimOrder._id, before);
        expect(JSON.stringify(response.body)).not.toContain(userB.email);
    });

    test('user cannot cancel another user order or restore victim inventory', async () => {
        const product = await createFakeProduct({ stock: 3, price: 1299 });
        const victimOrder = await createFakeOrder({ userId: userB._id, product, totalPrice: 1299 });
        const beforeOrder = await Order.findById(victimOrder._id).lean();
        const beforeProduct = await product.constructor.findById(product._id).lean();

        const response = await request(app)
            .post(`/api/orders/${victimOrder._id}/cancel`)
            .set('Authorization', buildBearer('token-user-a'))
            .send({ reason: 'attacker cancel attempt' });

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(Order, victimOrder._id, beforeOrder);
        await expectDocumentUnchanged(product.constructor, product._id, beforeProduct);
    });

    test('user cannot create command-center refund request for another user order', async () => {
        const victimOrder = await createFakeOrder({ userId: userB._id, totalPrice: 2500 });
        const before = await Order.findById(victimOrder._id).lean();

        const response = await request(app)
            .post(`/api/orders/${victimOrder._id}/command-center/refund`)
            .set('Authorization', buildBearer('token-user-a'))
            .send({ reason: 'refund to attacker', amount: 1000 });

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(Order, victimOrder._id, before);
    });

    test('user cannot read another user payment intent or leak owner profile', async () => {
        const victimIntent = await createFakePaymentIntent({ userId: userB._id, status: 'authorized' });
        const before = await PaymentIntent.findById(victimIntent._id).lean();

        const response = await request(app)
            .get(`/api/payments/intents/${victimIntent.intentId}`)
            .set('Authorization', buildBearer('token-user-a'));

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(PaymentIntent, victimIntent._id, before);
        expect(JSON.stringify(response.body)).not.toContain(userB.email);
        expect(JSON.stringify(response.body)).not.toContain(userB.phone);
    });

    test('user cannot delete another user saved payment method', async () => {
        const victimMethod = await createFakePaymentMethod({ userId: userB._id, isDefault: true });
        const before = await PaymentMethod.findById(victimMethod._id).lean();

        const response = await request(app)
            .delete(`/api/payments/methods/${victimMethod._id}`)
            .set('Authorization', buildBearer('token-user-a'));

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(PaymentMethod, victimMethod._id, before);
    });

    test('user cannot set another user payment method as default', async () => {
        const victimMethod = await createFakePaymentMethod({ userId: userB._id, isDefault: false });
        const before = await PaymentMethod.findById(victimMethod._id).lean();

        const response = await request(app)
            .patch(`/api/payments/methods/${victimMethod._id}/default`)
            .set('Authorization', buildBearer('token-user-a'));

        assertSafeStatus(response, [404]);
        await expectDocumentUnchanged(PaymentMethod, victimMethod._id, before);
    });

    test('user cannot update or delete another user embedded address by id', async () => {
        const victimBefore = await User.findById(userB._id).lean();
        const victimAddressId = victimBefore.addresses[0]._id;

        const updateResponse = await request(app)
            .put(`/api/users/addresses/${victimAddressId}`)
            .set('Authorization', buildBearer('token-user-a'))
            .send({
                address: 'Attacker rewritten lane',
                city: 'Mumbai',
                state: 'Maharashtra',
                pincode: '400001',
                name: 'Attacker',
                phone: '+919999999999',
                type: 'home',
                isDefault: true,
            });

        assertSafeStatus(updateResponse, [404]);
        await expectDocumentUnchanged(User, userB._id, victimBefore);

        const deleteResponse = await request(app)
            .delete(`/api/users/addresses/${victimAddressId}`)
            .set('Authorization', buildBearer('token-user-a'));

        assertSafeStatus(deleteResponse, [404]);
        await expectDocumentUnchanged(User, userB._id, victimBefore);
    });

    test('list endpoints return only the current user resources', async () => {
        const ownOrder = await createFakeOrder({ userId: userA._id, totalPrice: 1001 });
        const victimOrder = await createFakeOrder({ userId: userB._id, totalPrice: 2002 });

        const response = await request(app)
            .get('/api/orders/myorders')
            .set('Authorization', buildBearer('token-user-a'));

        expect(response.statusCode).toBe(200);
        const responseText = JSON.stringify(response.body);
        expect(responseText).toContain(String(ownOrder._id));
        expect(responseText).not.toContain(String(victimOrder._id));
        expect(responseText).not.toContain(userB.email);
    });

    test('random valid object ids return safe not-found without creating records', async () => {
        const beforeCount = await Order.countDocuments();
        const response = await request(app)
            .get(`/api/orders/${objectId()}/command-center`)
            .set('Authorization', buildBearer('token-user-a'));

        assertSafeStatus(response, [404]);
        await expect(Order.countDocuments()).resolves.toBe(beforeCount);
    });
});
