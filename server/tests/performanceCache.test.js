const express = require('express');
const request = require('supertest');

const ORIGINAL_ENV = { ...process.env };

const configureCacheEnv = (overrides = {}) => {
    process.env = {
        ...ORIGINAL_ENV,
        NODE_ENV: 'test',
        PERFORMANCE_STACK_ENABLED: 'true',
        CACHE_ENABLED: 'true',
        CACHE_PROVIDER: 'memory',
        CACHE_DEFAULT_TTL_SECONDS: '60',
        CACHE_PUBLIC_GET_TTL_SECONDS: '120',
        CACHE_STALE_WHILE_REVALIDATE_SECONDS: '30',
        CACHE_MAX_VALUE_BYTES: '1048576',
        CACHE_BYPASS_AUTH: 'true',
        CACHE_BYPASS_COOKIE: 'true',
        CACHE_BYPASS_PRIVATE_ROUTES: 'true',
        CACHE_ALLOWED_PATH_PREFIXES: '/api/public,/health,/status',
        CACHE_DENIED_PATH_PREFIXES: '/api/auth,/api/admin,/api/user,/api/me,/api/payment,/api/upload,/api/uploads,/api/webhooks',
        ...overrides,
    };
};

const buildApp = (overrides = {}) => {
    jest.resetModules();
    configureCacheEnv(overrides);
    const {
        createPublicCacheMiddleware,
        publicCacheInvalidationMiddleware,
        __resetCacheForTests,
    } = require('../performance/cache');

    const app = express();
    app.use(express.json());
    app.use(publicCacheInvalidationMiddleware());
    app.use(createPublicCacheMiddleware());

    return { app, resetCache: __resetCacheForTests };
};

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe('performance public cache safety', () => {
    test('public GET can be cached', async () => {
        const { app, resetCache } = buildApp();
        let calls = 0;
        app.get('/api/public/products', (req, res) => {
            calls += 1;
            res.json({ calls });
        });

        const first = await request(app).get('/api/public/products').expect(200);
        const second = await request(app).get('/api/public/products').expect(200);

        expect(first.headers['x-cache']).toBe('MISS');
        expect(second.headers['x-cache']).toBe('HIT');
        expect(second.body).toEqual({ calls: 1 });
        await resetCache();
    });

    test('Authorization request bypasses cache', async () => {
        const { app, resetCache } = buildApp();
        let calls = 0;
        app.get('/api/public/products', (req, res) => res.json({ calls: ++calls }));

        await request(app).get('/api/public/products').set('Authorization', 'Bearer token').expect('X-Cache', 'BYPASS');
        const second = await request(app).get('/api/public/products').set('Authorization', 'Bearer token').expect(200);

        expect(second.body.calls).toBe(2);
        await resetCache();
    });

    test('Cookie request bypasses cache', async () => {
        const { app, resetCache } = buildApp();
        let calls = 0;
        app.get('/api/public/products', (req, res) => res.json({ calls: ++calls }));

        await request(app).get('/api/public/products').set('Cookie', 'session=private').expect('X-Cache', 'BYPASS');
        const second = await request(app).get('/api/public/products').set('Cookie', 'session=private').expect(200);

        expect(second.body.calls).toBe(2);
        await resetCache();
    });

    test('admin route bypasses cache', async () => {
        const { app, resetCache } = buildApp();
        app.get('/api/admin/stats', (req, res) => res.json({ ok: true }));

        const response = await request(app).get('/api/admin/stats').expect(200);

        expect(response.headers['x-cache']).toBe('BYPASS');
        await resetCache();
    });

    test('user route bypasses cache', async () => {
        const { app, resetCache } = buildApp();
        app.get('/api/user/profile', (req, res) => res.json({ ok: true }));

        const response = await request(app).get('/api/user/profile').expect(200);

        expect(response.headers['x-cache']).toBe('BYPASS');
        await resetCache();
    });

    test('payment route bypasses cache', async () => {
        const { app, resetCache } = buildApp();
        app.get('/api/payment/quote', (req, res) => res.json({ ok: true }));

        const response = await request(app).get('/api/payment/quote').expect(200);

        expect(response.headers['x-cache']).toBe('BYPASS');
        await resetCache();
    });

    test('upload route bypasses cache', async () => {
        const { app, resetCache } = buildApp();
        app.get('/api/upload/file', (req, res) => res.json({ ok: true }));

        const response = await request(app).get('/api/upload/file').expect(200);

        expect(response.headers['x-cache']).toBe('BYPASS');
        await resetCache();
    });

    test('POST bypasses cache and invalidates cached public data', async () => {
        const { app, resetCache } = buildApp();
        let calls = 0;
        app.get('/api/public/products', (req, res) => res.json({ calls: ++calls }));
        app.post('/api/public/products', (req, res) => res.json({ ok: true }));

        await request(app).get('/api/public/products').expect(200);
        await request(app).get('/api/public/products').expect('X-Cache', 'HIT');
        await request(app).post('/api/public/products').send({ title: 'New' }).expect('X-Cache', 'BYPASS');
        const afterMutation = await request(app).get('/api/public/products').expect(200);

        expect(afterMutation.headers['x-cache']).toBe('MISS');
        expect(afterMutation.body.calls).toBe(2);
        await resetCache();
    });

    test('Set-Cookie response is not cached', async () => {
        const { app, resetCache } = buildApp();
        let calls = 0;
        app.get('/api/public/products', (req, res) => {
            res.cookie('session', 'private');
            res.json({ calls: ++calls });
        });

        await request(app).get('/api/public/products').expect('X-Cache', 'BYPASS');
        const second = await request(app).get('/api/public/products').expect(200);

        expect(second.headers['x-cache']).toBe('BYPASS');
        expect(second.body.calls).toBe(2);
        await resetCache();
    });

    test('500 response is not cached', async () => {
        const { app, resetCache } = buildApp();
        let calls = 0;
        app.get('/api/public/products', (req, res) => res.status(500).json({ calls: ++calls }));

        await request(app).get('/api/public/products').expect('X-Cache', 'BYPASS').expect(500);
        const second = await request(app).get('/api/public/products').expect(500);

        expect(second.headers['x-cache']).toBe('BYPASS');
        expect(second.body.calls).toBe(2);
        await resetCache();
    });

    test('cache failure does not crash app', async () => {
        const { app, resetCache } = buildApp({
            CACHE_PROVIDER: 'redis',
            REDIS_URL: '',
        });
        app.get('/api/public/products', (req, res) => res.json({ ok: true }));

        const response = await request(app).get('/api/public/products').expect(200);

        expect(['MISS', 'ERROR']).toContain(response.headers['x-cache']);
        expect(response.body).toEqual({ ok: true });
        await resetCache();
    });
});
