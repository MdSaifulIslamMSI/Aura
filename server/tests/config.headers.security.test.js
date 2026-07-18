const request = require('supertest');

const app = require('../index');
const {
    DESKTOP_AUTH_LOOPBACK_CONNECT_SOURCES,
    DESKTOP_AUTH_LOOPBACK_FORM_ACTION_SOURCES,
} = require('../../config/desktopAuthLoopback.cjs');
const { assertSafeStatus } = require('./helpers/securityTestHelpers');

jest.setTimeout(15000);

const getDirectiveSources = (policy = '', name = '') => String(policy || '')
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `))
    ?.split(/\s+/)
    .slice(1) || [];

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

        const connectSrc = getDirectiveSources(response.headers['content-security-policy'], 'connect-src');
        expect(connectSrc).toContain("'self'");
        expect(connectSrc).toContain('https://api.stripe.com');
        expect(connectSrc).toContain('https://*.googleapis.com');
        expect(connectSrc).not.toContain('https:');
        expect(connectSrc).not.toContain('wss:');
        expect(connectSrc).toEqual(expect.arrayContaining(DESKTOP_AUTH_LOOPBACK_CONNECT_SOURCES));
        expect(connectSrc).not.toContain('http://127.0.0.1:*');

        const formAction = getDirectiveSources(response.headers['content-security-policy'], 'form-action');
        expect(formAction).toEqual(["'self'", ...DESKTOP_AUTH_LOOPBACK_FORM_ACTION_SOURCES]);
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
