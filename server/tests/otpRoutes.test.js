const request = require('supertest');
const app = require('../index');

describe('OTP API Tests', () => {
    describe('POST /api/otp/send', () => {
        test('should return 400 without email', async () => {
            const res = await request(app)
                .post('/api/otp/send')
                .send({ phone: '1234567890', purpose: 'signup' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        test('should return 400 without phone', async () => {
            const res = await request(app)
                .post('/api/otp/send')
                .send({ email: 'test@test.com', purpose: 'signup' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        test('should return 400 with invalid purpose', async () => {
            const res = await request(app)
                .post('/api/otp/send')
                .send({ email: 'test@test.com', phone: '1234567890', purpose: 'invalid' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('Invalid OTP purpose');
        });
    });

    describe('POST /api/otp/verify', () => {
        test('should return 400 without required fields', async () => {
            const res = await request(app)
                .post('/api/otp/verify')
                .send({ phone: '1234567890' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        test('should return 404 for non-existent phone', async () => {
            const res = await request(app)
                .post('/api/otp/verify')
                .send({ phone: '0000000000', otp: '123456', purpose: 'signup' });
            expect(res.statusCode).toBe(404);
        });
    });

    describe('POST /api/otp/check-user', () => {
        test('should return 400 without phone', async () => {
            const res = await request(app)
                .post('/api/otp/check-user')
                .send({});
            expect(res.statusCode).toBe(400);
        });

        test('should return exists:false for unknown phone', async () => {
            const res = await request(app)
                .post('/api/otp/check-user')
                .send({ phone: '9999999999' });
            expect(res.statusCode).toBe(200);
            expect(res.body.exists).toBe(false);
        });
    });
});
