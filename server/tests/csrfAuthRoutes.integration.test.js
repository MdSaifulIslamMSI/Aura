const express = require('express');
const request = require('supertest');

const buildRuntimeValue = (label = 'value') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const mockSetupTotp = jest.fn((_req, res) => res.status(201).json({ manualKey: 'mock-manual-key' }));
const mockGetTotpQr = jest.fn((_req, res) => res.json({ qrCodeDataUrl: 'data:image/png;base64,mock' }));
const mockVerifyTotpSetup = jest.fn((_req, res) => res.json({ enabled: true }));
const mockPasskeyRegisterOptions = jest.fn((_req, res) => res.json({ challenge: 'mock-passkey-register-challenge' }));
const mockPasskeyRegisterVerify = jest.fn((_req, res) => res.status(201).json({ registered: true }));
const mockPasskeyLoginVerify = jest.fn((_req, res) => res.json({ authenticated: true }));

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        const cookie = String(req.headers.cookie || '');

        if (!token && cookie.includes('aura_sid=session-cookie-a')) {
            req.authUid = 'uid-user-a';
            req.authToken = { email: 'user-a@example.com', auth_time: Math.floor(Date.now() / 1000) };
            req.user = { _id: 'uid-user-a', id: 'uid-user-a', email: 'user-a@example.com' };
            req.authSession = { sessionId: 'session-cookie-a' };
            req.authzPosture = { fresh: true, authAgeSeconds: 0, stepUpFresh: true };
            return next();
        }

        if (token === 'token-user-a') {
            req.authUid = 'uid-user-a';
            req.authToken = { email: 'user-a@example.com', auth_time: Math.floor(Date.now() / 1000) };
            req.user = { _id: 'uid-user-a', id: 'uid-user-a', email: 'user-a@example.com' };
            req.authzPosture = { fresh: true, authAgeSeconds: 0, stepUpFresh: true };
            return next();
        }

        if (token === 'token-user-b') {
            req.authUid = 'uid-user-b';
            req.authToken = { email: 'user-b@example.com', auth_time: Math.floor(Date.now() / 1000) };
            req.user = { _id: 'uid-user-b', id: 'uid-user-b', email: 'user-b@example.com' };
            req.authzPosture = { fresh: true, authAgeSeconds: 0, stepUpFresh: true };
            return next();
        }

        if (token === 'token-user-stale') {
            req.authUid = 'uid-user-stale';
            req.authToken = { email: 'user-stale@example.com', auth_time: Math.floor(Date.now() / 1000) - 3600 };
            req.user = { _id: 'uid-user-stale', id: 'uid-user-stale', email: 'user-stale@example.com' };
            req.authzPosture = { fresh: false, authAgeSeconds: 3600, stepUpFresh: false };
            return next();
        }

        return next({ statusCode: 401, message: 'Unauthorized' });
    },
    protectPhoneFactorProof: (req, _res, next) => {
        req.authUid = 'uid-phone-factor-a';
        req.authToken = { email: 'user-a@example.com', auth_time: Math.floor(Date.now() / 1000) };
        req.user = { id: 'uid-phone-factor-a', email: 'user-a@example.com' };
        req.authzPosture = { fresh: true, authAgeSeconds: 0, stepUpFresh: true };
        next();
    },
    protectOptional: (req, _res, next) => {
        const cookie = String(req.headers.cookie || '');
        if (cookie.includes('aura_sid=session-cookie-a')) {
            req.authUid = 'uid-user-a';
            req.authToken = { email: 'user-a@example.com' };
            req.user = { id: 'uid-user-a', email: 'user-a@example.com' };
            req.authSession = { sessionId: 'session-cookie-a' };
        }
        next();
    },
}));

jest.mock('../controllers/mfaController', () => ({
    createStepUpChallenge: (_req, res) => res.status(201).json({ challenge: 'mock-step-up-challenge' }),
    disableTotp: (_req, res) => res.json({ disabled: true }),
    getMfaSecurityCenter: (_req, res) => res.json({ mfa: { enabled: false } }),
    getTotpQr: mockGetTotpQr,
    passkeyLoginOptions: (_req, res) => res.json({ challenge: 'mock-passkey-login-challenge' }),
    passkeyLoginVerify: mockPasskeyLoginVerify,
    passkeyRegisterOptions: mockPasskeyRegisterOptions,
    passkeyRegisterVerify: mockPasskeyRegisterVerify,
    passkeyRemove: (_req, res) => res.json({ removed: true }),
    renameTrustedDevice: (_req, res) => res.json({ renamed: true }),
    recoveryRegenerate: (_req, res) => res.status(201).json({ recoveryCodes: [] }),
    recoveryVerify: (_req, res) => res.json({ authenticated: true }),
    revokeOtherTrustedDevices: (_req, res) => res.json({ revoked: true }),
    revokeTrustedDevice: (_req, res) => res.json({ revoked: true }),
    setupTotp: mockSetupTotp,
    verifyTotpLogin: (_req, res) => res.json({ authenticated: true }),
    verifyTotpSetup: mockVerifyTotpSetup,
}));

const mockCsrfRedisStore = new Map();

const mockEvaluateCsrfToken = async (_script, options = {}) => {
    const key = options.keys?.[0];
    const args = options.arguments || [];
    const record = mockCsrfRedisStore.get(key);
    if (!record) return 'missing';

    let stored;
    try {
        stored = JSON.parse(record.value);
    } catch (_) {
        mockCsrfRedisStore.delete(key);
        return 'invalid_record';
    }

    if (!stored || typeof stored !== 'object' || Number(stored.expiresAt || 0) <= Number(args[0])) {
        mockCsrfRedisStore.delete(key);
        return 'expired';
    }

    const metadata = stored.metadata || {};
    const text = (value) => (value === undefined || value === null ? '' : String(value));
    const expectedUid = text(metadata.uid) || 'anonymous';
    if (expectedUid !== args[1]) return 'principal_mismatch';
    if (text(metadata.strictOrigin) && text(metadata.strictOrigin) !== args[2]) return 'origin_mismatch';
    if (text(metadata.sessionId) && text(metadata.sessionId) !== args[3]) return 'session_mismatch';
    if (text(metadata.deviceFingerprint) && text(metadata.deviceFingerprint) !== args[4]) return 'device_mismatch';

    const ipMismatch = Boolean(text(metadata.ip) && args[5] && text(metadata.ip) !== args[5]);
    const userAgentMismatch = Boolean(text(metadata.userAgent) && args[6] && text(metadata.userAgent) !== args[6]);
    if (args[7] === '1' && (ipMismatch || userAgentMismatch)) return 'client_signal_mismatch';

    mockCsrfRedisStore.delete(key);
    if (ipMismatch && userAgentMismatch) return 'ok:ip,user_agent';
    if (ipMismatch) return 'ok:ip';
    if (userAgentMismatch) return 'ok:user_agent';
    return 'ok';
};

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
            eval: mockEvaluateCsrfToken,
            scan: async (cursor) => {
                const keys = Array.from(mockCsrfRedisStore.keys());
                return { cursor: 0, keys };
            }
        }),
        flags: { redisPrefix: 'csrf-test' },
    };
});

jest.mock('../middleware/distributedRateLimit', () => ({
    createDistributedRateLimit: (config = {}) => (_req, res, next) => {
        if (config.name) {
            res.setHeader('x-test-rate-limiter', config.name);
        }
        next();
    },
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
    startDuoLogin: (_req, res) => res.redirect('https://duo.example.test/authorize'),
    startDuoStepUp: (_req, res) => res.redirect('https://duo.example.test/authorize'),
    completeDuoLogin: (_req, res) => res.redirect('/login?duo=success'),
    startEnterpriseLogin: (_req, res) => res.redirect('https://enterprise.example.test/authorize'),
    completeEnterpriseLogin: (_req, res) => res.redirect('/login?enterprise=success'),
    issueDesktopHandoffToken: (_req, res) => res.json({ customToken: 'desktop-handoff-token' }),
    prepareDesktopHandoff: (_req, res) => res.json({ status: 'handoff_ready' }),
    issueDesktopOwnerAccessToken: (_req, res) => res.json({ customToken: 'desktop-owner-access-token' }),
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
        jest.clearAllMocks();
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

    test('protects cookie-session desktop handoff token minting with csrf while bearer bootstrap remains allowed', async () => {
        const bearerRes = await request(app)
            .post('/api/auth/desktop-handoff/custom-token')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({ requestId: '123e4567-e89b-42d3-a456-426614174000' });

        expect(bearerRes.statusCode).toBe(200);
        expect(bearerRes.body.customToken).toBe('desktop-handoff-token');

        const missingCsrfRes = await request(app)
            .post('/api/auth/desktop-handoff/custom-token')
            .set('Cookie', 'aura_sid=session-cookie-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({ requestId: '123e4567-e89b-42d3-a456-426614174000' });

        expect(missingCsrfRes.statusCode).toBe(403);

        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Cookie', 'aura_sid=session-cookie-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000');
        const csrfToken = sessionRes.headers['x-csrf-token'];

        const validCookieRes = await request(app)
            .post('/api/auth/desktop-handoff/custom-token')
            .set('Cookie', 'aura_sid=session-cookie-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({ requestId: '123e4567-e89b-42d3-a456-426614174000' });

        expect(validCookieRes.statusCode).toBe(200);
        expect(validCookieRes.body.customToken).toBe('desktop-handoff-token');
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

    test('applies a distributed limiter to public trusted-device bootstrap challenges', async () => {
        const res = await request(app)
            .post('/api/auth/bootstrap-device-challenge')
            .set('x-aura-device-id', 'device-test-1234')
            .send({
                scope: 'otp-send:login',
                email: 'user-a@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(200);
        expect(res.headers['x-test-rate-limiter']).toBe('auth_bootstrap_device_challenge');
        expect(res.body.success).toBe(true);
    });

    test('applies a distributed limiter to phone-factor login completion', async () => {
        const res = await request(app)
            .post('/api/auth/complete-phone-factor-login')
            .set('Authorization', 'Bearer token-user-a')
            .set('x-aura-device-id', 'device-test-1234')
            .send({
                email: 'user-a@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(200);
        expect(res.headers['x-test-rate-limiter']).toBe('auth_phone_factor_completion');
        expect(res.body.completed).toBe(true);
    });

    test('applies a distributed limiter to phone-factor verification completion', async () => {
        const res = await request(app)
            .post('/api/auth/complete-phone-factor-verification')
            .set('Authorization', 'Bearer token-phone-factor-a')
            .set('x-aura-device-id', 'device-test-1234')
            .send({
                purpose: 'forgot-password',
                email: 'user-a@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(200);
        expect(res.headers['x-test-rate-limiter']).toBe('auth_phone_factor_completion');
        expect(res.body.completed).toBe(true);
    });

    test('applies a distributed limiter to trusted-device verification', async () => {
        const res = await request(app)
            .post('/api/auth/verify-device')
            .set('Authorization', 'Bearer token-user-a')
            .set('x-aura-device-id', 'device-test-1234')
            .send({
                token: buildRuntimeValue('challenge-ref'),
                method: 'browser_key',
                proof: buildRuntimeValue('sig-ref'),
                publicKeySpkiBase64: buildRuntimeValue('key-ref'),
            });

        expect(res.statusCode).toBe(200);
        expect(res.headers['x-test-rate-limiter']).toBe('auth_verify_device');
        expect(res.body.ok).toBe(true);
    });

    test.each([
        ['post', '/api/auth/mfa/totp/setup', mockSetupTotp],
        ['get', '/api/auth/mfa/totp/qr', mockGetTotpQr],
        ['post', '/api/auth/mfa/totp/verify-setup', mockVerifyTotpSetup],
        ['post', '/api/auth/mfa/passkey/register/options', mockPasskeyRegisterOptions],
        ['post', '/api/auth/mfa/passkey/register/verify', mockPasskeyRegisterVerify],
    ])('requires recent auth before auth-factor enrollment via %s %s', async (method, path, handler) => {
        const requestBuilder = request(app)[method](path)
            .set('Authorization', 'Bearer token-user-stale')
            .set('User-Agent', 'test-agent-stale')
            .set('Host', 'localhost:3000');
        const res = method === 'get' ? await requestBuilder : await requestBuilder.send({});

        expect([401, 403]).toContain(res.statusCode);
        expect(res.body.message).toMatch(/recent|fresh|step-up|sensitive/i);
        expect(handler).not.toHaveBeenCalled();
    });

    test('allows fresh auth to start auth-factor enrollment', async () => {
        const totpRes = await request(app)
            .post('/api/auth/mfa/totp/setup')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({});

        expect(totpRes.statusCode).toBe(201);
        expect(totpRes.body.manualKey).toBe('mock-manual-key');

        const passkeyRes = await request(app)
            .post('/api/auth/mfa/passkey/register/options')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({});

        expect(passkeyRes.statusCode).toBe(200);
        expect(passkeyRes.body.challenge).toBe('mock-passkey-register-challenge');
    });

    test('routes authenticated passkey login verification through the trusted-device verifier limiter', async () => {
        const res = await request(app)
            .post('/api/auth/mfa/passkey/login/verify')
            .set('Authorization', 'Bearer token-user-a')
            .set('x-aura-device-id', 'device-passkey-login-1')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({
                challengeId: 'fixture-mfa-challenge',
                token: 'fixture-passkey-challenge',
                method: 'webauthn',
                proof: 'fixture-passkey-proof',
            });

        expect(res.statusCode).toBe(200);
        expect(res.headers['x-test-rate-limiter']).toBe('auth_verify_device');
        expect(res.body).toEqual({ authenticated: true });
        expect(mockPasskeyLoginVerify).toHaveBeenCalledTimes(1);
    });

    test('rejects cookie-session /logout without csrf', async () => {
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', 'aura_sid=session-cookie-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({});

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('CSRF_TOKEN_MISSING');
    });

    test('allows cookie-session /logout with csrf', async () => {
        const sessionRes = await request(app)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000');
        const csrfToken = sessionRes.headers['x-csrf-token'];

        const res = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', 'aura_sid=session-cookie-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('allows unauthenticated /logout without csrf when no cookie session is present', async () => {
        const res = await request(app)
            .post('/api/auth/logout')
            .set('User-Agent', 'test-agent-a')
            .set('Host', 'localhost:3000')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
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
