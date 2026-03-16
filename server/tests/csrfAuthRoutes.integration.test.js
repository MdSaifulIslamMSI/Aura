const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

        if (token === 'token-user-a') {
            req.authUid = 'uid-user-a';
            req.authToken = { email: 'user-a@example.com' };
            req.user = { id: 'uid-user-a', email: 'user-a@example.com' };
            return next();
        }

        if (token === 'token-user-b') {
            req.authUid = 'uid-user-b';
            req.authToken = { email: 'user-b@example.com' };
            req.user = { id: 'uid-user-b', email: 'user-b@example.com' };
            return next();
        }

        return next({ statusCode: 401, message: 'Unauthorized' });
    },
}));

jest.mock('../middleware/distributedRateLimit', () => ({
    createDistributedRateLimit: () => (_req, _res, next) => next(),
}));


jest.mock('../routes/otpRoutes', () => {
    const router = require('express').Router();
    return router;
});

jest.mock('../controllers/authController', () => ({
    getSession: (_req, res) => res.json({ ok: true }),
    syncSession: (_req, res) => res.json({ synced: true }),
    verifyLatticeChallenge: (_req, res) => res.json({ ok: true }),
}));

const authRoutes = require('../routes/authRoutes');
const { __resetCsrfTokenStore } = require('../middleware/csrfMiddleware');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
});

describe('CSRF auth route integration', () => {
    beforeEach(() => {
        __resetCsrfTokenStore();
    });

    test('rejects csrf token reuse across users between /session and /sync', async () => {
        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a');

        expect(sessionRes.statusCode).toBe(200);
        const csrfToken = sessionRes.headers['x-csrf-token'];
        expect(csrfToken).toBeDefined();

        const crossUserRes = await request(app)
            .post('/api/auth/sync')
            .set('Authorization', 'Bearer token-user-b')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-b')
            .send({
                email: 'user-b@example.com',
                name: 'User B',
                phone: '+919876543210',
            });

        expect(crossUserRes.statusCode).toBe(403);
        expect(crossUserRes.body.code).toBe('CSRF_TOKEN_INVALID');
    });

    test('allows same user token on /sync once and consumes it', async () => {
        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a');

        const csrfToken = sessionRes.headers['x-csrf-token'];

        const validRes = await request(app)
            .post('/api/auth/sync')
            .set('Authorization', 'Bearer token-user-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-a')
            .send({
                email: 'user-a@example.com',
                name: 'User A',
                phone: '+919876543210',
            });

        expect(validRes.statusCode).toBe(200);
        expect(validRes.body.synced).toBe(true);

        const reusedRes = await request(app)
            .post('/api/auth/sync')
            .set('Authorization', 'Bearer token-user-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-a')
            .send({
                email: 'user-a@example.com',
                name: 'User A',
                phone: '+919876543210',
            });

        expect(reusedRes.statusCode).toBe(403);
        expect(reusedRes.body.code).toBe('CSRF_TOKEN_INVALID');
    });
});
