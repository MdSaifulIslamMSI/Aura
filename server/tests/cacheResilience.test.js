const express = require('express');
const request = require('supertest');

const { cachePolicy } = require('../middleware/cachePolicy');
const { ROUTE_CLASSES } = require('../config/trafficBudgets');

const buildApp = (routeClass) => {
    const app = express();
    app.use((req, _res, next) => {
        req.trafficRouteClass = routeClass;
        next();
    });
    app.use(cachePolicy());
    app.get('/test', (_req, res) => res.json({ ok: true }));
    return app;
};

describe('traffic cache policy', () => {
    test('keeps authenticated reads private', async () => {
        const response = await request(buildApp(ROUTE_CLASSES.AUTHENTICATED_READ))
            .get('/test')
            .expect(200);

        expect(response.headers['cache-control']).toBe('no-store');
    });

    test('keeps password reset finalization private', async () => {
        const response = await request(buildApp(ROUTE_CLASSES.OTP_RESET))
            .get('/test')
            .expect(200);

        expect(response.headers['cache-control']).toBe('no-store');
    });

    test('adds stale-while-revalidate to public search routes', async () => {
        const response = await request(buildApp(ROUTE_CLASSES.PUBLIC_SEARCH))
            .get('/test')
            .expect(200);

        expect(response.headers['cache-control']).toContain('public, max-age=30');
        expect(response.headers['cache-control']).toContain('stale-while-revalidate=120');
    });

    test('uses short public cache for status routes', async () => {
        const response = await request(buildApp(ROUTE_CLASSES.STATUS_PUBLIC))
            .get('/test')
            .expect(200);

        expect(response.headers['cache-control']).toContain('max-age=15');
        expect(response.headers['cache-control']).toContain('stale-while-revalidate=60');
    });
});
