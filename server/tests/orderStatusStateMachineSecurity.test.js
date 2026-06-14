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
        req.requestId = 'req_order_status_state_machine';
        return next();
    },
    admin: (req, res, next) => {
        if (!req.user?.isAdmin) {
            return res.status(403).json({ message: 'Not authorized as an admin' });
        }
        return next();
    },
    requireOtpAssurance: (_req, _res, next) => next(),
    requireActiveAccount: (_req, _res, next) => next(),
}));

jest.mock('../middleware/routeSecurityGuards', () => ({
    authorizeOrderOwner: () => (_req, _res, next) => next(),
    sensitiveActions: new Proxy({}, { get: () => (_req, _res, next) => next() }),
}));

jest.mock('../trust/middleware/requireTrustDecision', () => ({
    requireTrustDecision: () => (_req, _res, next) => next(),
}));

jest.mock('../services/email/adminActionEmailService', () => ({
    notifyAdminActionToUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/notificationService', () => ({
    sendPersistentNotification: jest.fn().mockResolvedValue(null),
}));

const mockCreateRefundForIntent = jest.fn();
const mockScheduleRefundTask = jest.fn();

jest.mock('../services/payments/paymentService', () => ({
    createRefundForIntent: mockCreateRefundForIntent,
    scheduleRefundTask: mockScheduleRefundTask,
}));

const Order = require('../models/Order');
const Product = require('../models/Product');
const orderRoutes = require('../routes/orderRoutes');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const { notifyAdminActionToUser } = require('../services/email/adminActionEmailService');
const { sendPersistentNotification } = require('../services/notificationService');
const {
    assertSafeStatus,
    buildBearer,
    createAdminUser,
    createFakeOrder,
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
    });
};

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/orders', orderRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message || 'Internal Server Error',
        });
    });
    return app;
};

describe('order status state-machine security', () => {
    let app;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockAuthUsers.clear();
        app = buildApp();
    });

    test('admin cannot ship an unpaid digital order or trigger status side effects', async () => {
        const owner = await createTestUser({ name: 'Unpaid Digital Buyer' });
        const admin = await createAdminUser({ name: 'Fulfillment Admin' });
        register('token-admin', admin);
        const order = await createFakeOrder({
            userId: owner._id,
            paymentMethod: 'CARD',
            paymentState: PAYMENT_STATUSES.CREATED,
            orderStatus: 'placed',
            isPaid: false,
        });
        const beforeOrder = await Order.findById(order._id).lean();

        const response = await request(app)
            .patch(`/api/orders/${order._id}/status`)
            .set('Authorization', buildBearer('token-admin'))
            .send({
                status: 'shipped',
                note: 'Attempt to ship before online payment settlement',
            });

        assertSafeStatus(response, [409]);
        expect(response.body.message).toMatch(/payment/i);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        expect(notifyAdminActionToUser).not.toHaveBeenCalled();
        expect(sendPersistentNotification).not.toHaveBeenCalled();
    });

    test('admin cannot cancel an already shipped paid order or trigger refund side effects', async () => {
        const owner = await createTestUser({ name: 'Shipped Cancel Buyer' });
        const admin = await createAdminUser({ name: 'Fulfillment Admin Cancel' });
        register('token-admin', admin);
        const order = await createFakeOrder({
            userId: owner._id,
            paymentMethod: 'CARD',
            paymentIntentId: 'pi_shipped_cancel_guard',
            paymentState: PAYMENT_STATUSES.CAPTURED,
            orderStatus: 'shipped',
            isPaid: true,
        });
        const productId = order.orderItems[0].product;
        const beforeOrder = await Order.findById(order._id).lean();
        const beforeProduct = await Product.findById(productId).lean();

        const response = await request(app)
            .post(`/api/orders/${order._id}/admin-cancel`)
            .set('Authorization', buildBearer('token-admin'))
            .send({ reason: 'Attempt to cancel after shipment handoff' });

        assertSafeStatus(response, [409]);
        expect(response.body.message).toMatch(/shipped/i);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        await expectDocumentUnchanged(Product, productId, beforeProduct);
        expect(mockCreateRefundForIntent).not.toHaveBeenCalled();
        expect(mockScheduleRefundTask).not.toHaveBeenCalled();
        expect(notifyAdminActionToUser).not.toHaveBeenCalled();
        expect(sendPersistentNotification).not.toHaveBeenCalled();
    });

    test('buyer cannot create a replacement after the order has been fully refunded', async () => {
        const owner = await createTestUser({ name: 'Fully Refunded Replacement Buyer' });
        register('token-owner', owner);
        const order = await createFakeOrder({
            userId: owner._id,
            paymentMethod: 'CARD',
            paymentIntentId: 'pi_fully_refunded_replace_guard',
            paymentState: PAYMENT_STATUSES.REFUNDED,
            orderStatus: 'delivered',
            isPaid: true,
            isDelivered: true,
            overrides: {
                refundSummary: {
                    totalRefunded: 1999,
                    settlementCurrency: 'INR',
                    presentmentCurrency: 'INR',
                    presentmentTotalRefunded: 1999,
                    fullyRefunded: true,
                    refunds: [{
                        refundId: 'rfnd_completed_replace_guard',
                        amount: 1999,
                        status: 'processed',
                        processedAt: new Date('2026-06-14T01:00:00.000Z'),
                    }],
                },
            },
        });
        const productId = order.orderItems[0].product;
        const beforeOrder = await Order.findById(order._id).lean();
        const beforeProduct = await Product.findById(productId).lean();

        const response = await request(app)
            .post(`/api/orders/${order._id}/command-center/replace`)
            .set('Authorization', buildBearer('token-owner'))
            .send({
                reason: 'Attempt replacement after refund completion',
                quantity: 1,
            });

        assertSafeStatus(response, [409]);
        expect(response.body.message).toMatch(/refund/i);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        await expectDocumentUnchanged(Product, productId, beforeProduct);
        expect(notifyAdminActionToUser).not.toHaveBeenCalled();
        expect(sendPersistentNotification).not.toHaveBeenCalled();
    });
});
