const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        if (req.headers.authorization === 'Bearer valid-token') {
            req.user = { _id: 'user1', isAdmin: false };
            return next();
        }
        return res.status(401).json({ message: 'Not authorized' });
    },
    protectPhoneFactorProof: (req, res, next) => next(),
    protectOptional: (req, res, next) => next(),
    admin: (req, res, next) => {
        if (!req.user?.isAdmin) {
            return res.status(403).json({ message: 'Not authorized as admin' });
        }
        return next();
    },
    seller: (req, res, next) => next(),
    requireOtpAssurance: (req, res, next) => next(),
    requireActiveAccount: (req, res, next) => next(),
    invalidateUserCache: jest.fn(),
    invalidateUserCacheByEmail: jest.fn(),
}));

const app = require('../index');

describe('Order Email Admin API Security Tests', () => {
    test('GET /api/admin/order-emails should fail without token', async () => {
        const res = await request(app).get('/api/admin/order-emails');
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/order-emails/:notificationId should fail without token', async () => {
        const res = await request(app).get('/api/admin/order-emails/test_notification');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/order-emails/:notificationId/retry should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/order-emails/test_notification/retry')
            .set('Idempotency-Key', 'retry-key-12345');
        expect(res.statusCode).toBe(401);
    });
});
