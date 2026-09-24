jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
            trustedDevices: [{ method: 'webauthn' }],
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        req.authzPosture = {
            fresh: true,
            authAgeSeconds: 0,
            webAuthnStepUpFresh: true,
        };
        req.requestId = 'req_envelope_1';
        return next();
    },
    admin: (req, res, next) => next(),
}));

jest.mock('../services/payments/paymentService', () => ({
    setTerminalCaptureFailureHandler: jest.fn(),
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

jest.mock('../services/payments/paymentOperationsService', () => ({
    getPaymentOpsOverview: jest.fn(),
    expireStalePaymentIntents: jest.fn(),
}));

jest.mock('../services/payments/idempotencyService', () => ({
    getRequiredIdempotencyKey: jest.fn((req) => String(req.headers['idempotency-key'] || 'env-test-key')),
    getStableUserKey: jest.fn((req) => String(req.user?._id || 'anonymous')),
    withIdempotency: jest.fn(async ({ handler }) => handler()),
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

jest.mock('../services/email/orderEmailQueueService', () => ({
    listOrderEmailNotifications: jest.fn(),
    getOrderEmailNotificationById: jest.fn(),
    retryOrderEmailNotification: jest.fn(),
}));

jest.mock('../services/catalogService', () => ({
    createCatalogImportJob: jest.fn(),
    getCatalogImportJob: jest.fn(),
    publishCatalogVersion: jest.fn(),
    createCatalogSyncRun: jest.fn(),
    getCatalogHealth: jest.fn(),
}));

jest.mock('../services/catalogSnapshotService', () => ({
    inspectCatalogSnapshot: jest.fn(),
}));

jest.mock('../services/searchRelevanceService', () => ({
    readLatestSearchRelevanceReport: jest.fn(),
}));

jest.mock('../services/searchTelemetryService', () => ({
    buildSearchTelemetrySummary: jest.fn(),
}));

jest.mock('../models/FraudDecision', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
    findById: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const adminPaymentRoutes = require('../routes/adminPaymentRoutes');
const adminOrderEmailRoutes = require('../routes/adminOrderEmailRoutes');
const adminCatalogRoutes = require('../routes/adminCatalogRoutes');
const adminFraudRoutes = require('../routes/adminFraudRoutes');
const {
    listAdminPaymentIntents,
    getPaymentIntentForUser,
    createRefundForIntent,
} = require('../services/payments/paymentService');
const { getPaymentOpsOverview } = require('../services/payments/paymentOperationsService');
const {
    listOrderEmailNotifications,
    getOrderEmailNotificationById,
} = require('../services/email/orderEmailQueueService');
const { getCatalogHealth, getCatalogImportJob } = require('../services/catalogService');
const FraudDecision = require('../models/FraudDecision');
const PaymentIntent = require('../models/PaymentIntent');
const User = require('../models/User');

jest.setTimeout(30000);

const makeIntentChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/payments', adminPaymentRoutes);
    app.use('/api/admin/order-emails', adminOrderEmailRoutes);
    app.use('/api/admin/catalog', adminCatalogRoutes);
    app.use('/api/admin/fraud', adminFraudRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin response envelope unification', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        PaymentIntent.findOne.mockReturnValue(makeIntentChain({
            _id: '64c0b0ff0f1e2c3d4e5f6a7c',
            intentId: 'pi_env_1',
            user: '64c0b0ff0f1e2c3d4e5f6a7d',
            order: null,
            amount: 499,
            currency: 'INR',
            method: 'upi',
        }));
        User.findById.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({ name: 'Owner', email: 'owner@example.com' }),
        });
        app = buildApp();
    });

    test('GET /api/admin/payments returns a success envelope', async () => {
        listAdminPaymentIntents.mockResolvedValue({ total: 1, items: [{ intentId: 'pi_1' }] });

        const res = await request(app).get('/api/admin/payments');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            page: 1,
            limit: 20,
            total: 1,
            items: [{ intentId: 'pi_1' }],
        });
    });

    test('GET /api/admin/payments/ops/overview returns a success envelope', async () => {
        getPaymentOpsOverview.mockResolvedValue({ pendingCaptures: 2, staleIntents: 1 });

        const res = await request(app).get('/api/admin/payments/ops/overview');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, pendingCaptures: 2, staleIntents: 1 });
    });

    test('GET /api/admin/payments/:intentId keeps detail fields and adds success', async () => {
        getPaymentIntentForUser.mockResolvedValue({
            intentId: 'pi_detail_1',
            status: 'authorized',
            amount: 499,
        });

        const res = await request(app).get('/api/admin/payments/pi_detail_1');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, intentId: 'pi_detail_1', status: 'authorized', amount: 499 });
    });

    test('POST /api/admin/payments/:intentId/refunds returns a success envelope', async () => {
        createRefundForIntent.mockResolvedValue({
            refundId: 'rfnd_env_1',
            status: 'processed',
            amount: 499,
            currency: 'INR',
        });

        const res = await request(app)
            .post('/api/admin/payments/pi_env_1/refunds')
            .set('Idempotency-Key', 'env-refund-1')
            .send({ amount: 499, amountMode: 'charge', reason: 'Envelope test' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, refundId: 'rfnd_env_1', status: 'processed' });
    });

    test('GET /api/admin/order-emails returns a success envelope', async () => {
        listOrderEmailNotifications.mockResolvedValue({ total: 0, items: [] });

        const res = await request(app).get('/api/admin/order-emails');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, page: 1, limit: 20, total: 0, items: [] });
    });

    test('GET /api/admin/catalog/health returns a success envelope', async () => {
        getCatalogHealth.mockResolvedValue({ healthy: true, lastSyncAt: '2026-09-24T00:00:00Z' });

        const res = await request(app).get('/api/admin/catalog/health');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, healthy: true });
    });

    test('GET /api/admin/catalog/imports/:jobId returns a coded 404 envelope for a missing job', async () => {
        getCatalogImportJob.mockResolvedValue(null);

        const res = await request(app).get('/api/admin/catalog/imports/does-not-exist');

        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({
            success: false,
            code: 'ADMIN_CATALOG_JOB_NOT_FOUND',
            status: 'fail',
        });
        expect(typeof res.body.message).toBe('string');
    });

    test('GET /api/admin/order-emails/:notificationId returns a coded 404 envelope for a missing item', async () => {
        getOrderEmailNotificationById.mockResolvedValue(null);

        const res = await request(app).get('/api/admin/order-emails/64c0b0ff0f1e2c3d4e5f6a7b');

        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({
            success: false,
            code: 'ADMIN_ORDER_EMAIL_NOT_FOUND',
            status: 'fail',
        });
    });

    test('PATCH /api/admin/fraud/:decisionId/resolve returns a coded 404 envelope for a missing decision', async () => {
        FraudDecision.findById.mockResolvedValue(null);

        const res = await request(app)
            .patch('/api/admin/fraud/64c0b0ff0f1e2c3d4e5f6a7b/resolve')
            .send({ resolution: 'approve' });

        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({
            success: false,
            code: 'ADMIN_FRAUD_DECISION_NOT_FOUND',
            status: 'fail',
        });
    });
});
