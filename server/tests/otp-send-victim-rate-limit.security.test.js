const express = require('express');
const request = require('supertest');

// Read at module load time, so the victim cap must be set before otpRoutes loads.
process.env.OTP_SEND_VICTIM_MAX = '2';
process.env.OTP_SEND_VICTIM_WINDOW_MS = String(10 * 60 * 1000);
// distributedRateLimit short-circuits under NODE_ENV=test (middleware/distributedRateLimit.js:168),
// so exercise the real limiter in a development-mode runtime instead.
process.env.NODE_ENV = 'development';

jest.mock('../controllers/otpController', () => ({
    getOtpChallenge: jest.fn((_req, res) => res.json({ ok: true })),
    sendOtp: jest.fn((_req, res) => res.json({ ok: true })),
    verifyOtp: jest.fn((_req, res) => res.json({ ok: true })),
    resetPasswordWithOtp: jest.fn((_req, res) => res.json({ ok: true })),
    checkUserExists: jest.fn((_req, res) => res.json({ ok: true })),
}));

// createDistributedRateLimit keeps its in-memory window in module scope, and every
// request in this file shares one source address, so the IP-keyed otpLimiter would
// be exhausted by the first test. Load a fresh router per test for clean buckets.
const loadApp = () => {
    jest.resetModules();
    const app = express();
    app.set('trust proxy', false);
    app.use(express.json());
    app.use('/otp', require('../routes/otpRoutes'));
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ message: err.message });
    });
    return app;
};

const sendOtpRequest = (app, { email, phone, purpose = 'login' }) => request(app)
    .post('/otp/send')
    .send({ email, phone, purpose, skipSms: true });

describe('otp send per-victim rate limit', () => {
    let app;

    beforeEach(() => {
        app = loadApp();
    });

    test('caps OTP sends aimed at a single victim identity', async () => {
        const victim = { email: 'victim@example.test', phone: '+15550100001' };

        await sendOtpRequest(app, victim).expect(200);
        await sendOtpRequest(app, victim).expect(200);
        const blocked = await sendOtpRequest(app, victim).expect(429);

        expect(blocked.body.code).toBe('OTP_SEND_VICTIM_LIMITED');
    });

    test('does not spend one victim budget against a different victim', async () => {
        const first = { email: 'first@example.test', phone: '+15550100002' };
        const second = { email: 'second@example.test', phone: '+15550100003' };

        // Spend the first victim's whole budget, then confirm the next send aimed
        // at a different target is still admitted from the same source address.
        await sendOtpRequest(app, first).expect(200);
        await sendOtpRequest(app, first).expect(200);
        await sendOtpRequest(app, second).expect(200);
    });

    test('treats email casing as the same victim identity', async () => {
        await sendOtpRequest(app, { email: 'Case@example.test', phone: '+15550100004' }).expect(200);
        await sendOtpRequest(app, { email: 'case@example.test', phone: '+15550100004' }).expect(200);
        const blocked = await sendOtpRequest(app, { email: 'CASE@example.test', phone: '+15550100004' })
            .expect(429);

        expect(blocked.body.code).toBe('OTP_SEND_VICTIM_LIMITED');
    });

    test('shares one budget across OTP purposes for the same victim', async () => {
        const victim = { email: 'multi@example.test', phone: '+15550100005' };

        await sendOtpRequest(app, { ...victim, purpose: 'login' }).expect(200);
        await sendOtpRequest(app, { ...victim, purpose: 'forgot-password' }).expect(200);
        const blocked = await sendOtpRequest(app, { ...victim, purpose: 'signup' }).expect(429);

        expect(blocked.body.code).toBe('OTP_SEND_VICTIM_LIMITED');
    });

    test('collapses phone formatting variants into one victim identity', async () => {
        // otpController.normalizePhone strips whitespace/hyphens/parens before the
        // SMS dispatch, so these three bodies reach the same number. The victim
        // bucket must see them as one identity or formatting mints fresh budget.
        await sendOtpRequest(app, { phone: '+15550100006' }).expect(200);
        await sendOtpRequest(app, { phone: '+1 555 010 0006' }).expect(200);
        const blocked = await sendOtpRequest(app, { phone: '+1-555-010-0006' }).expect(429);

        expect(blocked.body.code).toBe('OTP_SEND_VICTIM_LIMITED');
    });
});