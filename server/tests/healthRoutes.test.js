const request = require('supertest');
const app = require('../index');

describe('Health routes', () => {
    test('GET /health/live reports process liveness', async () => {
        const res = await request(app).get('/health/live');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            alive: true,
            startup: {
                asyncStartupComplete: expect.any(Boolean),
            },
            topology: {
                splitRuntimeEnabled: expect.any(Boolean),
            },
        });
        expect(typeof res.body.uptime).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
        expect(res.headers).not.toHaveProperty('x-powered-by');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['content-security-policy']).toContain("default-src 'self'");
        expect(res.body).not.toHaveProperty('runtimeSecrets');
        expect(res.body.startup).not.toHaveProperty('asyncStartupError');
    });

    test('GET /health/ready does not expose runtime secret metadata or raw startup errors', async () => {
        const res = await request(app).get('/health/ready');

        expect([200, 503]).toContain(res.statusCode);
        expect(res.headers).not.toHaveProperty('x-powered-by');
        const csp = res.headers['content-security-policy'];
        expect(csp).toContain("frame-src");
        expect(csp).toContain("https://checkout.razorpay.com");
        expect(csp).toContain("https://*.firebaseapp.com");
        expect(csp).toContain("https://app.powerbi.com");
        expect(res.body).not.toHaveProperty('runtimeSecrets');
        expect(res.body.startup).not.toHaveProperty('asyncStartupError');
        expect(res.body.startup).toHaveProperty('asyncStartupHealthy');
    });

    test('GET /health reuses a cached readiness snapshot for consecutive requests', async () => {
        const first = await request(app).get('/health');
        const second = await request(app).get('/health');

        expect([200, 503]).toContain(first.statusCode);
        expect([200, 503]).toContain(second.statusCode);
        expect(['miss', 'shared']).toContain(first.headers['x-health-cache']);
        expect(['hit', 'shared']).toContain(second.headers['x-health-cache']);
    });
});
