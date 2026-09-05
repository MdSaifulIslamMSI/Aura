'use strict';

const express = require('express');
const request = require('supertest');

const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { __getBufferedEvents, __resetBufferedEvents } = require('../security/securityEventLogger');

// Fresh limiter name per test: the memory window store is module-level,
// so tests must not share a limiter identity.
const buildApp = (name) => {
    const app = express();
    app.set('trust proxy', false);
    app.use(express.json());
    app.post('/login', createDistributedRateLimit({
        allowInMemoryFallback: true,
        name,
        windowMs: 60 * 1000,
        max: 2,
        message: { message: 'Too many attempts' },
    }), (_req, res) => res.json({ ok: true }));
    return app;
};

const uniqueLimiter = (tag) => `phase2-hit-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('rate-limit hit telemetry (Phase 2)', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'development';
        __resetBufferedEvents();
    });

    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
        __resetBufferedEvents();
    });

    test('emits a structured hit event on 429 with limiter identity', async () => {
        const limiter = uniqueLimiter('deny');
        const app = buildApp(limiter);
        await request(app).post('/login').send({});
        await request(app).post('/login').send({});
        const res = await request(app).post('/login').send({});

        expect(res.statusCode).toBe(429);
        const hits = __getBufferedEvents().filter((e) => e.event === 'rate_limit.hit');
        expect(hits.length).toBe(1);
        expect(hits[0]).toMatchObject({
            decision: 'THROTTLE',
            reasonCode: 'rate_limit_exceeded',
            action: limiter,
        });
        expect(hits[0].metadata).toMatchObject({ limiter, max: 2 });
        expect(hits[0].metadata.count).toBeGreaterThan(2);
    });

    test('emits nothing while under the limit', async () => {
        const app = buildApp(uniqueLimiter('allow'));
        const res = await request(app).post('/login').send({});

        expect(res.statusCode).toBe(200);
        expect(__getBufferedEvents().filter((e) => e.event === 'rate_limit.hit')).toHaveLength(0);
    });
});
