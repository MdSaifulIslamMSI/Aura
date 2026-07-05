const express = require('express');
const request = require('supertest');

const { requestId } = require('../middleware/requestId');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { bodySizeGuard } = require('../middleware/bodySizeGuards');
const { loadShedding } = require('../middleware/loadShedding');
const { ROUTE_CLASSES, getTrafficBudget } = require('../config/trafficBudgets');

jest.mock('../metrics/trafficResilienceMetrics', () => ({
    recordTrafficBudgetDenied: jest.fn(),
    setTrafficLoadSheddingState: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

const withBudget = (routeClass) => (req, _res, next) => {
    req.trafficRouteClass = routeClass;
    req.trafficBudget = getTrafficBudget(routeClass);
    next();
};

describe('traffic response smoothness', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.dontMock('../middleware/distributedRateLimit');
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('429 responses include requestId and safe retryAfter without policy internals', async () => {
        process.env.NODE_ENV = 'development';
        const app = express();
        app.use(requestId);
        app.use(createDistributedRateLimit({
            allowInMemoryFallback: true,
            name: `smoothness_${Date.now()}`,
            windowMs: 60 * 1000,
            max: 1,
            message: (req, context = {}) => ({
                success: false,
                code: 'AUTH_BUDGET_EXCEEDED',
                message: 'Too many requests for this route. Please slow down and try again.',
                requestId: req.requestId || '',
                retryAfter: context.retryAfterSeconds,
            }),
            keyGenerator: () => 'fixed-smoothness-user',
        }));
        app.get('/test', (_req, res) => res.json({ ok: true }));

        await request(app).get('/test').set('X-Request-Id', 'req-rate-1').expect(200);
        const response = await request(app).get('/test').set('X-Request-Id', 'req-rate-2').expect(429);

        expect(response.headers['retry-after']).toMatch(/^\d+$/);
        expect(response.body).toMatchObject({
            success: false,
            code: 'AUTH_BUDGET_EXCEEDED',
            requestId: 'req-rate-2',
        });
        expect(response.body.retryAfter).toBeGreaterThan(0);
        expect(JSON.stringify(response.body)).not.toMatch(/fail-closed|perIp|redis|policy/i);
    });

    test('503 overload responses include requestId and no retryAfter promise', async () => {
        process.env.TRAFFIC_FORTRESS_FORCE_OVERLOAD = 'yes';
        const app = express();
        app.use(requestId);
        app.use(withBudget(ROUTE_CLASSES.PUBLIC_SEARCH));
        app.use(loadShedding());
        app.get('/search', (_req, res) => res.json({ ok: true }));

        const response = await request(app).get('/search').set('X-Request-Id', 'req-shed-1').expect(503);

        expect(response.body).toMatchObject({
            success: false,
            code: 'TRAFFIC_LOAD_SHEDDING',
            requestId: 'req-shed-1',
        });
        expect(response.body.retryAfter).toBeUndefined();
        expect(JSON.stringify(response.body)).not.toMatch(/eventLoop|activeRequests|policy/i);
    });

    test('auth throttling response does not enumerate email or phone inputs', async () => {
        process.env.NODE_ENV = 'production';
        jest.resetModules();
        jest.doMock('../middleware/distributedRateLimit', () => ({
            createDistributedRateLimit: jest.fn((options) => (req, res) => res.status(429).json(options.message(req, { retryAfterSeconds: 60 }))),
        }));
        jest.doMock('../metrics/trafficResilienceMetrics', () => ({
            recordTrafficBudgetDenied: jest.fn(),
        }));

        const { trafficBudgetPolicy } = require('../middleware/trafficBudgetPolicy');
        const app = express();
        app.use(express.json());
        app.use(requestId);
        app.use(withBudget(ROUTE_CLASSES.AUTH_LOGIN));
        app.use(trafficBudgetPolicy());
        app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));

        const response = await request(app)
            .post('/api/auth/login')
            .set('X-Request-Id', 'req-auth-1')
            .send({ email: 'person@example.com', phone: '+15551234567' })
            .expect(429);

        expect(response.body.requestId).toBe('req-auth-1');
        expect(JSON.stringify(response.body)).not.toContain('person@example.com');
        expect(JSON.stringify(response.body)).not.toContain('+15551234567');
    });

    test('admin/security body-size errors do not leak internal policy details', async () => {
        const app = express();
        app.use(requestId);
        app.use(withBudget(ROUTE_CLASSES.ADMIN_WRITE));
        app.use(bodySizeGuard());
        app.post('/api/admin/security', (_req, res) => res.json({ ok: true }));

        const response = await request(app)
            .post('/api/admin/security')
            .set('X-Request-Id', 'req-admin-1')
            .set('Content-Length', String(getTrafficBudget(ROUTE_CLASSES.ADMIN_WRITE).maxBodyBytes + 1))
            .expect(413);

        expect(response.body).toMatchObject({
            success: false,
            code: 'TRAFFIC_BODY_TOO_LARGE',
            requestId: 'req-admin-1',
        });
        expect(JSON.stringify(response.body)).not.toMatch(/ADMIN_WRITE|adminSensitiveActions|fail-closed|perIp/i);
    });
});
