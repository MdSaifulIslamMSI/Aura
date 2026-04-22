const request = require('supertest');
const app = require('../index');

describe('CORS middleware', () => {
    test('rejects disallowed origins with a controlled 403 instead of a masked 500', async () => {
        const response = await request(app)
            .post('/api/auth/sync')
            .set('Origin', 'http://localhost:49231')
            .send({});

        expect(response.statusCode).toBe(403);
        expect(response.body).toMatchObject({
            status: 'fail',
            message: 'Origin not allowed by CORS policy',
        });
    });

    test('still allows configured local development origins through to auth', async () => {
        const response = await request(app)
            .post('/api/auth/sync')
            .set('Origin', 'http://localhost:5173')
            .send({});

        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('Not authorized, no session');
    });
});
