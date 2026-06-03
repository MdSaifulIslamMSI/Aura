const express = require('express');
const request = require('supertest');

const {
    ORIGIN_VERIFY_HEADER,
    originProtectionMiddleware,
} = require('../middleware/originProtectionMiddleware');
const { getTrustedRequestIp } = require('../utils/requestIdentity');

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

describe('proxy header spoofing boundaries', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    test('request identity ignores raw forwarded headers when Express has already resolved req.ip', () => {
        const req = {
            ip: '198.51.100.24',
            headers: {
                'x-forwarded-for': '203.0.113.10',
                'x-real-ip': '203.0.113.11',
            },
            socket: { remoteAddress: '10.0.0.5' },
        };

        expect(getTrustedRequestIp(req)).toBe('198.51.100.24');
    });

    test('origin verification rejects spoofed forwarded headers without the edge secret', async () => {
        process.env.AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET = 'sample-origin-secret';
        const app = express();
        app.use(originProtectionMiddleware);
        app.get('/api/private', (_req, res) => res.json({ ok: true }));

        const rejected = await request(app)
            .get('/api/private')
            .set('X-Forwarded-For', '203.0.113.10')
            .expect(403);

        expect(rejected.body.code).toBe('ORIGIN_PROTECTION_REQUIRED');

        const allowed = await request(app)
            .get('/api/private')
            .set('X-Forwarded-For', '203.0.113.10')
            .set(ORIGIN_VERIFY_HEADER, 'sample-origin-secret')
            .expect(200);

        expect(allowed.body.ok).toBe(true);
    });
});
