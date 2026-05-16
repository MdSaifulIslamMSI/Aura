const express = require('express');
const request = require('supertest');
const { requestId } = require('../middleware/requestId');
const {
    ORIGIN_VERIFY_HEADER,
    originProtectionMiddleware,
} = require('../middleware/originProtectionMiddleware');

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const logger = require('../utils/logger');

const ORIGINAL_ENV = { ...process.env };

const buildApp = () => {
    const app = express();
    app.use(requestId);
    app.use(originProtectionMiddleware);
    app.get('/api/private', (req, res) => res.json({ ok: true, requestId: req.requestId }));
    app.post('/api/payments/webhooks/stripe', (req, res) => res.json({ accepted: true }));
    app.get('/health/live', (req, res) => res.json({ alive: true }));
    return app;
};

describe('originProtectionMiddleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET;
        delete process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET;
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('is inert when no origin secret is configured', async () => {
        const response = await request(buildApp()).get('/api/private').expect(200);

        expect(response.body.ok).toBe(true);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('rejects direct API requests without the CloudFront origin header', async () => {
        process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET = 'test-origin-secret';

        const response = await request(buildApp())
            .get('/api/private')
            .set('X-Request-Id', 'req-origin-block')
            .expect(403);

        expect(response.body).toEqual({
            success: false,
            code: 'ORIGIN_PROTECTION_REQUIRED',
            message: 'Forbidden',
            requestId: 'req-origin-block',
        });
        expect(logger.warn).toHaveBeenCalledWith('origin_protection.rejected', expect.objectContaining({
            requestId: 'req-origin-block',
            path: '/api/private',
        }));
    });

    test('allows requests with the correct CloudFront origin header', async () => {
        process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET = 'test-origin-secret';

        const response = await request(buildApp())
            .get('/api/private')
            .set(ORIGIN_VERIFY_HEADER, 'test-origin-secret')
            .expect(200);

        expect(response.body.ok).toBe(true);
    });

    test('keeps health and signed provider webhooks reachable without the origin header', async () => {
        process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET = 'test-origin-secret';

        await request(buildApp()).get('/health/live').expect(200);
        await request(buildApp()).post('/api/payments/webhooks/stripe').expect(200);
    });
});
