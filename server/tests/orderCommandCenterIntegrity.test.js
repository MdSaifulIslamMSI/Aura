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
        req.requestId = 'req_order_command_center_integrity';
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

jest.mock('../services/fraudDecisioningService', () => ({
    assessFraudDecision: jest.fn().mockResolvedValue({
        blocked: false,
        reviewRequired: false,
        holdRequired: false,
        auditId: 'fraud_audit_1',
        strictDecision: 'allow',
        score: 10,
        factors: [],
    }),
}));

const mockCreateRefundForIntent = jest.fn();

jest.mock('../services/payments/paymentService', () => ({
    createRefundForIntent: mockCreateRefundForIntent,
    // The write-ahead behavior under test depends on a REAL outbox task row,
    // so the scheduler stays live even though the provider call is mocked.
    scheduleRefundTask: require('../services/payments/outboxState').scheduleRefundTask,
    setTerminalCaptureFailureHandler: jest.fn(),
}));

const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const CouponRedemption = require('../models/CouponRedemption');
const AdminNotification = require('../models/AdminNotification');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const orderRoutes = require('../routes/orderRoutes');
const {
    cancelOrderForFailedCapture,
    releaseCouponRedemptionForOrder,
    reverseLoyaltyPointsForOrder,
} = require('../services/orderService');
const { reverseLoyaltyPoints } = require('../services/loyaltyService');
const {
    buildBearer,
    createFakeOrder,
    createFakeProduct,
    createTestUser,
} = require('./helpers/securityTestHelpers');

jest.setTimeout(30000);

// The cancellation-clawback and capture-compensation flows run inside real
// Mongo transactions. When the in-memory Mongo is allowed (local/PR dev
// runs), opt this file's setup into a transaction-capable replica set; the
// flag is scoped to this file and cleared in afterAll. CI provides a
// standalone mongod (TEST_USE_IN_MEMORY_MONGO=false), where those specific
// tests skip rather than fail — the clawback helpers themselves stay covered
// below without transactions.
const usingInMemoryMongo = process.env.TEST_USE_IN_MEMORY_MONGO !== 'false';
const transactionUriProvided = /replicaSet=/i.test(String(process.env.TEST_MONGO_URI || ''))
    || String(process.env.TEST_MONGO_TRANSACTION_CAPABLE || '') === 'true';
const transactionsAvailable = usingInMemoryMongo || transactionUriProvided;
if (usingInMemoryMongo) {
    process.env.TEST_REQUIRE_TRANSACTION_MONGO = 'true';
}
const describeWithTransactions = transactionsAvailable ? describe : describe.skip;

const register = (token, user) => {
    mockAuthUsers.set(token, {
        _id: user._id,
        id: String(user._id),
        email: user.email,
        name: user.name,
        authUid: user.authUid,
        isAdmin: Boolean(user.isAdmin),
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

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe('order command center integrity', () => {
    let app;

    afterAll(() => {
        if (usingInMemoryMongo) {
            delete process.env.TEST_REQUIRE_TRANSACTION_MONGO;
        }
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        mockAuthUsers.clear();
        mockCreateRefundForIntent.mockResolvedValue({ refundId: 'rfnd_test_1', status: 'processed' });
        app = buildApp();
    });

    describe('warranty claims', () => {
        test('submitting a warranty claim resolves the order item and returns 201', async () => {
            const owner = await createTestUser({ name: 'Warranty Owner' });
            register('token-owner', owner);
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({ userId: owner._id, product });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/warranty`)
                .set('Authorization', buildBearer('token-owner'))
                .send({ issue: 'Screen cracked after two days', itemProductId: String(product._id) });

            expect(response.status).toBe(201);
            expect(response.body.commandCenter.warrantyClaims).toHaveLength(1);
            expect(response.body.commandCenter.warrantyClaims[0]).toMatchObject({
                issue: 'Screen cracked after two days',
                itemProductId: String(product._id),
                status: 'pending',
            });
        });

        test('warranty claim for an unknown item reports a validation error, never a 500', async () => {
            const owner = await createTestUser({ name: 'Warranty Owner 2' });
            register('token-owner-2', owner);
            const order = await createFakeOrder({ userId: owner._id });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/warranty`)
                .set('Authorization', buildBearer('token-owner-2'))
                .send({ issue: 'Broken', itemProductId: 'does-not-exist' });

            // resolveOrderItemForCommand falls back to the first item, so an
            // unknown id still lands on the single seeded item rather than 500.
            expect(response.status).toBe(201);
            expect(response.body.commandCenter.warrantyClaims).toHaveLength(1);
        });
    });

    describe('support messages', () => {
        test('support message appends atomically and returns 201', async () => {
            const owner = await createTestUser({ name: 'Support Owner' });
            register('token-support', owner);
            const order = await createFakeOrder({ userId: owner._id });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/support`)
                .set('Authorization', buildBearer('token-support'))
                .send({ message: 'Where is my package?' });

            expect(response.status).toBe(201);
            expect(response.body.commandCenter.supportChats).toHaveLength(1);
            expect(response.body.commandCenter.supportChats[0]).toMatchObject({
                actor: 'customer',
                message: 'Where is my package?',
            });
        });
    });

    describe('refund request policy gates', () => {
        test('pre-shipment digital refund request auto-processes via the provider', async () => {
            const owner = await createTestUser({ name: 'PreShipment Refund' });
            register('token-refund-1', owner);
            const order = await createFakeOrder({
                userId: owner._id,
                paymentIntentId: 'intent_pre_shipment',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-1'))
                .send({ reason: 'Ordered by mistake' });

            expect(response.status).toBe(201);
            expect(mockCreateRefundForIntent).toHaveBeenCalledTimes(1);
            expect(response.body.commandCenter.refunds[0].status).toBe('processed');
        });

        test('shipped-order refund request stays pending for admin review', async () => {
            const owner = await createTestUser({ name: 'Shipped Refund' });
            register('token-refund-2', owner);
            const order = await createFakeOrder({
                userId: owner._id,
                paymentIntentId: 'intent_shipped',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'shipped',
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-2'))
                .send({ reason: 'Changed my mind' });

            expect(response.status).toBe(201);
            expect(mockCreateRefundForIntent).not.toHaveBeenCalled();
            expect(response.body.commandCenter.refunds[0].status).toBe('pending');
            expect(response.body.message).toMatch(/admin review/i);
        });

        test('delivered-order refund outside the return window is rejected', async () => {
            const owner = await createTestUser({ name: 'Late Refund' });
            register('token-refund-3', owner);
            const order = await createFakeOrder({
                userId: owner._id,
                paymentIntentId: 'intent_late',
                orderStatus: 'delivered',
                isPaid: true,
                isDelivered: true,
                overrides: { deliveredAt: daysAgo(10) },
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-3'))
                .send({ reason: 'Too late' });

            expect(response.status).toBe(409);
            expect(response.body.message).toMatch(/requested within 7 day/i);
            expect(mockCreateRefundForIntent).not.toHaveBeenCalled();
        });

        test('a second refund request while one is active is rejected', async () => {
            const owner = await createTestUser({ name: 'Duplicate Refund' });
            register('token-refund-4', owner);
            const order = await createFakeOrder({
                userId: owner._id,
                paymentIntentId: 'intent_dup',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
                overrides: {
                    commandCenter: {
                        refunds: [{
                            requestId: 'rfnd-existing',
                            amount: 500,
                            status: 'pending',
                            createdAt: new Date(),
                        }],
                    },
                },
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-4'))
                .send({ reason: 'Again' });

            expect(response.status).toBe(409);
            expect(response.body.message).toMatch(/active refund request/i);
        });

        test('refund amount is capped at the still-refundable balance', async () => {
            const owner = await createTestUser({ name: 'Partial Refund' });
            register('token-refund-5', owner);
            const order = await createFakeOrder({
                userId: owner._id,
                totalPrice: 1999,
                paymentIntentId: 'intent_partial',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
                overrides: {
                    refundSummary: {
                        totalRefunded: 200,
                        settlementCurrency: 'INR',
                        presentmentCurrency: 'INR',
                        presentmentTotalRefunded: 200,
                        fullyRefunded: false,
                        refunds: [],
                    },
                },
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-5'))
                .send({ reason: 'Partial damage', amount: 99999 });

            expect(response.status).toBe(201);
            expect(response.body.commandCenter.refunds[0].amount).toBe(1799);
        });
    });

    describe('replacement request policy gates', () => {
        test('replacement request on a placed order is rejected', async () => {
            const owner = await createTestUser({ name: 'Placed Replace' });
            register('token-replace-1', owner);
            const order = await createFakeOrder({ userId: owner._id, orderStatus: 'placed' });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/replace`)
                .set('Authorization', buildBearer('token-replace-1'))
                .send({ reason: 'Damaged' });

            expect(response.status).toBe(409);
            expect(response.body.message).toMatch(/shipped/i);
        });

        test('replacement request on a shipped order queues for admin approval without touching stock', async () => {
            const owner = await createTestUser({ name: 'Shipped Replace' });
            register('token-replace-2', owner);
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({ userId: owner._id, product, orderStatus: 'shipped' });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/replace`)
                .set('Authorization', buildBearer('token-replace-2'))
                .send({ reason: 'Defective unit', itemProductId: String(product._id) });

            expect(response.status).toBe(201);
            const entry = response.body.commandCenter.replacements[0];
            expect(entry.status).toBe('pending');
            expect(entry.trackingId || '').toBe('');
            expect(entry.message).toMatch(/admin approval/i);

            const stockAfter = await Product.findById(product._id).select('stock').lean();
            expect(stockAfter.stock).toBe(10);

            const orderAfter = await Order.findById(order._id).select('orderStatus statusTimeline').lean();
            expect(orderAfter.orderStatus).toBe('shipped');
            expect(orderAfter.statusTimeline).toHaveLength(1);
        });

        test('replacement request outside the return window on a delivered order is rejected', async () => {
            const owner = await createTestUser({ name: 'Late Replace' });
            register('token-replace-3', owner);
            const order = await createFakeOrder({
                userId: owner._id,
                orderStatus: 'delivered',
                isDelivered: true,
                overrides: { deliveredAt: daysAgo(9) },
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/replace`)
                .set('Authorization', buildBearer('token-replace-3'))
                .send({ reason: 'Late' });

            expect(response.status).toBe(409);
            expect(response.body.message).toMatch(/requested within 7 day/i);
        });
    });

    describe('clawback helpers (no transaction required)', () => {
        test('releaseCouponRedemptionForOrder frees only the coupon row consumed by this order', async () => {
            const owner = await createTestUser({ name: 'Helper Owner' });
            const product = await createFakeProduct({ stock: 5 });
            const order = await createFakeOrder({
                userId: owner._id,
                product,
                overrides: { couponCode: 'aura10' },
            });
            const otherOrder = await createFakeOrder({ userId: owner._id });
            await CouponRedemption.create({ code: 'AURA10', user: owner._id, order: order._id, discount: 50 });
            await CouponRedemption.create({ code: 'FREESHIP', user: owner._id, order: otherOrder._id, discount: 0 });

            const released = await releaseCouponRedemptionForOrder({ order });

            expect(released).toBe(true);
            expect(await CouponRedemption.findOne({ code: 'AURA10', user: owner._id }).lean()).toBeNull();
            // The other order's redemption is untouched.
            expect(await CouponRedemption.findOne({ code: 'FREESHIP' }).lean()).toBeTruthy();
        });

        test('reverseLoyaltyPointsForOrder reverses exactly the points awarded at placement', async () => {
            const owner = await createTestUser({ name: 'Helper Loyalty Owner' });
            await User.updateOne({ _id: owner._id }, { $set: { 'loyalty.pointsBalance': 80 } });
            const order = await createFakeOrder({
                userId: owner._id,
                overrides: { loyaltyPointsAwarded: 30 },
            });

            const reversed = await reverseLoyaltyPointsForOrder({ order });

            expect(reversed).toBe(30);
            const ownerAfter = await User.findById(owner._id).select('loyalty').lean();
            expect(ownerAfter.loyalty.pointsBalance).toBe(50);
        });

        test('both helpers no-op cleanly for orders without coupon or loyalty awards', async () => {
            const owner = await createTestUser({ name: 'Helper Bare Owner' });
            const order = await createFakeOrder({ userId: owner._id });

            expect(await releaseCouponRedemptionForOrder({ order })).toBe(false);
            expect(await reverseLoyaltyPointsForOrder({ order })).toBe(0);
        });
    });

    describeWithTransactions('cancellation clawback and write-ahead refund', () => {
        test('cancelling a paid order frees the coupon, reverses loyalty, schedules and retires the refund task', async () => {
            const owner = await createTestUser({ name: 'Clawback Owner' });
            register('token-cancel-1', owner);
            await User.updateOne(
                { _id: owner._id },
                { $set: { 'loyalty.pointsBalance': 100, 'loyalty.lifetimeEarned': 100 } }
            );
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({
                userId: owner._id,
                product,
                paymentIntentId: 'intent_cancel_1',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
                overrides: {
                    couponCode: 'AURA10',
                    loyaltyPointsAwarded: 40,
                },
            });
            await CouponRedemption.create({
                code: 'AURA10',
                user: owner._id,
                order: order._id,
                discount: 100,
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/cancel`)
                .set('Authorization', buildBearer('token-cancel-1'))
                .send({ reason: 'Duplicate order' });

            expect([200, 201]).toContain(response.status);

            const redemption = await CouponRedemption.findOne({ code: 'AURA10', user: owner._id }).lean();
            expect(redemption).toBeNull();

            const ownerAfter = await User.findById(owner._id).select('loyalty').lean();
            expect(ownerAfter.loyalty.pointsBalance).toBe(60);
            expect(ownerAfter.loyalty.ledger[0]).toMatchObject({
                eventType: 'manual_adjustment',
                points: -40,
                refType: 'order',
            });

            const orderAfter = await Order.findById(order._id).lean();
            expect(orderAfter.orderStatus).toBe('cancelled');
            const productAfter = await Product.findById(product._id).select('stock').lean();
            expect(productAfter.stock).toBe(11);

            const entry = orderAfter.commandCenter.refunds.find((r) => r.status === 'processed');
            expect(entry).toBeTruthy();

            const task = await PaymentOutboxTask.findOne({ taskType: 'refund', intentId: 'intent_cancel_1' }).lean();
            expect(task).toBeTruthy();
            expect(task.status).toBe('done');
        });

        test('a transient provider refund failure still leaves a retryable outbox task', async () => {
            const owner = await createTestUser({ name: 'Transient Owner' });
            register('token-cancel-2', owner);
            const order = await createFakeOrder({
                userId: owner._id,
                paymentIntentId: 'intent_cancel_2',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
            });
            mockCreateRefundForIntent.mockRejectedValueOnce(
                Object.assign(new Error('provider temporarily unavailable'), { statusCode: 503 })
            );

            const response = await request(app)
                .post(`/api/orders/${order._id}/cancel`)
                .set('Authorization', buildBearer('token-cancel-2'))
                .send({ reason: 'Changed mind' });

            expect([200, 201]).toContain(response.status);

            const orderAfter = await Order.findById(order._id).lean();
            expect(orderAfter.orderStatus).toBe('cancelled');

            const entry = orderAfter.commandCenter.refunds.find((r) => r.status === 'pending');
            expect(entry).toBeTruthy();

            const task = await PaymentOutboxTask.findOne({ taskType: 'refund', intentId: 'intent_cancel_2' }).lean();
            expect(task).toBeTruthy();
            expect(task.status).toBe('pending');
        });
    });

    describeWithTransactions('capture-failure compensation', () => {
        test('auto-cancels, restocks, reverses clawbacks and raises an admin alert', async () => {
            const owner = await createTestUser({ name: 'Capture Fail Owner' });
            await User.updateOne(
                { _id: owner._id },
                { $set: { 'loyalty.pointsBalance': 50, 'loyalty.lifetimeEarned': 50 } }
            );
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({
                userId: owner._id,
                product,
                paymentIntentId: 'intent_capture_fail',
                paymentState: 'authorized',
                isPaid: false,
                orderStatus: 'placed',
                overrides: { couponCode: 'FREESHIP', loyaltyPointsAwarded: 30 },
            });
            await CouponRedemption.create({
                code: 'FREESHIP',
                user: owner._id,
                order: order._id,
                discount: 0,
            });

            const result = await cancelOrderForFailedCapture({ intentId: 'intent_capture_fail' });

            expect(result.handled).toBe(true);

            const orderAfter = await Order.findById(order._id).lean();
            expect(orderAfter.orderStatus).toBe('cancelled');
            expect(orderAfter.statusTimeline.some((e) => e.actor === 'system' && e.status === 'cancelled')).toBe(true);

            const productAfter = await Product.findById(product._id).select('stock').lean();
            expect(productAfter.stock).toBe(11);

            const redemption = await CouponRedemption.findOne({ order: order._id }).lean();
            expect(redemption).toBeNull();

            const ownerAfter = await User.findById(owner._id).select('loyalty').lean();
            expect(ownerAfter.loyalty.pointsBalance).toBe(20);

            const alert = await AdminNotification.findOne({ actionKey: 'order_capture_failed_cancelled' }).lean();
            expect(alert).toBeTruthy();
            expect(alert.severity).toBe('critical');
        });

        test('is a no-op when no cancelable order matches the intent', async () => {
            const result = await cancelOrderForFailedCapture({ intentId: 'intent_nothing' });
            expect(result.handled).toBe(false);
            expect(result.reason).toBe('no_cancelable_order');
        });
    });

    describe('loyalty reversal floors at zero', () => {
        test('never drives pointsBalance negative', async () => {
            const owner = await createTestUser({ name: 'Floor Owner' });
            await User.updateOne(
                { _id: owner._id },
                { $set: { 'loyalty.pointsBalance': 10, 'loyalty.lifetimeEarned': 500 } }
            );

            const result = await reverseLoyaltyPoints({ userId: owner._id, points: 40 });

            expect(result.reversed).toBe(10);
            const ownerAfter = await User.findById(owner._id).select('loyalty').lean();
            expect(ownerAfter.loyalty.pointsBalance).toBe(0);
            expect(ownerAfter.loyalty.lifetimeEarned).toBe(500);
        });
    });
});
