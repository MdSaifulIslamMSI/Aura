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

// `shouldExposeDetailedHealth` returns true for every non-production runtime, so the
// route tests above only ever observe the detailed payload — including in CI,
// where NODE_ENV=test. Pinning the production wire shape therefore has to happen
// at the disclosure-service level.
//
// This block deliberately does NOT re-require('../index') under NODE_ENV=production.
// Doing so boots the entire server a second time — index -> productRoutes ->
// authMiddleware -> config/firebase — and Firebase initialisation fails in CI, which
// has no service-account material. buildPublicHealthPayload is a pure function, so
// testing it directly covers the same contract without the fragile full-app reload.
describe('healthDisclosureService production wire shape', () => {
    const {
        buildPublicHealthPayload,
        shouldExposeDetailedHealth,
    } = require('../services/healthDisclosureService');

    const core = { dbConnected: true, redisConnected: true };

    test('detailed:false exposes only status and timestamp', () => {
        const payload = buildPublicHealthPayload({
            status: 'ok',
            core,
            uptime: 1234.5,
            timestamp: '2026-10-14T00:00:00.000Z',
            detailed: false,
        });

        expect(payload).toEqual({
            status: 'ok',
            timestamp: '2026-10-14T00:00:00.000Z',
        });
        expect(payload).not.toHaveProperty('service');
        expect(payload).not.toHaveProperty('version');
        expect(payload).not.toHaveProperty('environment');
        expect(payload).not.toHaveProperty('db');
        expect(payload).not.toHaveProperty('redis');
        expect(JSON.stringify(payload)).not.toMatch(/aura-marketplace-api|mongodb|redis/i);
    });

    test('the detailed payload is unchanged for authorised operators', () => {
        const payload = buildPublicHealthPayload({ status: 'ok', core, uptime: 10 });

        expect(payload).toMatchObject({
            status: 'ok',
            service: expect.any(String),
            version: expect.any(String),
            environment: expect.any(String),
            db: 'connected',
            redis: { connected: true },
            uptime: 10,
        });
    });

    test('defaults to the detailed shape when no flag is passed', () => {
        // Preserves every existing caller that relies on the previous behaviour.
        expect(buildPublicHealthPayload({ status: 'ok', core })).toHaveProperty('service');
    });

    test('production withholds details without the token and releases them with it', () => {
        const base = { healthReadyToken: 'test-health-token', runtimeNodeEnv: 'production' };

        expect(shouldExposeDetailedHealth({ ...base, req: { headers: {} } })).toBe(false);
        expect(shouldExposeDetailedHealth({
            ...base,
            req: { headers: { 'x-health-token': 'wrong' } },
        })).toBe(false);
        expect(shouldExposeDetailedHealth({
            ...base,
            req: { headers: { 'x-health-token': 'test-health-token' } },
        })).toBe(true);
    });

    test('non-production runtimes still expose details, matching the route tests above', () => {
        expect(shouldExposeDetailedHealth({
            healthReadyToken: 'test-health-token',
            runtimeNodeEnv: 'test',
            req: { headers: {} },
        })).toBe(true);
    });
});
