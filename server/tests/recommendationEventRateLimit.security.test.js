// Regression proof for the dedicated rate limiter on anonymous recommendation
// event ingestion (route security matrix finding: the route previously relied
// only on the shared global API budget).
//
// The real app disables distributed limiters under NODE_ENV=test, so this
// harness requires the actual route module under development env where its
// in-memory fallback engages, and sends validation-rejecting bodies so
// requests stop at the validator without touching the controller.

const express = require('express');
const request = require('supertest');

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'development';
const recommendationEventRoutes = require('../routes/recommendationEventRoutes');

const devLimiterMax = 120;

describe('recommendation event ingestion rate limit', () => {
    afterAll(() => {
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
    });

    test('caps anonymous ingestion per IP after the configured budget', async () => {
        const app = express();
        app.set('trust proxy', false);
        app.use(express.json());
        app.use('/api/recommendation-events', recommendationEventRoutes);

        let lastStatus = 0;
        for (let attempt = 0; attempt < devLimiterMax; attempt += 1) {
            const res = await request(app)
                .post('/api/recommendation-events')
                .send({});
            lastStatus = res.statusCode;
            expect(res.statusCode).toBe(400); // validator rejection before the controller
        }

        const throttled = await request(app)
            .post('/api/recommendation-events')
            .send({});
        expect(throttled.statusCode).toBe(429);
        expect(lastStatus).toBe(400);
    });

    test('spoofed IP headers do not reset the anonymous bucket', async () => {
        const app = express();
        app.set('trust proxy', false);
        app.use(express.json());
        app.use('/api/recommendation-events', recommendationEventRoutes);

        for (let attempt = 0; attempt < devLimiterMax; attempt += 1) {
            await request(app)
                .post('/api/recommendation-events')
                .set('X-Forwarded-For', `198.51.100.${attempt % 250}`)
                .send({});
        }

        const res = await request(app)
            .post('/api/recommendation-events')
            .set('X-Forwarded-For', '203.0.113.7')
            .set('X-Real-IP', '203.0.113.7')
            .send({});
        expect(res.statusCode).toBe(429);
    });
});
