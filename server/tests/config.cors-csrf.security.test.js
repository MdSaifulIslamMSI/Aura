const express = require('express');
const request = require('supertest');

const mockCsrfRedisStore = new Map();

const mockEvaluateCsrfToken = async (_script, options = {}) => {
    const key = options.keys?.[0];
    const args = options.arguments || [];
    const record = mockCsrfRedisStore.get(key);
    if (!record) return 'missing';

    let stored;
    try {
        stored = JSON.parse(record.value);
    } catch (_) {
        mockCsrfRedisStore.delete(key);
        return 'invalid_record';
    }

    if (!stored || typeof stored !== 'object' || Number(stored.expiresAt || 0) <= Number(args[0])) {
        mockCsrfRedisStore.delete(key);
        return 'expired';
    }

    const metadata = stored.metadata || {};
    const text = (value) => (value === undefined || value === null ? '' : String(value));
    const expectedUid = text(metadata.uid) || 'anonymous';
    if (expectedUid !== args[1]) return 'principal_mismatch';
    if (text(metadata.strictOrigin) && text(metadata.strictOrigin) !== args[2]) return 'origin_mismatch';
    if (text(metadata.sessionId) && text(metadata.sessionId) !== args[3]) return 'session_mismatch';
    if (text(metadata.deviceFingerprint) && text(metadata.deviceFingerprint) !== args[4]) return 'device_mismatch';

    const ipMismatch = Boolean(text(metadata.ip) && args[5] && text(metadata.ip) !== args[5]);
    const userAgentMismatch = Boolean(text(metadata.userAgent) && args[6] && text(metadata.userAgent) !== args[6]);
    if (args[7] === '1' && (ipMismatch || userAgentMismatch)) return 'client_signal_mismatch';

    mockCsrfRedisStore.delete(key);
    if (ipMismatch && userAgentMismatch) return 'ok:ip,user_agent';
    if (ipMismatch) return 'ok:ip';
    if (userAgentMismatch) return 'ok:user_agent';
    return 'ok';
};

jest.mock('../config/redis', () => ({
    getRedisClient: () => ({
        setEx: async (key, ttl, value) => {
            mockCsrfRedisStore.set(key, {
                value,
                expiresAt: Date.now() + (ttl * 1000),
            });
            return 'OK';
        },
        get: async (key) => {
            const record = mockCsrfRedisStore.get(key);
            if (!record) return null;
            if (record.expiresAt < Date.now()) {
                mockCsrfRedisStore.delete(key);
                return null;
            }
            return record.value;
        },
        del: async (key) => {
            mockCsrfRedisStore.delete(key);
            return 1;
        },
        eval: mockEvaluateCsrfToken,
    }),
    flags: { redisPrefix: 'csrf-security-test' },
}));

const app = require('../index');
const Product = require('../models/Product');
const {
    csrfTokenGenerator,
    csrfTokenValidator,
} = require('../middleware/csrfMiddleware');
const {
    assertSafeStatus,
    createFakeProduct,
    expectDocumentUnchanged,
} = require('./helpers/securityTestHelpers');

const buildCsrfHarness = () => {
    const harness = express();
    harness.use(express.json());
    harness.use((req, _res, next) => {
        req.user = { id: 'csrf-user-a' };
        req.authUid = 'csrf-user-a';
        next();
    });
    harness.get('/csrf-token', csrfTokenGenerator, (_req, res) => res.json({ ok: true }));
    harness.post('/state-change', csrfTokenValidator, (_req, res) => res.json({ changed: true }));
    harness.get('/safe-read', csrfTokenValidator, (_req, res) => res.json({ ok: true }));
    harness.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message,
            code: err.code,
        });
    });
    return harness;
};

describe('CORS and CSRF security', () => {
    beforeEach(() => {
        mockCsrfRedisStore.clear();
    });

    test('configured frontend origin is allowed without wildcard credentials', async () => {
        const response = await request(app)
            .post('/api/auth/sync')
            .set('Origin', 'http://localhost:5173')
            .send({});

        assertSafeStatus(response, [401]);
        expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['access-control-allow-origin']).not.toBe('*');
    });

    test('random evil origin is rejected and does not mutate admin product state', async () => {
        const product = await createFakeProduct({ title: 'CORS Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        const response = await request(app)
            .post('/api/admin/products')
            .set('Origin', 'https://evil.example')
            .send({
                title: 'Attacker Product',
                price: 1,
            });

        assertSafeStatus(response, [403]);
        expect(response.body.message).toMatch(/origin not allowed/i);
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });

    test('null origin is rejected for admin APIs and leaves state unchanged', async () => {
        const product = await createFakeProduct({ title: 'Null Origin Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        const response = await request(app)
            .post('/api/admin/products')
            .set('Origin', 'null')
            .send({
                title: 'Null Origin Product',
                price: 1,
            });

        assertSafeStatus(response, [403]);
        expect(response.body.message).toMatch(/origin not allowed/i);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });

    test('cookie-style state change without CSRF token is rejected and leaves state unchanged', async () => {
        const harness = buildCsrfHarness();
        const product = await createFakeProduct({ title: 'CSRF Missing Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        const response = await request(harness)
            .post('/state-change')
            .set('Cookie', 'aura_sid=session-security')
            .send({ mutate: true });

        assertSafeStatus(response, [403]);
        expect(response.body.code).toBe('CSRF_TOKEN_MISSING');
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });

    test('wrong CSRF token is rejected and leaves state unchanged', async () => {
        const harness = buildCsrfHarness();
        const product = await createFakeProduct({ title: 'CSRF Wrong Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        const response = await request(harness)
            .post('/state-change')
            .set('Cookie', 'aura_sid=session-security')
            .set('X-CSRF-Token', 'wrong-csrf-token')
            .send({ mutate: true });

        assertSafeStatus(response, [403]);
        expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });

    test('valid CSRF token is accepted and safe GET does not require a token', async () => {
        const harness = buildCsrfHarness();
        const tokenResponse = await request(harness)
            .get('/csrf-token')
            .set('Cookie', 'aura_sid=session-security')
            .set('Host', 'localhost:3000')
            .set('User-Agent', 'csrf-security-agent');
        const token = tokenResponse.headers['x-csrf-token'];
        expect(token).toBeTruthy();

        const postResponse = await request(harness)
            .post('/state-change')
            .set('Cookie', 'aura_sid=session-security')
            .set('X-CSRF-Token', token)
            .set('Host', 'localhost:3000')
            .set('User-Agent', 'csrf-security-agent')
            .send({ mutate: true });
        expect(postResponse.statusCode).toBe(200);
        expect(postResponse.body).toEqual({ changed: true });

        const getResponse = await request(harness)
            .get('/safe-read')
            .set('Cookie', 'aura_sid=session-security')
            .set('Host', 'localhost:3000')
            .set('User-Agent', 'csrf-security-agent');
        expect(getResponse.statusCode).toBe(200);
        expect(getResponse.body).toEqual({ ok: true });
    });
});
