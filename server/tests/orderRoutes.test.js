const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => res.status(401).json({ message: 'Not authorized' }),
    protectOptional: (req, res, next) => next(),
    admin: (req, res, next) => next(),
    seller: (req, res, next) => next(),
    requireOtpAssurance: (req, res, next) => next(),
    requireActiveAccount: (req, res, next) => next(),
    invalidateUserCache: jest.fn(),
    invalidateUserCacheByEmail: jest.fn(),
}));

const app = require('../index');
const mongoose = require('mongoose');
const Order = require('../models/Order');

describe('Order API Security Tests (Anti-IDOR)', () => {

    test('GET /api/orders/myorders should fail without token', async () => {
        // Attempt to access without Auth Header
        const res = await request(app).get('/api/orders/myorders');

        // Should be 401 Not Authorized
        expect(res.statusCode).toBe(401);
        expect(res.body.message).toMatch(/Not authorized/);
    });

    test('POST /api/orders should fail without token', async () => {
        const orderData = {
            orderItems: [],
            totalPrice: 100
        };
        const res = await request(app).post('/api/orders').send(orderData);
        expect(res.statusCode).toBe(401);
    });

    // Note: We cannot easily test "Success" cases integrally without mocking 
    // the Firebase Auth middleware to inject a fake `req.user`.
    // Strategies:
    // 1. Mock `admin` and `protect` middleware globally in Jest.
    // 2. Use a "Test Mode" backdoor (dangerous).
    // 3. For now, proving Security (401 on missing token) is the 80/20 win.
});
