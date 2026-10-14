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
        expect(res.body.service).toBe('aura-marketplace-api');
        expect(typeof res.body.version).toBe('string');
        expect(res.body.environment).toBe('test');
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
        expect(first.body).toMatchObject({
            service: 'aura-marketplace-api',
            version: expect.any(String),
            environment: 'test',
        });
        expect(['miss', 'shared']).toContain(first.headers['x-health-cache']);
        expect(['hit', 'shared']).toContain(second.headers['x-health-cache']);
    });

    test('GET /api/health/deep returns structured dependency checks without secrets', async () => {
        const res = await request(app).get('/api/health/deep');

        expect([200, 503]).toContain(res.statusCode);
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('service', 'aura-marketplace-api');
        expect(res.body).toHaveProperty('version');
        expect(res.body).toHaveProperty('environment', 'test');
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body).toHaveProperty('correlationId');
        expect(res.body.checks).toHaveProperty('database');
        expect(res.body.checks).toHaveProperty('redis');
        expect(res.body.checks).toHaveProperty('email');
        expect(res.body.checks).toHaveProperty('payments');
        expect(res.body.checks).toHaveProperty('ai');
        expect(res.body.checks).toHaveProperty('uploads');
        expect(JSON.stringify(res.body)).not.toMatch(/secret|token|mongodb:\/\//i);
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('GET /api/health/live is timeout-safe process liveness', async () => {
        const res = await request(app).get('/api/health/live');

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('healthy');
        expect(res.body.checks.process.status).toBe('healthy');
    });
});

// `shouldExposeDetailedHealth` returns true for every non-production runtime, so
// the tests above can only ever observe the detailed payload. This block reloads
// the app with NODE_ENV=production to pin the public wire shape production
// actually serves: no service/version/environment, no topology, no startup
// internals, unless the caller presents the x-health-token.
describe('GET /health/live in production', () => {
    const ORIGINAL_ENV = { ...process.env };

    // Loading ../index boots Firebase and the catalog health probes, so build the
    // production instance once and share it. Reloading per assertion made this
    // block flaky under parallel execution.
    let prodApp;

    beforeAll(() => {
        jest.isolateModules(() => {
            process.env.NODE_ENV = 'production';
            process.env.HEALTH_READY_TOKEN = 'test-health-token';
            prodApp = require('../index');
        });
    });

    afterAll(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    test('omits internal metadata from the unauthenticated payload', async () => {
        const res = await request(prodApp).get('/health/live');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ alive: true, status: 'ok' });
        expect(typeof res.body.timestamp).toBe('string');

        expect(res.body).not.toHaveProperty('service');
        expect(res.body).not.toHaveProperty('version');
        expect(res.body).not.toHaveProperty('environment');
        expect(res.body).not.toHaveProperty('topology');
        expect(res.body).not.toHaveProperty('startup');
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('still withholds details from a wrong x-health-token', async () => {
        const res = await request(prodApp)
            .get('/health/live')
            .set('x-health-token', 'not-the-token');

        expect(res.statusCode).toBe(200);
        expect(res.body).not.toHaveProperty('version');
        expect(res.body).not.toHaveProperty('topology');
    });

    test('returns details to an operator presenting the correct token', async () => {
        const res = await request(prodApp)
            .get('/health/live')
            .set('x-health-token', 'test-health-token');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            alive: true,
            service: 'aura-marketplace-api',
            topology: { splitRuntimeEnabled: expect.any(Boolean) },
            startup: { asyncStartupHealthy: expect.any(Boolean) },
        });
        expect(typeof res.body.version).toBe('string');
    });

    // /health returned the full payload on its unauthenticated branch while
    // /health/live was gated, so service/version/environment and the db/redis
    // connectivity flags stayed public.
    test('omits internal metadata from the unauthenticated /health payload', async () => {
        const res = await request(prodApp).get('/health');

        expect([200, 503]).toContain(res.statusCode);
        expect(res.body.status).toBeDefined();
        expect(typeof res.body.timestamp).toBe('string');

        expect(res.body).not.toHaveProperty('service');
        expect(res.body).not.toHaveProperty('version');
        expect(res.body).not.toHaveProperty('environment');
        expect(res.body).not.toHaveProperty('db');
        expect(res.body).not.toHaveProperty('redis');
        expect(JSON.stringify(res.body)).not.toMatch(/aura-marketplace-api|mongodb|redis/i);
    }, 30000);

    test('returns full details from /health to an operator with the token', async () => {
        const res = await request(prodApp)
            .get('/health')
            .set('x-health-token', 'test-health-token');

        expect([200, 503]).toContain(res.statusCode);
        expect(res.body).toHaveProperty('service', 'aura-marketplace-api');
        expect(res.body).toHaveProperty('version');
        expect(res.body).toHaveProperty('environment');
        expect(res.body).toHaveProperty('redis');
    }, 30000);
});