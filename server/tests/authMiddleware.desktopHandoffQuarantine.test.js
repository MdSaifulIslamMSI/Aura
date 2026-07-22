const request = require('supertest');

const REQUEST_ID = '123e4567-e89b-12d3-a456-426614174000';
const GRANT_ID = 'g'.repeat(43);
const USER_ID = '507f191e810c19729de860ff';
const UID = 'desktop-handoff-user';
const TARGET_DEVICE_ID = 'aura_desktop_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

jest.setTimeout(30000);

const buildClaims = ({ expired = false, includeHandoff = true } = {}) => ({
    uid: UID,
    email: 'desktop-handoff@example.com',
    email_verified: true,
    auth_time: Math.floor(Date.now() / 1000) - 30,
    iat: Math.floor(Date.now() / 1000) - 30,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...(includeHandoff ? {
        desktop_handoff: true,
        desktop_request_id: REQUEST_ID,
        desktop_handoff_grant_id: GRANT_ID,
        desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + (expired ? -1 : 300),
    } : {}),
});

const buildTargetSession = ({
    amr = ['password', 'desktop_handoff', 'device_binding'],
    deviceId = TARGET_DEVICE_ID,
    deviceMethod = 'browser_key',
} = {}) => ({
    sessionId: 'desktop-target-session',
    userId: USER_ID,
    firebaseUid: UID,
    email: 'desktop-handoff@example.com',
    emailVerified: true,
    deviceId,
    deviceMethod,
    amr,
});

const buildApp = ({
    claims = buildClaims(),
    session = null,
    trustedDeviceSessionValid = false,
} = {}) => {
    let app;

    jest.isolateModules(() => {
        const user = {
            _id: USER_ID,
            authUid: UID,
            email: 'desktop-handoff@example.com',
            name: 'Desktop Handoff User',
            isAdmin: false,
            isSeller: false,
            isVerified: true,
            accountState: 'active',
            trustedDevices: [{
                deviceId: TARGET_DEVICE_ID,
                method: 'browser_key',
                sessionVersion: 'target-session-v1',
            }],
        };
        const resolveSessionIdFromRequest = jest.fn((req) => (
            req.headers?.['x-test-session-id'] || ''
        ));
        const getBrowserSessionFromRequest = jest.fn(async (req) => (
            resolveSessionIdFromRequest(req) ? session : null
        ));

        jest.doMock('../services/auth/authProviderAdapter', () => ({
            getAuthAdapter: () => ({
                verifyAccessToken: jest.fn().mockResolvedValue({
                    authUid: UID,
                    provider: 'firebase',
                    authToken: claims,
                    identity: {
                        uid: UID,
                        email: user.email,
                        name: user.name,
                        phone: '',
                        emailVerified: true,
                        providerIds: ['password'],
                    },
                }),
            }),
        }));
        jest.doMock('../services/authIdentityResolutionService', () => ({
            findPreferredIdentityUserLean: jest.fn().mockResolvedValue(user),
        }));
        jest.doMock('../services/browserSessionService', () => ({
            getBrowserSessionFromRequest,
            getGlobalSessionRevokedAfter: jest.fn().mockResolvedValue(0),
            resolveSessionIdFromRequest,
            revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
            touchBrowserSession: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('../services/trustedDeviceChallengeService', () => ({
            TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
            extractTrustedDeviceContext: jest.fn((req) => ({
                deviceId: req.headers?.['x-aura-device-id'] || '',
                deviceLabel: '',
            })),
            getTrustedDeviceRegistration: jest.fn((_user, deviceId) => (
                user.trustedDevices.find((entry) => entry.deviceId === deviceId) || null
            )),
            verifyTrustedDeviceSession: jest.fn().mockImplementation(({ deviceId, deviceSessionToken }) => ({
                success: Boolean(
                    trustedDeviceSessionValid
                    && deviceId === TARGET_DEVICE_ID
                    && deviceSessionToken === 'target-device-session-token'
                ),
            })),
        }));
        jest.doMock('../config/authTrustedDeviceFlags', () => ({
            shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
        }));
        jest.doMock('../services/trustedDeviceV2RuntimeService', () => ({
            shadowCompareTrustedDeviceRequest: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('../config/redis', () => ({
            getRedisClient: () => null,
            flags: { redisPrefix: 'test' },
        }));
        jest.doMock('../models/User', () => ({}));

        const express = require('express');
        const { protect, protectOptional } = require('../middleware/authMiddleware');
        const { errorHandler } = require('../middleware/errorMiddleware');
        app = express();
        app.use(express.json());
        app.get('/api/users/profile', protect, (_req, res) => res.json({ success: true }));
        app.get('/api/catalog/personalized', protectOptional, (_req, res) => res.json({ success: true }));
        app.post('/api/auth/exchange', protect, (_req, res) => res.json({ success: true }));
        app.get('/api/auth/session', protect, (_req, res) => res.json({ success: true }));
        app.post('/api/auth/sync', protect, (_req, res) => res.json({ success: true }));
        app.post('/api/auth/verify-device', protect, (_req, res) => res.json({ success: true }));
        app.post('/api/auth/logout', protectOptional, (_req, res) => res.json({ success: true }));
        app.use(errorHandler);
    });

    return app;
};

const authorize = (testRequest, {
    deviceId = TARGET_DEVICE_ID,
    deviceSessionToken = '',
    sessionId = '',
} = {}) => {
    let nextRequest = testRequest
        .set('Authorization', 'Bearer desktop-handoff-id-token')
        .set('x-aura-device-id', deviceId);
    if (deviceSessionToken) {
        nextRequest = nextRequest.set('x-aura-device-session', deviceSessionToken);
    }
    if (sessionId) {
        nextRequest = nextRequest.set('x-test-session-id', sessionId);
    }
    return nextRequest;
};

describe('desktop handoff bearer quarantine', () => {
    const originalEnv = {};

    beforeAll(() => {
        for (const key of [
            'AUTH_DEVICE_CHALLENGE_MODE',
            'AUTH_DPOP_REQUIRED',
            'AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED',
            'MFA_ENABLED',
        ]) {
            originalEnv[key] = process.env[key];
        }
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
        process.env.AUTH_DPOP_REQUIRED = 'false';
        process.env.AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED = 'false';
        process.env.MFA_ENABLED = 'false';
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test.each([
        ['GET', '/api/users/profile'],
        ['GET', '/api/catalog/personalized'],
        ['POST', '/api/auth/exchange'],
        ['GET', '/api/auth/session'],
    ])('blocks an unproved handoff bearer from %s %s', async (method, path) => {
        const app = buildApp();
        const res = await authorize(request(app)[method.toLowerCase()](path));

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('DESKTOP_HANDOFF_TARGET_PROOF_REQUIRED');
    });

    test.each([
        ['/api/auth/sync'],
        ['/api/auth/verify-device'],
        ['/api/auth/logout'],
    ])('allows the exact pre-proof continuation route %s', async (path) => {
        const app = buildApp();
        const res = await authorize(request(app).post(path));

        expect(res.statusCode).toBe(200);
    });

    test('allows a fresh handoff sync to replace a stale same-user target session', async () => {
        const app = buildApp({
            session: buildTargetSession(),
        });
        const res = await authorize(request(app).post('/api/auth/sync'), {
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(200);
    });

    test('rejects an expired fresh handoff sync even when a stale target session exists', async () => {
        const app = buildApp({
            claims: buildClaims({ expired: true }),
            session: buildTargetSession(),
        });
        const res = await authorize(request(app).post('/api/auth/sync'), {
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('DESKTOP_HANDOFF_ASSURANCE_CLAIMS_INVALID');
    });

    test.each([
        ['/api/auth/sync'],
        ['/api/auth/verify-device'],
    ])('rejects expired handoff claims on %s', async (path) => {
        const app = buildApp({ claims: buildClaims({ expired: true }) });
        const res = await authorize(request(app).post(path));

        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('DESKTOP_HANDOFF_ASSURANCE_CLAIMS_INVALID');
    });

    test('does not accept an ordinary same-user cookie as target proof', async () => {
        const app = buildApp({
            session: buildTargetSession({ amr: ['password', 'device_binding'] }),
            trustedDeviceSessionValid: true,
        });
        const res = await authorize(request(app).get('/api/auth/session'), {
            deviceSessionToken: 'target-device-session-token',
            sessionId: 'ordinary-session',
        });

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('DESKTOP_HANDOFF_TARGET_PROOF_REQUIRED');
    });

    test('allows a matching proved target session after the bootstrap grant expires', async () => {
        const app = buildApp({
            claims: buildClaims({ expired: true }),
            session: buildTargetSession(),
            trustedDeviceSessionValid: true,
        });
        const res = await authorize(request(app).get('/api/auth/session'), {
            deviceSessionToken: 'target-device-session-token',
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(200);
    });

    test('enforces a proved target session after Firebase refresh drops custom handoff claims', async () => {
        const app = buildApp({
            claims: buildClaims({ includeHandoff: false }),
            session: buildTargetSession(),
            trustedDeviceSessionValid: true,
        });
        const res = await authorize(request(app).get('/api/users/profile'), {
            deviceSessionToken: 'target-device-session-token',
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(200);
    });

    test.each([
        ['GET', '/api/auth/session'],
        ['POST', '/api/auth/verify-device'],
    ])('allows exact device recovery after refreshed claims disappear: %s %s', async (method, path) => {
        const app = buildApp({
            claims: buildClaims({ includeHandoff: false }),
            session: buildTargetSession(),
        });
        const res = await authorize(request(app)[method.toLowerCase()](path), {
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(200);
    });

    test('blocks ordinary APIs while an established target device needs reproof', async () => {
        const app = buildApp({
            claims: buildClaims({ includeHandoff: false }),
            session: buildTargetSession(),
        });
        const res = await authorize(request(app).get('/api/users/profile'), {
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('DESKTOP_HANDOFF_DEVICE_REPROOF_REQUIRED');
    });

    test('does not allow device recovery when the request does not match the target session device', async () => {
        const app = buildApp({
            claims: buildClaims({ includeHandoff: false }),
            session: buildTargetSession(),
        });
        const res = await authorize(request(app).get('/api/auth/session'), {
            deviceId: 'different-device',
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('DESKTOP_HANDOFF_DEVICE_REPROOF_REQUIRED');
    });

    test.each([
        [
            'mismatched device',
            buildTargetSession(),
            false,
            'different-device',
            401,
            'DESKTOP_HANDOFF_DEVICE_REPROOF_REQUIRED',
        ],
        [
            'wrong session method',
            buildTargetSession({ deviceMethod: 'webauthn' }),
            true,
            TARGET_DEVICE_ID,
            403,
            'DESKTOP_HANDOFF_TARGET_PROOF_REQUIRED',
        ],
        [
            'invalid device session enters the exact recovery route',
            buildTargetSession(),
            false,
            TARGET_DEVICE_ID,
            200,
            '',
        ],
    ])('handles post-proof state with %s', async (
        _label,
        session,
        trustedDeviceSessionValid,
        deviceId,
        expectedStatus,
        expectedCode
    ) => {
        const app = buildApp({ session, trustedDeviceSessionValid });
        const res = await authorize(request(app).get('/api/auth/session'), {
            deviceId,
            deviceSessionToken: 'target-device-session-token',
            sessionId: 'desktop-target-session',
        });

        expect(res.statusCode).toBe(expectedStatus);
        if (expectedCode) expect(res.body.code).toBe(expectedCode);
    });
});
