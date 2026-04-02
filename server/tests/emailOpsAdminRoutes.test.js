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

describe('Email Ops Admin API Security Tests', () => {
    test('GET /api/admin/email-ops/summary should fail without token', async () => {
        const res = await request(app).get('/api/admin/email-ops/summary');
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/email-ops/deliveries should fail without token', async () => {
        const res = await request(app).get('/api/admin/email-ops/deliveries');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/email-ops/order-queue/:notificationId/retry should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/email-ops/order-queue/test_notification/retry')
            .set('Idempotency-Key', 'retry-key-12345');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/email-ops/test-send should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/email-ops/test-send')
            .set('Idempotency-Key', 'test-email-key-12345')
            .send({ recipientEmail: 'ops@example.com' });
        expect(res.statusCode).toBe(401);
    });
});
