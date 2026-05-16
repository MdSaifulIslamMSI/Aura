const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const EmergencyAuditLog = require('../models/EmergencyAuditLog');
const EmergencyControl = require('../models/EmergencyControl');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentIntent = require('../models/PaymentIntent');
const { requestId } = require('../middleware/requestId');
const { errorHandler } = require('../middleware/errorMiddleware');
const {
    emergencyRoutePolicyMiddleware,
    globalEmergencyMiddleware,
    readOnlyMiddleware,
} = require('../middleware/emergencyControlMiddleware');
const {
    requireEmergencyControlRole,
    requireEmergencySecondFactor,
} = require('../middleware/emergencyAdminMiddleware');
const { clearEmergencyCache } = require('../services/emergencyControlService');

const activateDbFlag = async (key, overrides = {}) => {
    await EmergencyControl.findOneAndUpdate(
        { key },
        {
            $set: {
                key,
                enabled: true,
                severity: overrides.severity || 'high',
                scope: overrides.scope || 'global',
                userMessage: overrides.userMessage || 'Temporarily unavailable.',
                expiresAt: overrides.expiresAt || new Date(Date.now() + 60_000),
                ...overrides,
            },
        },
        { upsert: true, setDefaultsOnInsert: true }
    );
    clearEmergencyCache();
};

const createPolicyApp = () => {
    const app = express();
    app.use(express.json());
    app.use(requestId);
    app.get('/api/emergency/status', (req, res) => res.json({ ok: true, requestId: req.requestId }));
    app.use(globalEmergencyMiddleware);
    app.use(readOnlyMiddleware);
    app.use(emergencyRoutePolicyMiddleware);
    app.get('/health', (req, res) => res.json({ ok: true }));
    app.get('/products', (req, res) => res.json({ ok: true }));
    app.post('/api/orders', (req, res) => res.json({ ok: true }));
    app.post('/api/payments/intents', (req, res) => res.json({ ok: true }));
    app.post('/api/checkout/create', (req, res) => res.json({ ok: true }));
    app.post('/api/otp/send', (req, res) => res.json({ ok: true }));
    app.post('/api/ai/chat', (req, res) => res.json({ ok: true }));
    app.post('/api/admin/products', (req, res) => res.json({ ok: true }));
    app.post('/api/admin/emergency-controls/:key/activate', (req, res) => res.json({ ok: true }));
    app.post('/api/payments/webhooks/razorpay', (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
};

describe('emergency control middleware', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.restoreAllMocks();
        clearEmergencyCache();
    });

    test('GLOBAL_MAINTENANCE blocks normal routes and allows recovery/status paths', async () => {
        await activateDbFlag('GLOBAL_MAINTENANCE', {
            severity: 'critical',
            scope: 'global',
            userMessage: 'Emergency maintenance.',
        });
        const app = createPolicyApp();

        const blocked = await request(app)
            .get('/products')
            .set('X-Request-Id', 'req-maint-blocked')
            .expect(503);

        expect(blocked.body).toMatchObject({
            success: false,
            code: 'MAINTENANCE_MODE',
            message: 'Emergency maintenance.',
            requestId: 'req-maint-blocked',
        });

        await request(app).get('/health').expect(200);
        await request(app).get('/api/emergency/status').expect(200);
        await request(app).post('/api/admin/emergency-controls/GLOBAL_MAINTENANCE/activate').expect(200);
    });

    test('READ_ONLY_MODE blocks writes, allows GET, and preserves emergency/webhook recovery paths', async () => {
        await activateDbFlag('READ_ONLY_MODE', {
            severity: 'critical',
            scope: 'global',
            userMessage: 'Read only.',
        });
        const app = createPolicyApp();

        await request(app).get('/products').expect(200);
        const blocked = await request(app)
            .post('/api/orders')
            .set('X-Request-Id', 'req-readonly')
            .send({})
            .expect(423);

        expect(blocked.body).toMatchObject({
            code: 'READ_ONLY_MODE',
            requestId: 'req-readonly',
        });
        await request(app).post('/api/admin/emergency-controls/READ_ONLY_MODE/activate').send({}).expect(200);
        await request(app).post('/api/payments/webhooks/razorpay').send({}).expect(200);
    });

    test('feature flags block direct API bypass attempts after global/read-only precedence', async () => {
        const app = createPolicyApp();
        await activateDbFlag('DISABLE_PAYMENT', { scope: 'payment', userMessage: 'Payments paused.' });
        await activateDbFlag('DISABLE_CHECKOUT', { scope: 'checkout', userMessage: 'Checkout paused.' });
        await activateDbFlag('DISABLE_OTP_SEND', { scope: 'auth', userMessage: 'OTP paused.' });
        await activateDbFlag('DISABLE_AI_ASSISTANT', { scope: 'ai', userMessage: 'Assistant paused.' });
        await activateDbFlag('DISABLE_ADMIN_MUTATIONS', { scope: 'admin', userMessage: 'Admin writes paused.' });

        await request(app).post('/api/payments/intents').send({}).expect(503).expect(({ body }) => {
            expect(body).toMatchObject({ code: 'FEATURE_TEMPORARILY_DISABLED', feature: 'payment' });
        });
        await request(app).post('/api/orders').send({}).expect(503).expect(({ body }) => {
            expect(body.feature).toBe('checkout');
        });
        await request(app).post('/api/otp/send').send({ purpose: 'login' }).expect(503).expect(({ body }) => {
            expect(body.feature).toBe('otp');
        });
        await request(app).post('/api/ai/chat').send({}).expect(503).expect(({ body }) => {
            expect(body.feature).toBe('ai');
        });
        await request(app).post('/api/admin/products').send({}).expect(503).expect(({ body }) => {
            expect(body.feature).toBe('admin');
        });
    });

    test('emergency admin role and second-factor failures are audited', async () => {
        const app = express();
        app.use(express.json());
        app.use(requestId);
        app.use((req, res, next) => {
            const persona = req.get('x-test-persona');
            if (persona === 'normal-admin') {
                req.user = { _id: '507f1f77bcf86cd799439012', email: 'admin@example.com', isAdmin: true, adminRoles: ['ADMIN'] };
            } else if (persona === 'security-admin') {
                req.user = { _id: '507f1f77bcf86cd799439013', email: 'sec@example.com', isAdmin: true, adminRoles: ['SECURITY_ADMIN'] };
                req.authSession = req.get('x-aal2') === 'true' ? { aal: 'aal2', amr: ['webauthn'] } : { aal: 'aal1', amr: [] };
            }
            next();
        });
        app.post('/mutate', requireEmergencyControlRole, requireEmergencySecondFactor, (req, res) => res.json({ ok: true }));
        app.use(errorHandler);

        await request(app)
            .post('/mutate')
            .set('X-Test-Persona', 'normal-admin')
            .set('X-Request-Id', 'req-role-denied')
            .send({})
            .expect(403);

        await request(app)
            .post('/mutate')
            .set('X-Test-Persona', 'security-admin')
            .set('X-Request-Id', 'req-2fa-denied')
            .send({})
            .expect(403);

        await request(app)
            .post('/mutate')
            .set('X-Test-Persona', 'security-admin')
            .set('X-Aal2', 'true')
            .send({})
            .expect(200);

        const logs = await EmergencyAuditLog.find({ action: 'FAILED_ATTEMPT' }).lean();
        expect(logs.map((log) => log.requestId)).toEqual(expect.arrayContaining(['req-role-denied', 'req-2fa-denied']));
    });

    test('payment webhook persists raw payload and suppresses mutation when payment is disabled', async () => {
        process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
        process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
        process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

        const { processRazorpayWebhook } = require('../services/payments/paymentService');
        await activateDbFlag('DISABLE_PAYMENT', { scope: 'payment', userMessage: 'Payments paused.' });

        const intent = await PaymentIntent.create({
            intentId: 'pi_webhook_suppressed',
            user: '507f1f77bcf86cd799439014',
            provider: 'razorpay',
            providerOrderId: 'order_test_1',
            amount: 1200,
            currency: 'INR',
            method: 'UPI',
            status: 'created',
            expiresAt: new Date(Date.now() + 60_000),
        });
        const rawBody = JSON.stringify({
            id: 'evt_webhook_1',
            event: 'payment.authorized',
            payload: {
                payment: {
                    entity: {
                        id: 'pay_test_1',
                        order_id: 'order_test_1',
                        status: 'authorized',
                        amount: 120000,
                    },
                },
            },
        });
        const signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(rawBody)
            .digest('hex');

        const result = await processRazorpayWebhook({ signature, rawBody });

        expect(result).toMatchObject({
            received: true,
            suppressed: true,
            intentId: intent.intentId,
        });
        const event = await PaymentEvent.findOne({ eventId: 'evt_webhook_1' }).lean();
        const reloadedIntent = await PaymentIntent.findOne({ intentId: intent.intentId }).lean();
        expect(event.payload.processingMeta).toMatchObject({
            suppressed: true,
            reason: 'emergency_payment_mutations_disabled',
        });
        expect(reloadedIntent.status).toBe('created');
        expect(reloadedIntent.providerPaymentId).toBe('');
    });
});
