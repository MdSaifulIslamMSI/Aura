const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

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
        req.requestId = 'req_order_lifecycle_delivery';
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
    sendPersistentNotification: jest.fn().mockResolvedValue({ notificationId: 'notif_1' }),
}));

jest.mock('../services/socketService', () => ({
    sendMessageToUser: jest.fn(),
}));

jest.mock('../services/payments/paymentService', () => ({
    createRefundForIntent: jest.fn(),
    scheduleRefundTask: jest.fn(),
    setTerminalCaptureFailureHandler: jest.fn(),
}));

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const AccountPreference = require('../models/AccountPreference');
const AdminNotification = require('../models/AdminNotification');
const ShippingEvent = require('../models/ShippingEvent');
const orderRoutes = require('../routes/orderRoutes');
const shippingRoutes = require('../routes/shippingRoutes');
const { runOrderLifecycleCycle, getAutoCancelCutoff } = require('../services/orderLifecycleWorkerService');
const { emitOrderEventNotification } = require('../services/orderNotificationService');
const { sendMessageToUser } = require('../services/socketService');
const { sendPersistentNotification } = require('../services/notificationService');
const {
    buildBearer,
    createFakeOrder,
    createFakeProduct,
    createTestUser,
    createAdminUser,
} = require('./helpers/securityTestHelpers');

jest.setTimeout(30000);

// The lifecycle worker cancels through the same transactional compensation
// core as the capture-failure path, so this file opts its in-memory setup
// into a replica set (see orderCommandCenterIntegrity.test.js). On CI's
// standalone mongod the transaction-dependent test skips instead of failing.
const usingInMemoryMongo = process.env.TEST_USE_IN_MEMORY_MONGO !== 'false';
const transactionsExpected = usingInMemoryMongo
    || /replicaSet=/i.test(String(process.env.TEST_MONGO_URI || ''))
    || String(process.env.TEST_MONGO_TRANSACTION_CAPABLE || '') === 'true';
const testWithTransactions = transactionsExpected ? test : test.skip;
if (usingInMemoryMongo) {
    process.env.TEST_REQUIRE_TRANSACTION_MONGO = 'true';
}

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

const buildOrderApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/orders', orderRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({ message: err.message || 'Internal Server Error' });
    });
    return app;
};

const buildShippingApp = () => {
    const app = express();
    app.use(express.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf.toString('utf8');
        },
    }));
    app.use('/api/shipping', shippingRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({ message: err.message || 'Internal Server Error' });
    });
    return app;
};

const signShippingPayload = (rawBody, secret = 'test-shipping-secret') => (
    `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
);

const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000);

describe('order lifecycle and delivery engine', () => {
    let orderApp;
    let shippingApp;

    afterAll(() => {
        if (usingInMemoryMongo) {
            delete process.env.TEST_REQUIRE_TRANSACTION_MONGO;
        }
        delete process.env.SHIPPING_WEBHOOK_SECRET_MOCK;
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        mockAuthUsers.clear();
        process.env.SHIPPING_WEBHOOK_SECRET_MOCK = 'test-shipping-secret';
        orderApp = buildOrderApp();
        shippingApp = buildShippingApp();
    });

    describe('shipment dispatch and checkpoints (admin)', () => {
        test('admin dispatch creates a shipped shipment and advances the order', async () => {
            const owner = await createTestUser({ name: 'Dispatch Owner' });
            const admin = await createAdminUser({ name: 'Dispatch Admin' });
            register('token-admin-1', admin);
            const order = await createFakeOrder({ userId: owner._id, orderStatus: 'processing' });

            const response = await request(orderApp)
                .post(`/api/orders/${order._id}/shipments`)
                .set('Authorization', buildBearer('token-admin-1'))
                .send({ courier: 'AuraExpress', trackingId: 'TRK123456', initialStatus: 'shipped' });

            expect(response.status).toBe(201);
            expect(response.body.shipments).toHaveLength(1);
            expect(response.body.shipments[0]).toMatchObject({
                courier: 'AuraExpress',
                trackingId: 'TRK123456',
                status: 'shipped',
            });
            expect(response.body.orderStatus).toBe('shipped');

            const orderAfter = await Order.findById(order._id).lean();
            expect(orderAfter.orderStatus).toBe('shipped');
            expect(orderAfter.statusTimeline.some((e) => e.status === 'shipped' && e.actor === 'admin')).toBe(true);
        });

        test('non-admin cannot dispatch a shipment', async () => {
            const owner = await createTestUser({ name: 'Dispatch Owner 2' });
            register('token-owner-1', owner);
            const order = await createFakeOrder({ userId: owner._id, orderStatus: 'processing' });

            const response = await request(orderApp)
                .post(`/api/orders/${order._id}/shipments`)
                .set('Authorization', buildBearer('token-owner-1'))
                .send({ initialStatus: 'shipped' });

            expect(response.status).toBe(403);
        });

        test('checkpoints advance shipped → out_for_delivery → delivered and sync the order', async () => {
            const owner = await createTestUser({ name: 'Checkpoint Owner' });
            const admin = await createAdminUser({ name: 'Checkpoint Admin' });
            register('token-admin-2', admin);
            const order = await createFakeOrder({ userId: owner._id, orderStatus: 'processing' });

            const dispatch = await request(orderApp)
                .post(`/api/orders/${order._id}/shipments`)
                .set('Authorization', buildBearer('token-admin-2'))
                .send({ initialStatus: 'shipped', trackingId: 'TRK-CHECKPOINT' });
            const shipmentId = dispatch.body.shipments[0].shipmentId;

            const ofd = await request(orderApp)
                .post(`/api/orders/${order._id}/shipments/${shipmentId}/checkpoints`)
                .set('Authorization', buildBearer('token-admin-2'))
                .send({ status: 'out_for_delivery', message: 'On the van' });
            expect(ofd.status).toBe(201);
            expect(ofd.body.orderStatus).toBe('shipped');

            const delivered = await request(orderApp)
                .post(`/api/orders/${order._id}/shipments/${shipmentId}/checkpoints`)
                .set('Authorization', buildBearer('token-admin-2'))
                .send({ status: 'delivered', message: 'Handed to customer' });
            expect(delivered.status).toBe(201);
            expect(delivered.body.orderStatus).toBe('delivered');
            expect(delivered.body.isDelivered).toBe(true);

            const orderAfter = await Order.findById(order._id).lean();
            expect(orderAfter.deliveredAt).toBeTruthy();
            const statuses = orderAfter.shipments[0].checkpoints.map((cp) => cp.status);
            expect(statuses).toEqual(['shipped', 'out_for_delivery', 'delivered']);
        });

        test('illegal checkpoint transitions are rejected', async () => {
            const owner = await createTestUser({ name: 'Illegal Transition Owner' });
            const admin = await createAdminUser({ name: 'Illegal Transition Admin' });
            register('token-admin-3', admin);
            const order = await createFakeOrder({ userId: owner._id, orderStatus: 'processing' });

            const dispatch = await request(orderApp)
                .post(`/api/orders/${order._id}/shipments`)
                .set('Authorization', buildBearer('token-admin-3'))
                .send({ initialStatus: 'shipped' });
            const shipmentId = dispatch.body.shipments[0].shipmentId;

            const response = await request(orderApp)
                .post(`/api/orders/${order._id}/shipments/${shipmentId}/checkpoints`)
                .set('Authorization', buildBearer('token-admin-3'))
                .send({ status: 'delivered' });

            // shipped → delivered skips the map (only out_for_delivery/returned/exception)
            expect(response.status).toBe(409);
        });
    });

    describe('lifecycle worker', () => {
        testWithTransactions('auto-cancels unpaid digital orders past the payment window', async () => {
            const owner = await createTestUser({ name: 'Stale Unpaid Owner' });
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({
                userId: owner._id,
                product,
                paymentMethod: 'CARD',
                paymentIntentId: 'intent_stale_unpaid',
                paymentState: 'created',
                isPaid: false,
                orderStatus: 'placed',
                overrides: { createdAt: hoursAgo(3) },
            });

            const result = await runOrderLifecycleCycle();

            expect(result.cancelled).toBeGreaterThanOrEqual(1);
            const orderAfter = await Order.findById(order._id).lean();
            expect(orderAfter.orderStatus).toBe('cancelled');
            const productAfter = await Product.findById(product._id).select('stock').lean();
            expect(productAfter.stock).toBe(11);
        });

        test('leaves fresh, paid and COD orders alone', async () => {
            const owner = await createTestUser({ name: 'Keep Orders Owner' });
            await createFakeOrder({
                userId: owner._id,
                paymentMethod: 'CARD',
                paymentIntentId: 'intent_fresh',
                paymentState: 'created',
                isPaid: false,
                orderStatus: 'placed',
                overrides: { createdAt: new Date() },
            });
            await createFakeOrder({
                userId: owner._id,
                paymentMethod: 'CARD',
                paymentIntentId: 'intent_paid',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
                overrides: { createdAt: hoursAgo(5) },
            });
            const codOrder = await createFakeOrder({
                userId: owner._id,
                paymentMethod: 'COD',
                isPaid: false,
                orderStatus: 'placed',
                overrides: { createdAt: hoursAgo(5) },
            });

            const result = await runOrderLifecycleCycle();

            expect(result.cancelled).toBe(0);
            const kept = await Order.find({ user: owner._id, orderStatus: { $ne: 'cancelled' } }).lean();
            expect(kept.map((entry) => String(entry._id))).toContain(String(codOrder._id));
        });

        test('raises a COD aging admin alert for stale COD orders', async () => {
            const owner = await createTestUser({ name: 'Stale COD Owner' });
            await createFakeOrder({
                userId: owner._id,
                paymentMethod: 'COD',
                isPaid: false,
                orderStatus: 'placed',
                overrides: { createdAt: hoursAgo(30) },
            });

            await runOrderLifecycleCycle();

            const alert = await AdminNotification.findOne({ actionKey: 'order_cod_aging' }).lean();
            expect(alert).toBeTruthy();
        });
    });

    describe('notification fan-out and preference gating', () => {
        test('default preferences deliver lifecycle email + in-app + socket', async () => {
            const owner = await createTestUser({ name: 'Fanout Owner' });
            const order = await createFakeOrder({ userId: owner._id, orderStatus: 'shipped' });

            const result = await emitOrderEventNotification({
                order,
                eventType: 'order_shipped',
                title: 'Your order has shipped',
                message: 'On its way.',
            });

            expect(result.skipped).toBe(false);
            expect(result.email).toBeTruthy();
            expect(sendPersistentNotification).toHaveBeenCalledTimes(1);
            expect(sendMessageToUser).toHaveBeenCalledWith(
                expect.anything(),
                'order.updated',
                expect.objectContaining({ eventType: 'order_shipped' })
            );
        });

        test('an explicit email opt-out suppresses the email but keeps in-app + socket', async () => {
            const owner = await createTestUser({ name: 'Optout Owner' });
            await AccountPreference.create({
                ownerKey: String(owner._id),
                notifications: {
                    deliveryUpdates: { email: false, push: true },
                },
            });
            const order = await createFakeOrder({ userId: owner._id, orderStatus: 'shipped' });

            const result = await emitOrderEventNotification({
                order,
                eventType: 'order_shipped',
                title: 'Your order has shipped',
                message: 'On its way.',
            });

            expect(result.email).toBeNull();
            expect(sendPersistentNotification).toHaveBeenCalledTimes(1);
            expect(sendMessageToUser).toHaveBeenCalled();
        });
    });

    describe('shipping webhook', () => {
        const seedShipment = async () => {
            const owner = await createTestUser({ name: 'Webhook Owner' });
            const order = await createFakeOrder({
                userId: owner._id,
                orderStatus: 'shipped',
                overrides: {
                    shipments: [{
                        shipmentId: 'shp-test-1',
                        items: [{ productId: 'p1', title: 'Thing', quantity: 1 }],
                        courier: 'AuraExpress',
                        trackingId: 'AWB-777',
                        status: 'out_for_delivery',
                        checkpoints: [{ status: 'out_for_delivery', message: 'on the van', actor: 'courier', at: new Date() }],
                        createdAt: new Date(),
                    }],
                },
            });
            return { order };
        };

        const postWebhook = (app, body, signature) => request(app)
            .post('/api/shipping/webhooks/mock')
            .set('x-shipping-signature', signature)
            .set('content-type', 'application/json')
            .send(body);

        test('rejects invalid signatures', async () => {
            const rawBody = JSON.stringify({ eventId: 'evt_1', trackingId: 'AWB-777', status: 'delivered' });
            const response = await postWebhook(shippingApp, JSON.parse(rawBody), 'sha256=deadbeef');
            expect(response.status).toBe(400);
        });

        test('fails closed with 503 for an unconfigured provider', async () => {
            delete process.env.SHIPPING_WEBHOOK_SECRET_MOCK;
            const rawBody = JSON.stringify({ eventId: 'evt_2', trackingId: 'AWB-777', status: 'delivered' });
            const response = await postWebhook(shippingApp, JSON.parse(rawBody), 'sha256=whatever');
            expect(response.status).toBe(503);
        });

        test('applies a valid-signed checkpoint and dedupes a replay', async () => {
            const { order } = await seedShipment();
            const rawBody = JSON.stringify({
                eventId: 'evt_apply_1',
                trackingId: 'AWB-777',
                status: 'delivered',
                message: 'Delivered to doorstep',
            });
            const signature = signShippingPayload(rawBody);

            const first = await postWebhook(shippingApp, JSON.parse(rawBody), signature);
            expect(first.status).toBe(200);
            expect(first.body.applied).toBe(true);

            const orderAfter = await Order.findById(order._id).lean();
            expect(orderAfter.orderStatus).toBe('delivered');
            expect(orderAfter.isDelivered).toBe(true);
            const statuses = orderAfter.shipments[0].checkpoints.map((cp) => cp.status);
            expect(statuses).toEqual(['out_for_delivery', 'delivered']);

            const replay = await postWebhook(shippingApp, JSON.parse(rawBody), signature);
            expect(replay.body.deduped).toBe(true);
        });

        test('records discarded events for unknown tracking ids instead of failing', async () => {
            await seedShipment();
            const rawBody = JSON.stringify({
                eventId: 'evt_unknown_1',
                trackingId: 'AWB-DOES-NOT-EXIST',
                status: 'delivered',
            });
            const response = await postWebhook(shippingApp, JSON.parse(rawBody), signShippingPayload(rawBody));

            expect(response.status).toBe(200);
            expect(response.body.discarded).toBe(true);
            const ledgerEvent = await ShippingEvent.findOne({ eventId: 'evt_unknown_1' }).lean();
            expect(ledgerEvent).toBeTruthy();
            expect(ledgerEvent.payload.processingMeta.discarded).toBe(true);
        });

        test('records an illegal transition as discarded', async () => {
            await seedShipment();
            // First: mark delivered (valid).
            const first = JSON.stringify({
                eventId: 'evt_transition_1',
                trackingId: 'AWB-777',
                status: 'delivered',
            });
            await postWebhook(shippingApp, JSON.parse(first), signShippingPayload(first));
            // Then: replay a new eventId claiming delivered again — now illegal.
            const second = JSON.stringify({
                eventId: 'evt_transition_2',
                trackingId: 'AWB-777',
                status: 'delivered',
            });
            const response = await postWebhook(shippingApp, JSON.parse(second), signShippingPayload(second));

            expect(response.body.discarded).toBe(true);
            expect(response.body.reason).toBe('invalid_transition');
        });
    });

    describe('delivery promise helpers', () => {
        test('cutoff derives from ORDER_AUTO_CANCEL_MINUTES with a sane default', () => {
            const previous = process.env.ORDER_AUTO_CANCEL_MINUTES;
            delete process.env.ORDER_AUTO_CANCEL_MINUTES;
            const now = Date.now();
            const defaultCutoff = getAutoCancelCutoff(new Date(now));
            expect(now - defaultCutoff.getTime()).toBe(60 * 60 * 1000);

            process.env.ORDER_AUTO_CANCEL_MINUTES = '30';
            const customCutoff = getAutoCancelCutoff(new Date(now));
            expect(now - customCutoff.getTime()).toBe(30 * 60 * 1000);

            if (previous === undefined) {
                delete process.env.ORDER_AUTO_CANCEL_MINUTES;
            } else {
                process.env.ORDER_AUTO_CANCEL_MINUTES = previous;
            }
        });
    });
});
