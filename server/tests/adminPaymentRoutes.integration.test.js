jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        req.requestId = 'req_admin_payments_1';
        return next();
    },
    admin: (req, res, next) => next(),
}));

jest.mock('../models/PaymentIntent', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/PaymentEvent', () => ({
    find: jest.fn(),
}));

jest.mock('../models/PaymentOutboxTask', () => ({
    find: jest.fn(),
}));

jest.mock('../models/Order', () => ({
    aggregate: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../models/User', () => ({
    findById: jest.fn(),
}));

jest.mock('../services/email/adminActionEmailService', () => ({
    notifyAdminActionToUser: jest.fn(),
}));

jest.mock('../services/notificationService', () => ({
    sendPersistentNotification: jest.fn(),
}));

jest.mock('../services/payments/paymentService', () => ({
    createPaymentIntent: jest.fn(),
    confirmPaymentIntent: jest.fn(),
    getPaymentIntentForUser: jest.fn(),
    processRazorpayWebhook: jest.fn(),
    createRefundForIntent: jest.fn(),
    markChallengeVerified: jest.fn(),
    listUserPaymentMethods: jest.fn(),
    saveUserPaymentMethod: jest.fn(),
    deleteUserPaymentMethod: jest.fn(),
    setDefaultPaymentMethod: jest.fn(),
    listAdminPaymentIntents: jest.fn(),
    captureIntentNow: jest.fn(),
    scheduleCaptureTask: jest.fn(),
}));

jest.mock('../services/payments/idempotencyService', () => {
    const AppError = require('../utils/AppError');
    return {
        getRequiredIdempotencyKey: jest.fn((req) => {
            const key = String(req.headers['idempotency-key'] || '').trim();
            if (!key) throw new AppError('Idempotency-Key header is required', 400);
            return key;
        }),
        getStableUserKey: jest.fn((req) => String(req.user?._id || 'anonymous')),
        withIdempotency: jest.fn(async ({ handler }) => handler()),
    };
});

const express = require('express');
const request = require('supertest');
const adminPaymentRoutes = require('../routes/adminPaymentRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const PaymentIntentModel = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const Order = require('../models/Order');
const User = require('../models/User');
const { notifyAdminActionToUser } = require('../services/email/adminActionEmailService');
const {
    getPaymentIntentForUser,
    listAdminPaymentIntents,
    captureIntentNow,
    scheduleCaptureTask,
} = require('../services/payments/paymentService');

const makeChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const makeFindChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const makeOrderDoc = (overrides = {}) => ({
    _id: '69cc00000000000000000001',
    user: '69cc0000000000000000user1',
    totalPrice: 2499,
    paymentState: 'authorized',
    orderStatus: 'placed',
    refundSummary: {
        totalRefunded: 0,
        fullyRefunded: false,
        refunds: [],
    },
    commandCenter: {
        refunds: [{
            requestId: 'refund_req_1',
            status: 'approved',
            amount: 499,
            reason: 'damaged',
            message: '',
            adminNote: '',
            refundId: '',
            createdAt: new Date('2026-03-06T00:00:00.000Z'),
            updatedAt: null,
            processedAt: null,
        }],
        lastUpdatedAt: new Date('2026-03-06T00:00:00.000Z'),
    },
    statusTimeline: [],
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/payments', adminPaymentRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin payment routes integration', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();

        listAdminPaymentIntents.mockResolvedValue({
            total: 1,
            items: [{
                intentId: 'pi_admin_1',
                status: 'authorized',
                amount: 2499,
                provider: 'simulated',
            }],
        });
        getPaymentIntentForUser.mockResolvedValue({
            intentId: 'pi_admin_1',
            status: 'authorized',
            amount: 2499,
            timeline: [],
        });
        captureIntentNow.mockResolvedValue({
            intentId: 'pi_admin_1',
            status: 'captured',
            capturedAt: new Date('2026-03-06T12:00:00.000Z'),
        });
        scheduleCaptureTask.mockResolvedValue({
            _id: 'task_capture_1',
            taskType: 'capture',
            status: 'pending',
        });

        PaymentIntentModel.findOne.mockReturnValue(makeChain({
            intentId: 'pi_admin_1',
            user: '69cc0000000000000000user1',
            order: '69cc00000000000000000001',
            amount: 2499,
            currency: 'INR',
            provider: 'simulated',
            method: 'CARD',
        }));
        User.findById.mockReturnValue(makeChain({
            _id: '69cc0000000000000000user1',
            name: 'Payment User',
            email: 'payment.user@example.com',
        }));
        notifyAdminActionToUser.mockResolvedValue(undefined);

        PaymentOutboxTask.find.mockReturnValue(makeFindChain([]));
        PaymentEvent.find.mockReturnValue(makeFindChain([]));
        Order.aggregate.mockResolvedValue([{
            items: [{
                orderId: '69cc00000000000000000001',
                user: '69cc0000000000000000user1',
                paymentMethod: 'CARD',
                paymentProvider: 'simulated',
                paymentIntentId: 'pi_admin_1',
                paymentState: 'authorized',
                orderStatus: 'placed',
                totalPrice: 2499,
                requestId: 'refund_req_1',
                refundStatus: 'pending',
                amount: 499,
                reason: 'damaged',
                message: 'Awaiting provider confirmation',
                adminNote: '',
                refundId: '',
                createdAt: new Date('2026-03-06T00:00:00.000Z'),
                updatedAt: null,
                processedAt: null,
                userDoc: {
                    _id: '69cc0000000000000000user1',
                    name: 'Payment User',
                    email: 'payment.user@example.com',
                    phone: '+919876543210',
                },
            }],
            total: [{ count: 1 }],
        }]);
        Order.findById.mockResolvedValue(makeOrderDoc());
    });

    test('GET /api/admin/payments returns paginated payment operations', async () => {
        const res = await request(app).get('/api/admin/payments?page=1&limit=10&status=authorized');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            page: 1,
            limit: 10,
            total: 1,
        });
        expect(res.body.items).toHaveLength(1);
        expect(listAdminPaymentIntents).toHaveBeenCalledWith(expect.objectContaining({
            page: 1,
            limit: 10,
            status: 'authorized',
        }));
    });

    test('GET /api/admin/payments/:intentId returns payment detail through the real route', async () => {
        const res = await request(app).get('/api/admin/payments/pi_admin_1');

        expect(res.statusCode).toBe(200);
        expect(res.body.intentId).toBe('pi_admin_1');
        expect(getPaymentIntentForUser).toHaveBeenCalledWith({
            intentId: 'pi_admin_1',
            userId: '69aa0000000000000000admin',
            allowAdmin: true,
        });
    });

    test('GET /api/admin/payments/refunds/ledger returns enriched ledger rows', async () => {
        PaymentOutboxTask.find.mockReturnValue(makeFindChain([{
            status: 'pending',
            retryCount: 1,
            nextRunAt: new Date('2026-03-06T01:00:00.000Z'),
            lastError: '',
            payload: { requestId: 'refund_req_1' },
        }]));

        const res = await request(app).get('/api/admin/payments/refunds/ledger?page=1&limit=25');

        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.items[0]).toMatchObject({
            requestId: 'refund_req_1',
            settlement: 'queued',
            reconciliation: 'pending',
        });
    });

    test('PATCH /api/admin/payments/refunds/ledger/:orderId/:requestId/reference enforces param validation', async () => {
        const res = await request(app)
            .patch('/api/admin/payments/refunds/ledger/bad-id/refund_req_1/reference')
            .send({ refundId: 'rfnd_1', note: 'manual note' });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });

    test('PATCH /api/admin/payments/refunds/ledger/:orderId/:requestId/reference marks approved refund as processed', async () => {
        const order = makeOrderDoc();
        Order.findById.mockResolvedValue(order);

        const res = await request(app)
            .patch('/api/admin/payments/refunds/ledger/69cc00000000000000000001/refund_req_1/reference')
            .send({ refundId: 'rfnd_manual_1', note: 'Refund sent manually' });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Manual refund marked processed with reference');
        expect(order.refundSummary.totalRefunded).toBe(499);
        expect(order.paymentState).toBe('partially_refunded');
        expect(order.save).toHaveBeenCalled();
        expect(notifyAdminActionToUser).toHaveBeenCalled();
    });

    test('POST /api/admin/payments/:intentId/capture requires Idempotency-Key', async () => {
        const res = await request(app).post('/api/admin/payments/pi_admin_1/capture').send({});

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Idempotency-Key header is required');
    });

    test('POST /api/admin/payments/:intentId/capture captures and notifies through the real route', async () => {
        const res = await request(app)
            .post('/api/admin/payments/pi_admin_1/capture')
            .set('Idempotency-Key', 'admin-capture-12345')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            intentId: 'pi_admin_1',
            status: 'captured',
        });
        expect(captureIntentNow).toHaveBeenCalledWith({ intentId: 'pi_admin_1' });
        expect(notifyAdminActionToUser).toHaveBeenCalled();
    });

    test('POST /api/admin/payments/:intentId/retry-capture requeues capture and notifies', async () => {
        const res = await request(app)
            .post('/api/admin/payments/pi_admin_1/retry-capture')
            .set('Idempotency-Key', 'admin-retry-12345')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            queued: true,
            taskId: 'task_capture_1',
            intentId: 'pi_admin_1',
        });
        expect(scheduleCaptureTask).toHaveBeenCalledWith({ intentId: 'pi_admin_1' });
        expect(notifyAdminActionToUser).toHaveBeenCalled();
    });
});
