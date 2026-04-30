const request = require('supertest');
const express = require('express');

const mockProtect = jest.fn();

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => mockProtect(req, res, next),
    requireOtpAssurance: (req, _res, next) => {
        const assurance = String(req.user?.authAssurance || '');
        if (!['otp', 'password+otp'].includes(assurance)) {
            const err = new Error('OTP verification required for this action');
            err.statusCode = 403;
            return next(err);
        }
        return next();
    },
    requireActiveAccount: (req, _res, next) => next(),
}));

jest.mock('../middleware/validate', () => () => (_req, _res, next) => next());

jest.mock('../controllers/paymentController', () => ({
    createIntent: (_req, res) => res.status(201).json({ ok: true }),
    completeChallenge: (_req, res) => res.status(200).json({ ok: true }),
    confirmIntent: (_req, res) => res.status(200).json({ ok: true }),
    getIntent: (_req, res) => res.status(200).json({ ok: true }),
    createRefund: (_req, res) => res.status(200).json({ ok: true }),
    handleRazorpayWebhook: (_req, res) => res.status(200).json({ ok: true }),
    handleStripeWebhook: (_req, res) => res.status(200).json({ ok: true }),
    getPaymentMethods: (_req, res) => res.status(200).json({ ok: true }),
    getPaymentCapabilitiesCatalog: (_req, res) => res.status(200).json({ ok: true }),
    getNetbankingBanks: (_req, res) => res.status(200).json({ ok: true }),
    createMethodSetupIntent: (_req, res) => res.status(201).json({ ok: true }),
    addPaymentMethod: (_req, res) => res.status(200).json({ ok: true }),
    makeDefaultPaymentMethod: (_req, res) => res.status(200).json({ ok: true }),
    removePaymentMethod: (_req, res) => res.status(200).json({ ok: true }),
}));

describe('payment routes OTP assurance', () => {
    const paymentRoutes = require('../routes/paymentRoutes');

    const buildApp = (assurance) => {
        mockProtect.mockImplementation((req, _res, next) => {
            req.user = { _id: 'u1', authAssurance: assurance };
            next();
        });

        const app = express();
        app.use(express.json());
        app.use('/api/payments', paymentRoutes);
        // eslint-disable-next-line no-unused-vars
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({ message: err.message });
        });
        return app;
    };

    test('denies POST /api/payments/intents when assurance is missing', async () => {
        const app = buildApp('none');
        const res = await request(app).post('/api/payments/intents').send({});
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toMatch(/OTP verification required/i);
    });

    test('allows POST /api/payments/intents when assurance is password+otp', async () => {
        const app = buildApp('password+otp');
        const res = await request(app).post('/api/payments/intents').send({});
        expect(res.statusCode).toBe(201);
        expect(res.body).toEqual({ ok: true });
    });

    test('protects manual setup intent enrollment behind OTP assurance', async () => {
        const deniedApp = buildApp('none');
        const denied = await request(deniedApp).post('/api/payments/methods/setup-intent').send({});
        expect(denied.statusCode).toBe(403);

        const allowedApp = buildApp('otp');
        const allowed = await request(allowedApp).post('/api/payments/methods/setup-intent').send({});
        expect(allowed.statusCode).toBe(201);
        expect(allowed.body).toEqual({ ok: true });
    });
});
