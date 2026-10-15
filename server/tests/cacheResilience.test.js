const express = require('express');
const request = require('supertest');

const { cachePolicy } = require('../middleware/cachePolicy');
const { ROUTE_CLASSES } = require('../config/trafficBudgets');
const { classifyRouteFromRegistry } = require('../config/trafficPolicyRegistry');

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

// Pipes the real classifier into the real middleware. The middleware only
// honours whatever route class it is handed, so a misclassified path stays
// invisible to any test that stubs `req.trafficRouteClass`.
const cacheControlFor = async (method, path) => {
    const app = express();
    app.use((req, _res, next) => {
        req.trafficRouteClass = classifyRouteFromRegistry({ method, path });
        next();
    });
    app.use(cachePolicy());
    app.get('/probe', (_req, res) => res.json({ ok: true }));
    const response = await request(app).get('/probe').expect(200);
    return response.headers['cache-control'];
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

    // Regression: every read under /api/users is session-scoped. While that
    // prefix sat on the public read rule these responses were served with
    // `Cache-Control: public`, which lets a shared cache store one user's
    // profile/wishlist/addresses and replay it to a different visitor.
    test.each([
        '/api/users/profile',
        '/api/users/dashboard',
        '/api/users/rewards',
        '/api/users/wishlist',
        '/api/users/addresses',
    ])('classifies %s as an authenticated read', (userPath) => {
        expect(classifyRouteFromRegistry({ method: 'GET', path: userPath }))
            .toBe(ROUTE_CLASSES.AUTHENTICATED_READ);
    });

    test.each([
        '/api/users/profile',
        '/api/users/dashboard',
        '/api/users/rewards',
        '/api/users/wishlist',
        '/api/users/addresses',
    ])('serves %s with no-store through the real classifier', async (userPath) => {
        await expect(cacheControlFor('GET', userPath)).resolves.toBe('no-store');
    });

    test('keeps unrelated public API reads cacheable', async () => {
        expect(classifyRouteFromRegistry({ method: 'GET', path: '/api/markets/fx-rates' }))
            .not.toBe(ROUTE_CLASSES.AUTHENTICATED_READ);

        const cacheControl = await cacheControlFor('GET', '/api/markets/fx-rates');
        expect(cacheControl).toContain('public');
    });
});