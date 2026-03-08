jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        return next();
    },
    admin: (req, res, next) => next(),
}));

jest.mock('../services/clientDiagnosticIngestionService', () => ({
    listClientDiagnostics: jest.fn(),
    MAX_DIAGNOSTICS_PER_REQUEST: 20,
    persistClientDiagnostics: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminOpsRoutes = require('../routes/adminOpsRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const { listClientDiagnostics } = require('../services/clientDiagnosticIngestionService');

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/ops', adminOpsRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin ops client diagnostics route integration', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();
        listClientDiagnostics.mockResolvedValue({
            source: 'mongo',
            diagnostics: [
                {
                    type: 'api.network_error',
                    severity: 'error',
                    sessionId: 'session-1',
                    requestId: 'req-1',
                    route: '/products?category=electronics',
                },
            ],
        });
    });

    test('GET /api/admin/ops/client-diagnostics returns recent diagnostics', async () => {
        const res = await request(app)
            .get('/api/admin/ops/client-diagnostics?limit=10&type=api.network_error&sessionId=session-1');

        expect(res.statusCode).toBe(200);
        expect(listClientDiagnostics).toHaveBeenCalledWith({
            limit: '10',
            type: 'api.network_error',
            severity: undefined,
            sessionId: 'session-1',
            requestId: undefined,
            route: undefined,
        });
        expect(res.body).toEqual({
            success: true,
            source: 'mongo',
            count: 1,
            diagnostics: [
                expect.objectContaining({
                    type: 'api.network_error',
                    severity: 'error',
                    sessionId: 'session-1',
                }),
            ],
        });
    });

    test('GET /api/admin/ops/client-diagnostics enforces query validation', async () => {
        const res = await request(app)
            .get('/api/admin/ops/client-diagnostics?limit=500');

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });
});
