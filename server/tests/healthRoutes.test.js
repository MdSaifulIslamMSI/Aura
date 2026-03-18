const request = require('supertest');
const app = require('../index');

describe('Health routes', () => {
    test('GET /health/live reports process liveness', async () => {
        const res = await request(app).get('/health/live');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            alive: true,
            startup: {
                asyncStartupComplete: expect.any(Boolean),
            },
            topology: {
                splitRuntimeEnabled: expect.any(Boolean),
            },
        });
        expect(typeof res.body.uptime).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
    });
});
