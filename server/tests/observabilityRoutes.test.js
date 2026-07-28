const request = require('supertest');
const app = require('../index');

jest.setTimeout(30000);

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
        const loggedDiagnostic = consoleWarnSpy.mock.calls.flat().join('\n');
        expect(loggedDiagnostic).not.toContain('session-test-1');
        expect(loggedDiagnostic).not.toContain('127.0.0.1:5173');
        expect(loggedDiagnostic).not.toContain('page=1');
    });

    test('POST /api/observability/client-diagnostics accepts diagnostics with stale auth cookies', async () => {
        const response = await request(app)
            .post('/api/observability/client-diagnostics')
            .set('Cookie', ['aura_sid=stale-or-expired-session'])
            .send({
                events: [
                    {
                        type: 'api.network_error',
                        severity: 'warn',
                        url: '/api/auth/sync',
                        method: 'POST',
                        status: 500,
                    },
                ],
            });

        expect(response.statusCode).toBe(202);
        expect(response.body.status).toBe('accepted');
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

    test('POST /api/observability/client-diagnostics accepts typed account events without PII fields', async () => {
        const response = await request(app)
            .post('/api/observability/client-diagnostics')
            .set('X-Client-Session-Id', 'session-ignored-for-product-event')
            .set('X-Client-Route', '/profile?ticket=ignored-private-reference')
            .send({
                events: [{
                    type: 'account.section_viewed',
                    context: { section: 'security' },
                }],
            });

        expect(response.statusCode).toBe(400);

        const acceptedResponse = await request(app)
            .post('/api/observability/client-diagnostics')
            .set('X-Client-Session-Id', 'session-ignored-for-product-event')
            .set('X-Client-Route', '/profile?ticket=ignored-private-reference')
            .send({
                events: [{
                    type: 'account.section_viewed',
                    context: { section: 'settings' },
                }],
            });

        expect(acceptedResponse.statusCode).toBe(202);
        expect(acceptedResponse.body).toMatchObject({
            accepted: 1,
            persisted: expect.any(Number),
        });
    });

    test('POST /api/observability/client-diagnostics rejects extra Account event fields', async () => {
        const response = await request(app)
            .post('/api/observability/client-diagnostics')
            .send({
                events: [{
                    type: 'account.profile_updated',
                    context: {
                        changedFields: ['name'],
                        email: 'must-not-be-accepted@example.com',
                    },
                }],
            });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('Invalid client diagnostics payload.');

        const transportFieldResponse = await request(app)
            .post('/api/observability/client-diagnostics')
            .send({
                events: [{
                    type: 'account.passkey_added',
                    context: {},
                    sessionId: 'raw-session-must-not-be-accepted',
                }],
            });

        expect(transportFieldResponse.statusCode).toBe(400);
        expect(JSON.stringify(transportFieldResponse.body)).not.toContain('raw-session-must-not-be-accepted');
    });
});
