const express = require('express');
const request = require('supertest');

const Product = require('../models/Product');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    assertSafeStatus,
    createFakeProduct,
    expectDocumentUnchanged,
    randomSuffix,
} = require('./helpers/securityTestHelpers');

const buildLimiterHarness = ({ max = 2, keyGenerator } = {}) => {
    const app = express();
    app.set('trust proxy', false);
    app.use(express.json());
    app.post('/login', createDistributedRateLimit({
        allowInMemoryFallback: true,
        name: randomSuffix('security-rate-limit'),
        windowMs: 60 * 1000,
        max,
        message: { message: 'Too many attempts' },
        keyGenerator,
    }), (_req, res) => res.json({ ok: true }));
    return app;
};

describe('rate-limit bypass security', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'development';
    });

    afterEach(() => {
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
    });

    test('spoofed IP headers do not bypass an untrusted-proxy limiter', async () => {
        const app = buildLimiterHarness({
            max: 2,
            keyGenerator: (req) => req.ip || 'unknown',
        });
        const product = await createFakeProduct({ title: 'Rate Limit Spoof Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        await request(app)
            .post('/login')
            .set('X-Forwarded-For', '198.51.100.10')
            .set('X-Real-IP', '198.51.100.10')
            .set('CF-Connecting-IP', '198.51.100.10')
            .send({ email: 'victim@example.test', password: 'wrong' })
            .expect(200);
        await request(app)
            .post('/login')
            .set('X-Forwarded-For', '198.51.100.11')
            .set('X-Real-IP', '198.51.100.11')
            .set('CF-Connecting-IP', '198.51.100.11')
            .send({ email: 'victim@example.test', password: 'wrong' })
            .expect(200);

        const blocked = await request(app)
            .post('/login')
            .set('X-Forwarded-For', '198.51.100.12')
            .set('X-Real-IP', '198.51.100.12')
            .set('CF-Connecting-IP', '198.51.100.12')
            .send({ email: 'victim@example.test', password: 'wrong' });

        assertSafeStatus(blocked, [429]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });

    test('parallel requests cannot all bypass the same limiter window', async () => {
        const app = buildLimiterHarness({
            max: 1,
            keyGenerator: (req) => req.ip || 'unknown',
        });
        const product = await createFakeProduct({ title: 'Rate Limit Parallel Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        const responses = await Promise.all([
            request(app)
                .post('/login')
                .set('X-Forwarded-For', '203.0.113.10')
                .send({ email: 'parallel@example.test', password: 'wrong' }),
            request(app)
                .post('/login')
                .set('X-Forwarded-For', '203.0.113.11')
                .send({ email: 'parallel@example.test', password: 'wrong' }),
        ]);

        expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 429]);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });

    test('identifier-aware limiter blocks the abused user without locking unrelated users', async () => {
        const app = buildLimiterHarness({
            max: 1,
            keyGenerator: (req) => `${req.ip || 'unknown'}:${String(req.body?.email || '').toLowerCase()}`,
        });
        const product = await createFakeProduct({ title: 'Rate Limit Fairness Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        await request(app)
            .post('/login')
            .send({ email: 'victim@example.test', password: 'wrong' })
            .expect(200);
        const victimBlocked = await request(app)
            .post('/login')
            .send({ email: 'victim@example.test', password: 'wrong' });
        const unrelatedUser = await request(app)
            .post('/login')
            .send({ email: 'friend@example.test', password: 'wrong' });

        assertSafeStatus(victimBlocked, [429]);
        expect(unrelatedUser.statusCode).toBe(200);
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });
});
