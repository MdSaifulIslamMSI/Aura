jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

// Requires must follow the jest.mock calls: this suite runs without
// babel-jest hoisting (jest.config only transforms svix/jose), so a module
// loaded above its mock registration would resolve to the real module.
const express = require('express');
const request = require('supertest');
const { requestId } = require('../middleware/requestId');
const {
    ORIGIN_VERIFY_HEADER,
    originProtectionMiddleware,
} = require('../middleware/originProtectionMiddleware');
const { getTrustedRequestIp } = require('../utils/requestIdentity');

const logger = require('../utils/logger');

const ORIGINAL_ENV = { ...process.env };

const buildApp = () => {
    const app = express();
    app.use(requestId);
    app.use(originProtectionMiddleware);
    app.get('/api/private', (req, res) => res.json({
        ok: true,
        requestId: req.requestId,
        originVerified: req.auraOriginVerified,
        trustedIp: getTrustedRequestIp(req),
    }));
    app.post('/api/payments/webhooks/stripe', (req, res) => res.json({ accepted: true }));
    app.post('/api/status/webhooks/alertmanager', (req, res) => res.json({ accepted: true }));
    app.get('/health/live', (req, res) => res.json({ alive: true }));
    app.get('/metrics', (req, res) => res.type('text/plain').send('aura_metric 1\n'));
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

    test('is inert outside production when no origin secret is configured', async () => {
        process.env.NODE_ENV = 'test';

        const response = await request(buildApp()).get('/api/private').expect(200);

        expect(response.body.ok).toBe(true);
        expect(response.body.originVerified).toBe(false);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('fails closed in production when no origin secret is configured', async () => {
        process.env.NODE_ENV = 'production';

        const response = await request(buildApp())
            .get('/api/private')
            .set('X-Request-Id', 'req-origin-misconfigured')
            .expect(503);

        expect(response.body).toEqual({
            success: false,
            code: 'ORIGIN_PROTECTION_MISCONFIGURED',
            message: 'Service unavailable',
            requestId: 'req-origin-misconfigured',
        });
        expect(logger.error).toHaveBeenCalledWith('origin_protection.misconfigured', expect.objectContaining({
            requestId: 'req-origin-misconfigured',
            path: '/api/private',
        }));
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
        expect(response.body.originVerified).toBe(true);
    });

    test('trusts the CloudFront viewer address only after origin verification', async () => {
        process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET = 'test-origin-secret';

        const unverified = await request(buildApp())
            .get('/api/private')
            .set('CloudFront-Viewer-Address', '203.0.113.50:443')
            .expect(403);
        expect(unverified.body.code).toBe('ORIGIN_PROTECTION_REQUIRED');

        const verified = await request(buildApp())
            .get('/api/private')
            .set(ORIGIN_VERIFY_HEADER, 'test-origin-secret')
            .set('CloudFront-Viewer-Address', '203.0.113.50:443')
            .expect(200);

        expect(verified.body.trustedIp).toBe('203.0.113.50');
    });

    test('keeps health, metrics, and signed provider webhooks reachable without the origin header', async () => {
        process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET = 'test-origin-secret';

        await request(buildApp()).get('/health/live').expect(200);
        await request(buildApp()).get('/metrics').expect(200);
        await request(buildApp()).post('/api/payments/webhooks/stripe').expect(200);
        // Alertmanager posts container-to-container and never traverses
        // CloudFront; the status webhook route carries its own HMAC/bearer
        // auth, matching the payment-webhook contract.
        await request(buildApp()).post('/api/status/webhooks/alertmanager').expect(200);
        await request(buildApp()).get('/api/private').expect(403);
    });
});
