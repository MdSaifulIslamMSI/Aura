const express = require('express');
const request = require('supertest');
const securityCanaryRoutes = require('../../routes/securityCanaryRoutes');
const { __resetCanaryTouches } = require('../../security/canaryService');
const {
    __getBufferedEvents,
    __resetBufferedEvents,
} = require('../../security/securityEventLogger');

const buildApp = () => {
    const app = express();
    app.use((req, _res, next) => {
        req.requestId = 'req-1';
        next();
    });
    app.use(securityCanaryRoutes);
    return app;
};

describe('securityCanaryRoutes', () => {
    beforeEach(() => {
        __resetCanaryTouches();
        __resetBufferedEvents();
    });

    test('canary route touch returns generic response and logs event', async () => {
        const app = buildApp();
        const res = await request(app).get('/.env');

        expect([403, 404]).toContain(res.status);
        expect(res.body).toMatchObject({ message: 'Not found' });
        expect(__getBufferedEvents().some((event) => event.event === 'canary.touched')).toBe(true);
    });

    test('repeated canary touches trigger containment event', async () => {
        const app = buildApp();

        await request(app).get('/internal/debug');
        await request(app).get('/internal/debug');
        const res = await request(app).get('/internal/debug');

        expect(res.status).toBe(403);
        expect(__getBufferedEvents().some((event) => event.event === 'containment.triggered')).toBe(true);
    });
});
