const request = require('supertest');

const app = require('../index');
const { assertSafeStatus } = require('./helpers/securityTestHelpers');

describe('security headers', () => {
    test('API responses include defensive browser headers and do not leak Express', async () => {
        const response = await request(app)
            .get('/api/products?limit=1')
            .set('Origin', 'http://localhost:5173');

        expect(response.statusCode).toBeLessThan(500);
        expect(response.headers['x-powered-by']).toBeUndefined();
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['content-security-policy']).toEqual(expect.stringContaining("default-src 'self'"));

        const frameAncestorsProtected = String(response.headers['content-security-policy'] || '')
            .includes("frame-ancestors 'none'");
        const xFrameOptionsProtected = Boolean(response.headers['x-frame-options']);
        expect(frameAncestorsProtected || xFrameOptionsProtected).toBe(true);
        expect(response.headers['strict-transport-security']).toBeDefined();
    });

    test('auth/account/admin responses are not cacheable', async () => {
        const response = await request(app)
            .get('/api/admin/products')
            .set('Origin', 'http://localhost:5173');

        assertSafeStatus(response, [401]);
        expect(String(response.headers['cache-control'] || '')).toMatch(/no-store/i);
        expect(response.headers.pragma).toBe('no-cache');
    });
});
