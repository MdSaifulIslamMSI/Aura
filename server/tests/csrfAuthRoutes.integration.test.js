const express = require('express');
const request = require('supertest');

const buildRuntimeValue = (label = 'value') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
    protectPhoneFactorProof: (_req, _res, next) => next(),
    protectOptional: (req, _res, next) => next(),
}));

const mockCsrfRedisStore = new Map();

jest.mock('../config/redis', () => {
    return {
        getRedisClient: () => ({
            setEx: async (key, ttl, value) => {
                mockCsrfRedisStore.set(key, { value, expiresAt: Date.now() + (ttl * 1000) });
                return 'OK';
            },
            get: async (key) => {
                const record = mockCsrfRedisStore.get(key);
                if (!record) return null;
                if (record.expiresAt < Date.now()) {
                    mockCsrfRedisStore.delete(key);
                    return null;
                }
                return record.value;
            },
            del: async (key) => {
                mockCsrfRedisStore.delete(key);
                return 1;
            },
            scan: async (cursor) => {
                const keys = Array.from(mockCsrfRedisStore.keys());
                return { cursor: 0, keys };
            }
        }),
        flags: { redisPrefix: 'csrf-test' },
    };
});

jest.mock('../middleware/distributedRateLimit', () => ({
    createDistributedRateLimit: () => (_req, _res, next) => next(),
}));

jest.mock('../routes/otpRoutes', () => {
    const router = require('express').Router();
    return router;
});

jest.mock('../controllers/authController', () => ({
    establishSessionCookie: (req, _res, next) => {
        if ((req.headers.authorization || '').startsWith('Bearer ')) {
            req.authSession = {
                sessionId: `${req.authUid || 'anonymous'}-${req.method.toLowerCase()}-${req.path.replace(/\W+/g, '-')}`,
            };
        }
        next();
    },
    getSession: (_req, res) => res.json({ ok: true }),
    syncSession: (_req, res) => res.json({ synced: true }),
    generateBackupRecoveryCodes: (_req, res) => res.status(201).json({ success: true, recoveryCodes: [] }),
    verifyBackupRecoveryCode: (_req, res) => res.json({ success: true }),
    logoutSession: (_req, res) => res.json({ success: true }),
    completePhoneFactorLogin: (_req, res) => res.json({ completed: true }),
    completePhoneFactorVerification: (_req, res) => res.json({ completed: true }),
    requestBootstrapDeviceChallenge: (_req, res) => res.json({ success: true, deviceChallenge: null }),
    verifyDeviceChallenge: (_req, res) => res.json({ ok: true }),
}));

const authRoutes = require('../routes/authRoutes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
});

describe('CSRF auth route integration', () => {
    beforeAll(() => {
        process.env.CSRF_STRICT_CLIENT_SIGNALS = 'false';
    });

    beforeEach(() => {
        mockCsrfRedisStore.clear();
    });

    test('issues a csrf token on /session for session-auth flows', async () => {
        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000');

        expect(sessionRes.statusCode).toBe(200);
        const csrfToken = sessionRes.headers['x-csrf-token'];
        expect(csrfToken).toBeDefined();
    });

    test('allows bearer-auth /sync even when a stale csrf token from another user is present', async () => {
        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-b')
            .set('User-Agent', 'test-agent-b')
            .set('Host', 'localhost:3000');

        const csrfToken = sessionRes.headers['x-csrf-token'];

        const validRes = await request(app)
            .post('/api/auth/sync')
            .set('Authorization', 'Bearer token-user-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({
                email: 'user-a@example.com',
                name: 'User A',
                phone: '+919876543210',
            });

        expect(validRes.statusCode).toBe(200);
        expect(validRes.body.synced).toBe(true);
    }, 15000);

    test('allows bearer-auth /sync without csrf because it is not cookie-session CSRF traffic', async () => {
        const validRes = await request(app)
            .post('/api/auth/sync')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({
                email: 'user-a@example.com',
                name: 'User A',
                phone: '+919876543210',
            });

        expect(validRes.statusCode).toBe(200);
        expect(validRes.body.synced).toBe(true);
    });

    test('allows bearer-auth csrf token across auth bootstrap session rotation', async () => {
        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000');

        const csrfToken = sessionRes.headers['x-csrf-token'];

        const validRes = await request(app)
            .post('/api/auth/sync')
            .set('Authorization', 'Bearer token-user-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({
                email: 'user-a@example.com',
                name: 'User A',
                phone: '+919876543210',
            });

        expect(validRes.statusCode).toBe(200);
        expect(validRes.body.synced).toBe(true);
    });

    test('allows bearer-auth /verify-device without csrf because it is bearer bootstrap traffic', async () => {
        const challengeToken = buildRuntimeValue('challenge-ref');
        const challengeProof = buildRuntimeValue('sig-ref');
        const publicKeySpkiBase64 = buildRuntimeValue('key-ref');
        const validRes = await request(app)
            .post('/api/auth/verify-device')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({
                token: challengeToken,
                method: 'browser_key',
                proof: challengeProof,
                publicKeySpkiBase64,
            });

        expect(validRes.statusCode).toBe(200);
        expect(validRes.body.ok).toBe(true);
    });

    test('allows bearer-auth csrf token across trusted-device verification session rotation', async () => {
        const challengeToken = buildRuntimeValue('challenge-ref');
        const challengeProof = buildRuntimeValue('sig-ref');
        const publicKeySpkiBase64 = buildRuntimeValue('key-ref');
        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000');

        const csrfToken = sessionRes.headers['x-csrf-token'];

        const validRes = await request(app)
            .post('/api/auth/verify-device')
            .set('Authorization', 'Bearer token-user-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({
                token: challengeToken,
                method: 'browser_key',
                proof: challengeProof,
                publicKeySpkiBase64,
            });

        expect(validRes.statusCode).toBe(200);
        expect(validRes.body.ok).toBe(true);
    });
});
