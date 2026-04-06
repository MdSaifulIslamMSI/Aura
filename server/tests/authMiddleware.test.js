const request = require('supertest');
const express = require('express');
const { protect, requireOtpAssurance } = require('../middleware/authMiddleware');

const buildBasicApp = () => {
    const app = express();
    app.use(express.json());
    
    // Mock routes protected by authMiddleware
    app.get('/api/users/profile', protect, (req, res) => res.status(200).json({ ok: true }));
    app.post('/api/cart/commands', protect, (req, res) => res.status(200).json({ ok: true }));
    app.put('/api/users/wishlist', protect, (req, res) => res.status(200).json({ ok: true }));
    app.post('/api/orders', protect, (req, res) => res.status(200).json({ ok: true }));
    app.get('/api/orders/myorders', protect, (req, res) => res.status(200).json({ ok: true }));
    
    // Mock error handler
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ message: err.message });
    });
    return app;
};

describe('Auth Middleware Tests', () => {
    let app;

    beforeEach(() => {
        app = buildBasicApp();
    });

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

        test('POST /api/cart/commands should return 401 without token', async () => {
            const res = await request(app)
                .post('/api/cart/commands')
                .send({ commands: [] });
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
        const buildTestApp = (assurance, options = {}) => {
            const testApp = express();
            testApp.get('/secure',
                (req, _res, next) => {
                    req.user = {
                        authAssurance: assurance,
                        authAssuranceAuthTime: options.authAssuranceAuthTime ?? 1700000000,
                        loginOtpAssuranceExpiresAt: options.loginOtpAssuranceExpiresAt
                            || new Date(Date.now() + 60_000).toISOString(),
                    };
                    req.authToken = {
                        auth_time: options.authTime ?? 1700000000,
                    };
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

        test('denies access when the current session auth_time does not match the assured session', async () => {
            const testApp = buildTestApp('password+otp', {
                authAssuranceAuthTime: 1700000000,
                authTime: 1700001234,
            });
            const res = await request(testApp).get('/secure');
            expect(res.statusCode).toBe(403);
            expect(res.body.message).toMatch(/OTP verification required/i);
        });

        test('denies access when the assured session has expired', async () => {
            const testApp = buildTestApp('password+otp', {
                loginOtpAssuranceExpiresAt: new Date(Date.now() - 60_000).toISOString(),
            });
            const res = await request(testApp).get('/secure');
            expect(res.statusCode).toBe(403);
            expect(res.body.message).toMatch(/OTP verification required/i);
        });
    });
});
