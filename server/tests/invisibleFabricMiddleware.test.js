const express = require('express');
const request = require('supertest');
const { requestId } = require('../middleware/requestId');
const {
    adminCloakMiddleware,
    blockProductionDebugRoutes,
    honeypotMiddleware,
    internalRouteCloakMiddleware,
} = require('../middleware/invisibleFabricMiddleware');

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const logger = require('../utils/logger');

const ORIGINAL_ENV = { ...process.env };

const buildApp = () => {
    const app = express();
    app.use(requestId);
    app.use(honeypotMiddleware);
    app.use(blockProductionDebugRoutes);
    app.use(adminCloakMiddleware);
    app.use(internalRouteCloakMiddleware);
    app.get('/api/admin/users', (req, res) => res.json({ admin: true }));
    app.get('/api/internal/cron/fx-rates', (req, res) => res.json({ internal: true }));
    app.get('/api/recommendations/debug', (req, res) => res.json({ debug: true }));
    return app;
};

describe('Invisible Fabric middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...ORIGINAL_ENV,
            INVISIBLE_FABRIC_ENABLED: 'true',
            INVISIBLE_CLOAK_ADMIN: 'true',
            INVISIBLE_CLOAK_INTERNAL_ROUTES: 'true',
            INVISIBLE_HONEYPOTS_ENABLED: 'true',
            INVISIBLE_BLOCK_PROD_DEBUG: 'true',
        };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('cloaks anonymous admin discovery', async () => {
        const response = await request(buildApp()).get('/api/admin/users').expect(404);

        expect(response.body).toMatchObject({
            status: 'error',
            message: 'Not found',
            requestId: expect.any(String),
        });
    });

    test('allows admin route to proceed when auth material is present', async () => {
        const response = await request(buildApp())
            .get('/api/admin/users')
            .set('Authorization', 'Bearer fake-token')
            .expect(200);

        expect(response.body.admin).toBe(true);
    });

    test('cloaks anonymous internal route discovery', async () => {
        await request(buildApp()).get('/api/internal/cron/fx-rates').expect(404);
    });

    test('honeypot returns no real data and emits a security audit log', async () => {
        const response = await request(buildApp()).get('/.env').expect(404);

        expect(JSON.stringify(response.body)).not.toMatch(/MONGO_URI|PRIVATE_KEY|SECRET/);
        expect(logger.warn).toHaveBeenCalledWith('security.audit_event', expect.objectContaining({
            event: 'invisible_fabric.honeypot.touched',
            reasonCode: 'honeypot_route_requested',
        }));
    });

    test('production debug routes are blocked while local debug routes can pass', async () => {
        process.env.NODE_ENV = 'production';
        await request(buildApp()).get('/api/recommendations/debug').expect(404);

        process.env.NODE_ENV = 'development';
        const response = await request(buildApp()).get('/api/recommendations/debug').expect(200);
        expect(response.body.debug).toBe(true);
    });
});
