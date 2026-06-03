const express = require('express');
const request = require('supertest');

jest.mock('../metrics/trafficResilienceMetrics', () => ({
    recordTrafficAbuseEvent: jest.fn(),
    recordTrafficBudgetDenied: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const buildApp = () => {
    const { abuseShield } = require('../middleware/abuseShield');
    const app = express();
    app.use(abuseShield());
    app.get('/api/products', (_req, res) => res.json({ ok: true }));
    return app;
};

const buildHealthApp = () => {
    const { ROUTE_CLASSES } = require('../config/trafficBudgets');
    const { abuseShield } = require('../middleware/abuseShield');
    const app = express();
    app.use((req, _res, next) => {
        req.trafficRouteClass = ROUTE_CLASSES.HEALTH;
        next();
    });
    app.use(abuseShield());
    app.get('/health/ready', (_req, res) => res.json({ ok: true }));
    return app;
};

describe('abuseShield', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('observes suspicious traffic without blocking when blocking is disabled', async () => {
        jest.doMock('../services/abuseScoreService', () => ({
            isDenied: jest.fn().mockResolvedValue(false),
            scoreRequest: jest.fn(() => ({ score: 50, action: 'challenge', reasons: ['sample'] })),
        }));

        const response = await request(buildApp())
            .get('/api/products')
            .set('User-Agent', 'sample-scanner')
            .expect(200);

        expect(response.body.ok).toBe(true);
    });

    test('blocks high-risk traffic when blocking is enabled', async () => {
        process.env.ABUSE_SHIELD_BLOCKING_ENABLED = 'true';
        jest.doMock('../services/abuseScoreService', () => ({
            isDenied: jest.fn().mockResolvedValue(false),
            scoreRequest: jest.fn(() => ({ score: 100, action: 'block', reasons: ['sample'] })),
        }));

        const response = await request(buildApp())
            .get('/api/products')
            .expect(403);

        expect(response.body.code).toBe('ABUSE_SHIELD_BLOCKED');
        expect(response.headers['cache-control']).toBe('no-store');
    });

    test('honors temporary denylist decisions', async () => {
        jest.doMock('../services/abuseScoreService', () => ({
            isDenied: jest.fn().mockResolvedValue(true),
            scoreRequest: jest.fn(() => ({ score: 0, action: 'allow', reasons: [] })),
        }));

        const response = await request(buildApp())
            .get('/api/products')
            .expect(403);

        expect(response.body.code).toBe('TEMPORARY_ABUSE_BLOCK');
    });

    test('does not block health checks through abuse scoring or denylist', async () => {
        const isDenied = jest.fn().mockResolvedValue(true);
        const scoreRequest = jest.fn(() => ({ score: 100, action: 'block', reasons: ['sample'] }));
        jest.doMock('../services/abuseScoreService', () => ({
            isDenied,
            scoreRequest,
        }));

        const response = await request(buildHealthApp())
            .get('/health/ready')
            .expect(200);

        expect(response.body.ok).toBe(true);
        expect(isDenied).not.toHaveBeenCalled();
        expect(scoreRequest).not.toHaveBeenCalled();
    });
});
