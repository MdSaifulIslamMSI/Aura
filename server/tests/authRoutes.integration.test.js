const request = require('supertest');
const app = require('../index');

jest.setTimeout(30000);

describe('Auth API surface', () => {
    test('GET /api/auth/session should fail without token', async () => {
        const res = await request(app).get('/api/auth/session');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/auth/sync should fail without token', async () => {
        const res = await request(app)
            .post('/api/auth/sync')
            .send({
                email: 'test@example.com',
                name: 'Test User',
                phone: '+919876543210',
        });
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/auth/otp/send should expose OTP validation under auth aliases', async () => {
        const res = await request(app)
            .post('/api/auth/otp/send')
            .send({ phone: '1234567890', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('required');
    });
});
