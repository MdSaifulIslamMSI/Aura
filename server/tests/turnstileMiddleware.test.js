const express = require('express');
const request = require('supertest');

const { getRequestToken, verifyTurnstileToken, requireTurnstile } = require('../middleware/turnstileMiddleware');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.post('/guarded', requireTurnstile({ routeName: 'test_guarded' }), (req, res) => {
        res.json({ ok: true });
    });
    app.use((err, req, res, next) => {
        res.status(err.statusCode || 500).json({ message: err.message });
    });
    return app;
};

describe('Cloudflare Turnstile middleware', () => {
    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
            TURNSTILE_ENABLED: 'true',
            TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
            TURNSTILE_TEST_BYPASS_TOKEN: '',
        };
        global.fetch = jest.fn();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    test('extracts token from body and header aliases', () => {
        expect(getRequestToken({ body: { turnstileToken: ' body-token ' }, headers: {} })).toBe('body-token');
        expect(getRequestToken({ body: { cfTurnstileResponse: ' response-token ' }, headers: {} })).toBe('response-token');
        expect(getRequestToken({ body: {}, headers: { 'x-turnstile-token': ' header-token ' } })).toBe('header-token');
    });

    test('rejects guarded route when enabled and token is missing', async () => {
        const response = await request(buildApp())
            .post('/guarded')
            .send({});

        expect(response.statusCode).toBe(403);
        expect(response.body.message).toMatch(/Human verification failed/i);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('accepts guarded route when Cloudflare siteverify succeeds', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true, hostname: 'localhost' }),
        });

        const response = await request(buildApp())
            .post('/guarded')
            .send({ turnstileToken: 'valid-fixture-token' });

        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects guarded route when Cloudflare siteverify fails', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
        });

        const response = await request(buildApp())
            .post('/guarded')
            .send({ turnstileToken: 'invalid-fixture-token' });

        expect(response.statusCode).toBe(403);
        expect(response.body.message).toMatch(/Human verification failed/i);
    });

    test('fails closed when enabled without a secret', async () => {
        process.env.TURNSTILE_SECRET_KEY = '';

        const result = await verifyTurnstileToken({ token: 'candidate', remoteIp: '127.0.0.1' });

        expect(result.success).toBe(false);
        expect(result.errorCodes).toContain('missing-secret');
    });

    test('skips verification when Turnstile is disabled', async () => {
        process.env.TURNSTILE_ENABLED = 'false';

        const response = await request(buildApp())
            .post('/guarded')
            .send({});

        expect(response.statusCode).toBe(200);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
