const request = require('supertest');
const express = require('express');

const ORIGINAL_ENV = { ...process.env };

const loadProtectedApp = ({
    user = null,
    authSession = null,
    routePath = '/api/admin/ops/smoke',
    additionalRoutePaths = [],
    riskEngineMode = '',
    tokenAmr = [],
} = {}) => {
    jest.resetModules();
    process.env.AUTH_RISK_ENGINE_MODE = riskEngineMode;

    const decodedToken = {
        uid: 'firebase-admin-uid',
        email: 'admin@example.com',
        email_verified: true,
        name: 'Admin User',
        auth_time: Math.floor(Date.now() / 1000) - 60,
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 3600,
        amr: tokenAmr,
        firebase: {
            sign_in_provider: 'password',
        },
    };

    const adminUser = {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        isAdmin: true,
        isSeller: false,
        isVerified: true,
        trustedDevices: [
            {
                deviceId: 'device-admin-1',
                method: 'browser_key',
            },
        ],
    };
    const resolvedUser = user || adminUser;

    jest.doMock('../models/User', () => ({
        findById: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(resolvedUser),
        }),
    }));
    jest.doMock('../config/firebase', () => ({
        auth: () => ({
            verifyIdToken: jest.fn().mockResolvedValue(decodedToken),
        }),
    }));
    jest.doMock('../config/redis', () => ({
        getRedisClient: () => null,
        flags: { redisPrefix: 'test' },
    }));
    jest.doMock('../services/healthService', () => ({
        getCachedAdaptiveSecuritySignal: jest.fn().mockResolvedValue({
            status: 'ok',
            mode: 'standard',
            degradedSignals: [],
            restrictSensitiveActions: false,
            requireStepUpForSensitiveActions: false,
            evaluatedAt: new Date().toISOString(),
            cacheState: 'test',
        }),
    }));
    jest.doMock('../services/authIdentityResolutionService', () => ({
        findPreferredIdentityUserLean: jest.fn().mockResolvedValue(resolvedUser),
    }));
    jest.doMock('../middleware/csrfMiddleware', () => ({
        csrfTokenValidator: jest.fn((_req, _res, next) => next()),
    }));
    jest.doMock('../services/browserSessionService', () => ({
        getBrowserSessionFromRequest: jest.fn().mockResolvedValue(authSession),
        getGlobalSessionRevokedAfter: jest.fn().mockResolvedValue(0),
        resolveSessionIdFromRequest: jest.fn((req = {}) => (
            String(req.headers?.cookie || '').includes('aura_sid=') ? 'session-risk-1' : ''
        )),
        revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
        touchBrowserSession: jest.fn(async (session) => session),
    }));
    jest.doMock('../config/authTrustedDeviceFlags', () => ({
        flags: { authDeviceChallengeMode: 'admin' },
        shouldRequireTrustedDevice: jest.fn(({ user }) => Boolean(user?.isAdmin)),
    }));
    jest.doMock('../services/trustedDeviceChallengeService', () => ({
        TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-trusted-device-session',
        extractTrustedDeviceContext: jest.fn((req = {}) => ({
            deviceId: String(req.headers?.['x-aura-device-id'] || '').trim(),
            deviceLabel: String(req.headers?.['x-aura-device-label'] || '').trim(),
        })),
        verifyTrustedDeviceSession: jest.fn(({ deviceId = '', deviceSessionToken = '' } = {}) => (
            deviceId === 'device-admin-1' && deviceSessionToken === 'valid-device-session'
                ? { success: true }
                : { success: false, reason: 'Trusted device session invalid' }
        )),
    }));

    const { protect } = require('../middleware/authMiddleware');
    const app = express();
    app.use(express.json());
    [routePath, ...additionalRoutePaths].forEach((protectedPath) => {
        app.post(protectedPath, protect, (req, res) => {
            res.json({
                ok: true,
                posture: req.authzPosture,
            });
        });
    });
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ message: err.message });
    });
    return app;
};

describe('authMiddleware continuous access posture', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('does not treat browser-key trusted-device binding as elevated MFA for privileged bearer requests', async () => {
        const app = loadProtectedApp();

        const res = await request(app)
            .post('/api/admin/ops/smoke')
            .set('Authorization', 'Bearer firebase-token')
            .set('x-aura-device-id', 'device-admin-1')
            .set('x-aura-trusted-device-session', 'valid-device-session')
            .send({});

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toBe('A stronger verified session is required for this action.');
    });

    test('accepts privileged bearer requests when trusted-device binding is paired with verified MFA', async () => {
        const app = loadProtectedApp({ tokenAmr: ['mfa', 'totp'] });

        const res = await request(app)
            .post('/api/admin/ops/smoke')
            .set('Authorization', 'Bearer firebase-token')
            .set('x-aura-device-id', 'device-admin-1')
            .set('x-aura-trusted-device-session', 'valid-device-session')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            ok: true,
            posture: {
                deviceBound: true,
                cryptoBound: true,
                elevatedAssurance: true,
                continuousAccess: true,
            },
        });
    });

    test('treats stored login-risk session state as standard after enforcement rollback', async () => {
        const app = loadProtectedApp({
            riskEngineMode: 'monitor',
            routePath: '/api/orders/smoke',
            user: {
                _id: '507f1f77bcf86cd799439012',
                email: 'consumer@example.com',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                trustedDevices: [],
            },
            authSession: {
                sessionId: 'session-risk-1',
                userId: '507f1f77bcf86cd799439012',
                firebaseUid: 'firebase-consumer-uid',
                email: 'consumer@example.com',
                emailVerified: true,
                providerIds: ['password'],
                authTimeSeconds: Math.floor(Date.now() / 1000) - 60,
                riskState: 'login_risk_high',
                aal: 'aal1',
                amr: ['password'],
            },
        });

        const res = await request(app)
            .post('/api/orders/smoke')
            .set('Cookie', 'aura_sid=session-risk-1')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            ok: true,
            posture: {
                riskState: 'standard',
                riskHigh: false,
                continuousAccess: true,
            },
        });
    });

    test('blocks an MFA-pending login from protected APIs while allowing login continuation', async () => {
        process.env.MFA_ENABLED = 'true';
        process.env.MFA_TOTP_ENABLED = 'true';
        process.env.MFA_PASSKEY_ENABLED = 'false';
        process.env.MFA_RECOVERY_CODES_ENABLED = 'false';

        const pendingMfaUser = {
            _id: '507f1f77bcf86cd799439014',
            email: 'admin@example.com',
            isAdmin: false,
            isSeller: false,
            isVerified: true,
            trustedDevices: [],
            mfa: {
                enabled: true,
                defaultMethod: 'totp',
                totp: {
                    enabled: true,
                    confirmedAt: new Date('2026-07-01T00:00:00.000Z'),
                },
            },
        };
        const protectedApp = loadProtectedApp({
            routePath: '/api/orders/smoke',
            additionalRoutePaths: ['/api/auth/mfa/totp/verify-login'],
            user: pendingMfaUser,
        });

        const blocked = await request(protectedApp)
            .post('/api/orders/smoke')
            .set('Authorization', 'Bearer firebase-token')
            .send({});

        expect(blocked.statusCode).toBe(403);
        expect(blocked.body.message).toBe(
            'Complete the required multi-factor sign-in before accessing this resource.'
        );

        const continuation = await request(protectedApp)
            .post('/api/auth/mfa/totp/verify-login')
            .set('Authorization', 'Bearer firebase-token')
            .send({});

        expect(continuation.statusCode).toBe(200);
        expect(continuation.body).toMatchObject({ ok: true });
    }, 15_000);

    test('treats review upload writes as sensitive actions requiring recent auth', async () => {
        const staleAuthTime = Math.floor(Date.now() / 1000) - (20 * 60);
        const app = loadProtectedApp({
            routePath: '/api/uploads/reviews/upload',
            authSession: {
                sessionId: 'session-risk-1',
                userId: '507f1f77bcf86cd799439013',
                firebaseUid: 'firebase-consumer-uid',
                email: 'consumer@example.com',
                emailVerified: true,
                authTimeSeconds: staleAuthTime,
                aal: 'aal1',
            },
            user: {
                _id: '507f1f77bcf86cd799439013',
                email: 'consumer@example.com',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                trustedDevices: [],
            },
        });

        const res = await request(app)
            .post('/api/uploads/reviews/upload')
            .set('Cookie', 'aura_sid=session-risk-1')
            .send({});

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toContain('Recent re-authentication required');
    });
});
