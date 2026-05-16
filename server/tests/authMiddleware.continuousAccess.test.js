const request = require('supertest');
const express = require('express');

const ORIGINAL_ENV = { ...process.env };

const loadProtectedApp = ({
    user = null,
    authSession = null,
    routePath = '/api/admin/ops/smoke',
    riskEngineMode = '',
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
    app.post(routePath, protect, (req, res) => {
        res.json({
            ok: true,
            posture: req.authzPosture,
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

    test('counts a verified trusted-device session header as elevated assurance for privileged bearer requests', async () => {
        const app = loadProtectedApp();

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
});
