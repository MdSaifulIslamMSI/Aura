const request = require('supertest');
const express = require('express');

const ORIGINAL_ENV = { ...process.env };

const loadProtectedApp = () => {
    jest.resetModules();

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
        findPreferredIdentityUserLean: jest.fn().mockResolvedValue(adminUser),
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
    app.post('/api/admin/ops/smoke', protect, (req, res) => {
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
});
