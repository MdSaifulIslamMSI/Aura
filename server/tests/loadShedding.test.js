const express = require('express');
const request = require('supertest');

const { ROUTE_CLASSES } = require('../config/trafficBudgets');
const { getLoadSheddingState, loadShedding } = require('../middleware/loadShedding');

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

const buildApp = (routeClass) => {
    const app = express();
    app.use((req, _res, next) => {
        req.trafficRouteClass = routeClass;
        next();
    });
    app.use(loadShedding());
    app.get('/test', (_req, res) => res.json({ ok: true }));
    return app;
};

describe('load shedding', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    test('detects forced overload for drills', () => {
        const state = getLoadSheddingState({
            TRAFFIC_FORTRESS_FORCE_OVERLOAD: 'yes',
            TRAFFIC_FORTRESS_ENABLED: 'true',
        });

        expect(state.overloaded).toBe(true);
        expect(state.forceOverload).toBe(true);
    });

    test('sheds degradable routes while overloaded', async () => {
        process.env.TRAFFIC_FORTRESS_FORCE_OVERLOAD = 'yes';

        const response = await request(buildApp(ROUTE_CLASSES.PUBLIC_SEARCH))
            .get('/test')
            .expect(503);

        expect(response.body.code).toBe('TRAFFIC_LOAD_SHEDDING');
    });

    test('keeps health traffic reachable while overloaded', async () => {
        process.env.TRAFFIC_FORTRESS_FORCE_OVERLOAD = 'yes';

        const response = await request(buildApp(ROUTE_CLASSES.HEALTH))
            .get('/test')
            .expect(200);

        expect(response.body.ok).toBe(true);
    });
});
