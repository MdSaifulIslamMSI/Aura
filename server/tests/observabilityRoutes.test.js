const request = require('supertest');
const app = require('../index');

describe('Observability ingestion routes', () => {
    let consoleWarnSpy;

    beforeEach(() => {
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    test('POST /api/observability/client-diagnostics accepts a diagnostic batch', async () => {
        const response = await request(app)
            .post('/api/observability/client-diagnostics')
            .set('X-Client-Session-Id', 'session-test-1')
            .set('X-Client-Route', '/products?category=electronics')
            .send({
                events: [
                    {
                        type: 'api.network_error',
                        severity: 'error',
                        requestId: 'req-client-1',
                        serverRequestId: 'req-client-1',
                        url: 'http://127.0.0.1:5173/api/products?page=1',
                        method: 'GET',
                        status: 0,
                        error: {
                            message: 'connect ECONNREFUSED 127.0.0.1:5000',
                        },
                    },
                ],
            });

        expect(response.statusCode).toBe(202);
        expect(response.body).toMatchObject({
            status: 'accepted',
            accepted: 1,
            persisted: expect.any(Number),
            persistenceMode: expect.stringMatching(/^(mongo|memory)$/),
            requestId: expect.any(String),
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"client.diagnostic"'));
    });

    test('POST /api/observability/client-diagnostics rejects invalid payloads', async () => {
        const response = await request(app)
            .post('/api/observability/client-diagnostics')
            .send({ events: [] });

        expect(response.statusCode).toBe(400);
        expect(response.body).toMatchObject({
            status: 'error',
            message: 'Invalid client diagnostics payload.',
            requestId: expect.any(String),
        });
    });
});
