const express = require('express');
const request = require('supertest');

const { shouldBlockForAttackMode } = require('../config/attackMode');
const { ROUTE_CLASSES } = require('../config/trafficBudgets');
const { attackModeGuard } = require('../middleware/attackModeGuard');

jest.mock('../metrics/trafficResilienceMetrics', () => ({
    recordTrafficBudgetDenied: jest.fn(),
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
    app.use(attackModeGuard());
    app.post('/api/test', (_req, res) => res.json({ ok: true }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));
    return app;
};

describe('attack mode guard', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    test('blocks configured expensive route classes during attack mode', () => {
        expect(shouldBlockForAttackMode({
            routeClass: ROUTE_CLASSES.AI_EXPENSIVE,
            method: 'POST',
            path: '/api/ai/chat',
            config: { trafficFortressEnabled: true, attackMode: true, blockAi: true },
        })).toBe(true);
    });

    test('blocks password reset finalization with strict auth during attack mode', () => {
        expect(shouldBlockForAttackMode({
            routeClass: ROUTE_CLASSES.OTP_RESET,
            method: 'POST',
            path: '/api/auth/otp/reset-password',
            config: { trafficFortressEnabled: true, attackMode: true, strictAuth: true },
        })).toBe(true);
    });

    test('keeps webhook and health classes reachable during attack mode', () => {
        const config = { trafficFortressEnabled: true, attackMode: true, blockAi: true, blockUploads: true, strictAuth: true, publicReadOnly: true };

        expect(shouldBlockForAttackMode({
            routeClass: ROUTE_CLASSES.WEBHOOK,
            method: 'POST',
            path: '/api/payments/webhooks/stripe',
            config,
        })).toBe(false);
        expect(shouldBlockForAttackMode({
            routeClass: ROUTE_CLASSES.HEALTH,
            method: 'GET',
            path: '/health/live',
            config,
        })).toBe(false);
    });

    test('returns 503 for disabled write surfaces in attack mode', async () => {
        process.env.ATTACK_MODE = 'true';
        process.env.ATTACK_MODE_PUBLIC_READ_ONLY = 'true';

        const response = await request(buildApp(ROUTE_CLASSES.AUTHENTICATED_WRITE))
            .post('/api/test')
            .expect(503);

        expect(response.body.code).toBe('ATTACK_MODE_ROUTE_DISABLED');
        expect(response.headers['cache-control']).toBe('no-store');
    });
});
