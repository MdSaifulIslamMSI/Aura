const request = require('supertest');
const express = require('express');
const app = require('../index');
const { requireOtpAssurance } = require('../middleware/authMiddleware');

describe('Auth Middleware Tests', () => {
    describe('Protected Routes', () => {
        test('GET /api/users/profile should return 401 without token', async () => {
            const res = await request(app).get('/api/users/profile');
            expect(res.statusCode).toBe(401);
            expect(res.body.message).toContain('Not authorized');
        });

        test('GET /api/users/profile should return 401 with invalid token', async () => {
            const res = await request(app)
                .get('/api/users/profile')
                .set('Authorization', 'Bearer invalid-token-123');
            expect(res.statusCode).toBe(401);
        });

        test('PUT /api/users/cart should return 401 without token', async () => {
            const res = await request(app)
                .put('/api/users/cart')
                .send({ cartItems: [] });
            expect(res.statusCode).toBe(401);
        });

        test('PUT /api/users/wishlist should return 401 without token', async () => {
            const res = await request(app)
                .put('/api/users/wishlist')
                .send({ wishlistItems: [] });
            expect(res.statusCode).toBe(401);
        });
    });

    describe('Order Routes Protection', () => {
        test('POST /api/orders should return 401 without token', async () => {
            const res = await request(app)
                .post('/api/orders')
                .send({ orderItems: [] });
            expect(res.statusCode).toBe(401);
        });

        test('GET /api/orders/myorders should return 401 without token', async () => {
            const res = await request(app).get('/api/orders/myorders');
            expect(res.statusCode).toBe(401);
        });
    });

    describe('OTP assurance middleware', () => {
        const buildTestApp = (assurance) => {
            const testApp = express();
            testApp.get('/secure',
                (req, _res, next) => {
                    req.user = { authAssurance: assurance };
                    next();
                },
                requireOtpAssurance,
                (_req, res) => res.status(200).json({ ok: true })
            );
            // eslint-disable-next-line no-unused-vars
            testApp.use((err, _req, res, _next) => {
                res.status(err.statusCode || 500).json({ message: err.message });
            });
            return testApp;
        };

        test('denies access when OTP assurance is missing', async () => {
            const testApp = buildTestApp('none');
            const res = await request(testApp).get('/secure');
            expect(res.statusCode).toBe(403);
            expect(res.body.message).toMatch(/OTP verification required/i);
        });

        test('allows access when OTP assurance is present', async () => {
            const testApp = buildTestApp('password+otp');
            const res = await request(testApp).get('/secure');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ ok: true });
        });
    });
});


describe('Auth Middleware claim-driven verification bootstrap', () => {
    test('protect bootstraps users with isVerified=false when token email_verified is absent', async () => {
        let protect;
        const verifyIdToken = jest.fn().mockResolvedValue({
            uid: 'uid-unverified',
            email: 'new-user@example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        const findOne = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) }));
        const findOneAndUpdate = jest.fn().mockResolvedValue({
            _id: '507f1f77bcf86cd799439011',
            email: 'new-user@example.com',
            name: 'New User',
            isVerified: false,
        });

        jest.isolateModules(() => {
            jest.doMock('../config/firebase', () => ({
                auth: () => ({ verifyIdToken }),
            }));
            jest.doMock('../models/User', () => ({
                findOne,
                findOneAndUpdate,
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: { authorization: 'Bearer token-123' },
        };
        const res = {};
        const next = jest.fn();

        await protect(req, res, next);

        expect(verifyIdToken).toHaveBeenCalledWith('token-123', true);
        expect(findOneAndUpdate).toHaveBeenCalledWith(
            { email: 'new-user@example.com' },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                    isVerified: false,
                }),
            }),
            expect.any(Object)
        );
        expect(next).toHaveBeenCalledWith();
    });
});
