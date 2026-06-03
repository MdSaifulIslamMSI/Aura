const express = require('express');
const request = require('supertest');

const { queryBudgetGuard } = require('../middleware/queryBudgetGuard');
const { ROUTE_CLASSES } = require('../config/trafficBudgets');

jest.mock('../metrics/trafficResilienceMetrics', () => ({
    recordTrafficBudgetDenied: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const buildApp = (routeClass = ROUTE_CLASSES.PUBLIC_SEARCH) => {
    const app = express();
    app.use((req, _res, next) => {
        req.trafficRouteClass = routeClass;
        next();
    });
    app.use(queryBudgetGuard());
    app.get('/api/products', (_req, res) => res.json({ ok: true }));
    return app;
};

describe('database pressure resilience', () => {
    test('rejects unbounded public page sizes', async () => {
        const response = await request(buildApp())
            .get('/api/products?limit=10000')
            .expect(400);

        expect(response.body.code).toBe('QUERY_BUDGET_EXCEEDED');
        expect(response.headers['cache-control']).toBe('no-store');
    });

    test('rejects excessively long search terms', async () => {
        const response = await request(buildApp())
            .get(`/api/products?search=${'a'.repeat(200)}`)
            .expect(400);

        expect(response.body.code).toBe('QUERY_BUDGET_EXCEEDED');
    });

    test('allows bounded public search queries', async () => {
        const response = await request(buildApp())
            .get('/api/products?search=phone&limit=20')
            .expect(200);

        expect(response.body.ok).toBe(true);
    });
});
