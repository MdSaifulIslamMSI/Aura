const express = require('express');
const request = require('supertest');
const { requestId } = require('../middleware/requestId');
const { trustedEdgeMiddleware } = require('../middleware/trustedEdgeMiddleware');

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const logger = require('../utils/logger');

const ORIGINAL_ENV = { ...process.env };

const buildApp = () => {
    const app = express();
    app.use(requestId);
    app.use(trustedEdgeMiddleware);
    app.get('/api/private', (req, res) => res.json({ ok: true, requestId: req.requestId }));
    return app;
};

describe('trustedEdgeMiddleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...ORIGINAL_ENV };
        process.env.INVISIBLE_FABRIC_ENABLED = 'true';
        process.env.INVISIBLE_REQUIRE_TRUSTED_EDGE = 'true';
        process.env.INVISIBLE_TRUSTED_EDGE_HEADER = 'x-aura-edge-secret';
        process.env.INVISIBLE_TRUSTED_EDGE_SECRET = 'edge-secret-value-32';
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('development request passes when trusted edge mode is not explicitly enabled', async () => {
        process.env.INVISIBLE_REQUIRE_TRUSTED_EDGE = 'false';

        const response = await request(buildApp()).get('/api/private').expect(200);

        expect(response.body.ok).toBe(true);
    });

    test('strict request without header fails generically', async () => {
        const response = await request(buildApp())
            .get('/api/private')
            .set('X-Request-Id', 'req-edge-missing')
            .expect(404);

        expect(response.body).toEqual({
            status: 'error',
            message: 'Not found',
            requestId: 'req-edge-missing',
        });
    });

    test('strict request with wrong header fails without leaking the secret', async () => {
        const response = await request(buildApp())
            .get('/api/private')
            .set('x-aura-edge-secret', 'wrong-secret')
            .expect(404);

        expect(JSON.stringify(response.body)).not.toContain('edge-secret-value-32');
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('edge-secret-value-32');
    });

    test('strict request with correct header passes', async () => {
        const response = await request(buildApp())
            .get('/api/private')
            .set('x-aura-edge-secret', 'edge-secret-value-32')
            .expect(200);

        expect(response.body.ok).toBe(true);
    });
});
