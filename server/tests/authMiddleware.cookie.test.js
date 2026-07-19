const { EventEmitter } = require('events');

describe('authMiddleware cookie session authentication', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../services/auth/authProviderAdapter');
        jest.dontMock('../config/redis');
        jest.dontMock('../services/browserSessionService');
        jest.dontMock('../services/trustedDeviceChallengeService');
    });

    const buildPhoneFactorProofMiddleware = ({ tokenAuthTime }) => {
        let protectPhoneFactorProof;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const verifyAccessToken = jest.fn().mockResolvedValue({
            authUid: 'uid-phone-factor',
            provider: 'firebase',
            authToken: {
                uid: 'uid-phone-factor',
                phone_number: '+919876543210',
                auth_time: tokenAuthTime,
                iat: tokenAuthTime,
                exp: nowSeconds + 3600,
            },
        });

        jest.isolateModules(() => {
            jest.doMock('../services/auth/authProviderAdapter', () => ({
                getAuthAdapter: () => ({
                    verifyAccessToken,
                }),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn(),
                resolveSessionIdFromRequest: jest.fn(),
                revokeBrowserSession: jest.fn(),
                touchBrowserSession: jest.fn(),
                getGlobalSessionRevokedAfter: jest.fn().mockResolvedValue(0),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: '', deviceLabel: '' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));

            protectPhoneFactorProof = require('../middleware/authMiddleware').protectPhoneFactorProof;
        });

        return { protectPhoneFactorProof, verifyAccessToken };
    };

    test('protectPhoneFactorProof exposes fresh posture for recent Firebase phone proof', async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const { protectPhoneFactorProof, verifyAccessToken } = buildPhoneFactorProofMiddleware({
            tokenAuthTime: nowSeconds - 60,
        });
        const req = {
            headers: { authorization: 'Bearer fresh-phone-token' },
            get: (header) => req.headers[String(header || '').toLowerCase()] || '',
        };
        const next = jest.fn();

        await protectPhoneFactorProof(req, {}, next);

        expect(verifyAccessToken).toHaveBeenCalledWith('fresh-phone-token');
        expect(req.authzPosture).toMatchObject({
            fresh: true,
            stepUpFresh: true,
            elevatedAssurance: true,
            authFreshnessWindowSeconds: 600,
        });
        expect(req.authzPosture.authAgeSeconds).toBeLessThanOrEqual(120);
        expect(next).toHaveBeenCalledWith();
    });

    test('protectPhoneFactorProof rejects stale Firebase phone proof', async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const { protectPhoneFactorProof, verifyAccessToken } = buildPhoneFactorProofMiddleware({
            tokenAuthTime: nowSeconds - (16 * 60),
        });
        const req = {
            headers: { authorization: 'Bearer stale-phone-token' },
            get: (header) => req.headers[String(header || '').toLowerCase()] || '',
        };
        const next = jest.fn();

        await protectPhoneFactorProof(req, {}, next);

        expect(verifyAccessToken).toHaveBeenCalledWith('stale-phone-token');
        expect(req.authzPosture).toMatchObject({
            fresh: false,
            stepUpFresh: false,
            elevatedAssurance: false,
            authFreshnessWindowSeconds: 600,
        });
        const error = next.mock.calls[0]?.[0];
        expect(error?.statusCode).toBe(401);
        expect(error?.message).toContain('Fresh login is required');
    });

    test('protect authenticates requests from a valid opaque browser session cookie', async () => {
        let protect;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const touchedSession = {
            sessionId: 'session-cookie-1',
            userId: '507f1f77bcf86cd799439011',
            firebaseUid: 'firebase-cookie-uid',
            email: 'cookie-user@example.com',
            emailVerified: true,
            displayName: 'Cookie User',
            phoneNumber: '+919876543210',
            providerIds: ['password'],
            authTimeSeconds: nowSeconds - 30,
            issuedAtSeconds: nowSeconds - 30,
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceMethod: 'browser_key',
        };

        jest.isolateModules(() => {
            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken: jest.fn(),
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue({
                        _id: '507f1f77bcf86cd799439011',
                        email: 'cookie-user@example.com',
                        name: 'Cookie User',
                        phone: '+919876543210',
                        isAdmin: false,
                        isVerified: true,
                        authAssurance: 'none',
                        authAssuranceAt: null,
                        authAssuranceAuthTime: null,
                        loginOtpAssuranceExpiresAt: null,
                        isSeller: false,
                        accountState: 'active',
                        softDeleted: false,
                        moderation: {},
                    }),
                })),
                findOne: jest.fn(),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue(touchedSession),
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-1'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn().mockResolvedValue(touchedSession),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: 'device-cookie-1', deviceLabel: 'Cookie Browser' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: true }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: {
                cookie: 'aura_sid=session-cookie-1',
            },
            get: () => '',
        };
        const next = jest.fn();

        await protect(req, {}, next);

        expect(req.authSession).toMatchObject({
            sessionId: 'session-cookie-1',
            firebaseUid: 'firebase-cookie-uid',
        });
        expect(req.authUid).toBe('firebase-cookie-uid');
        expect(req.authToken.email).toBe('cookie-user@example.com');
        expect(req.user).toMatchObject({
            email: 'cookie-user@example.com',
            name: 'Cookie User',
        });
        expect(next).toHaveBeenCalledWith();
    });

    test('protect uses cached browser-session user snapshot before Mongo lookup', async () => {
        let protect;
        let findById;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const sessionRecord = {
            sessionId: 'session-cookie-cache',
            userId: '507f1f77bcf86cd799439012',
            firebaseUid: 'firebase-cookie-cache',
            email: 'cached-user@example.com',
            emailVerified: true,
            displayName: 'Cached User',
            phoneNumber: '+919876543211',
            providerIds: ['password'],
            authTimeSeconds: nowSeconds - 30,
            issuedAtSeconds: nowSeconds - 30,
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceMethod: 'browser_key',
        };
        const cachedUser = {
            _id: '507f1f77bcf86cd799439012',
            email: 'cached-user@example.com',
            name: 'Cached User',
            phone: '+919876543211',
            isAdmin: false,
            isVerified: true,
            authAssurance: 'none',
            authAssuranceAt: null,
            authAssuranceAuthTime: null,
            loginOtpAssuranceExpiresAt: null,
            isSeller: false,
            accountState: 'active',
            softDeleted: false,
            moderation: {},
        };

        jest.isolateModules(() => {
            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken: jest.fn(),
                    getUser: jest.fn(),
                }),
            }));
            findById = jest.fn();
            jest.doMock('../models/User', () => ({
                findById,
                findOne: jest.fn(),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => ({
                    get: jest.fn().mockResolvedValue(JSON.stringify(cachedUser)),
                    setEx: jest.fn(),
                }),
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue(sessionRecord),
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-cache'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn().mockResolvedValue(sessionRecord),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: 'device-cookie-cache', deviceLabel: 'Cached Browser' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: true }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: {
                cookie: 'aura_sid=session-cookie-cache',
            },
            get: () => '',
        };
        const next = jest.fn();

        await protect(req, {}, next);

        expect(findById).not.toHaveBeenCalled();
        expect(req.user).toMatchObject({
            email: 'cached-user@example.com',
            name: 'Cached User',
        });
        expect(next).toHaveBeenCalledWith();
    });

    test('protect requires CSRF for cookie-session writes outside auth routes', async () => {
        let protect;
        let csrfTokenValidator;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const sessionRecord = {
            sessionId: 'session-cookie-csrf',
            userId: '507f1f77bcf86cd799439041',
            firebaseUid: 'firebase-cookie-csrf',
            email: 'csrf-user@example.com',
            emailVerified: true,
            displayName: 'CSRF User',
            phoneNumber: '+919876543210',
            providerIds: ['password'],
            authTimeSeconds: nowSeconds - 30,
            issuedAtSeconds: nowSeconds - 30,
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceMethod: 'browser_key',
        };

        jest.isolateModules(() => {
            csrfTokenValidator = jest.fn((_req, _res, next) => next({
                statusCode: 403,
                message: 'CSRF token is missing',
                code: 'CSRF_TOKEN_MISSING',
            }));

            jest.doMock('../middleware/csrfMiddleware', () => ({
                csrfTokenValidator,
            }));
            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken: jest.fn(),
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue({
                        _id: '507f1f77bcf86cd799439041',
                        email: 'csrf-user@example.com',
                        name: 'CSRF User',
                        phone: '+919876543210',
                        isAdmin: false,
                        isVerified: true,
                        authAssurance: 'none',
                        authAssuranceAt: null,
                        authAssuranceAuthTime: null,
                        loginOtpAssuranceExpiresAt: null,
                        isSeller: false,
                        accountState: 'active',
                        softDeleted: false,
                        moderation: {},
                    }),
                })),
                findOne: jest.fn(),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue(sessionRecord),
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-csrf'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn().mockResolvedValue(sessionRecord),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: 'device-cookie-csrf', deviceLabel: 'CSRF Browser' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: true }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const blockedNext = jest.fn();
        await protect({
            method: 'POST',
            originalUrl: '/api/cart/commands',
            headers: {
                cookie: 'aura_sid=session-cookie-csrf',
            },
            body: {},
            query: {},
            get: () => 'csrf-test-agent',
        }, {}, blockedNext);

        expect(csrfTokenValidator).toHaveBeenCalledTimes(1);
        expect(blockedNext).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'CSRF_TOKEN_MISSING',
        }));

        csrfTokenValidator.mockImplementation((_req, _res, next) => next());
        const allowedNext = jest.fn();
        await protect({
            method: 'POST',
            originalUrl: '/api/cart/commands',
            headers: {
                cookie: 'aura_sid=session-cookie-csrf',
                'x-csrf-token': 'a'.repeat(64),
            },
            body: {},
            query: {},
            get: () => 'csrf-test-agent',
        }, {}, allowedNext);

        expect(csrfTokenValidator).toHaveBeenCalledTimes(2);
        expect(allowedNext).toHaveBeenCalledWith();
    });

    test('protect leaves bearer writes and auth-route CSRF to their dedicated flows', async () => {
        let protect;
        let verifyIdToken;
        let csrfTokenValidator;
        const bearerUser = {
            _id: '507f1f77bcf86cd799439042',
            authUid: 'firebase-bearer-csrf',
            email: 'bearer-csrf@example.com',
            name: 'Bearer CSRF User',
            phone: '+919811112222',
            trustedDevices: [],
            isAdmin: false,
            isVerified: true,
            authAssurance: 'none',
            authAssuranceAt: null,
            authAssuranceAuthTime: null,
            loginOtpAssuranceExpiresAt: null,
            isSeller: false,
            accountState: 'active',
            softDeleted: false,
            moderation: {},
        };

        jest.isolateModules(() => {
            csrfTokenValidator = jest.fn((_req, _res, next) => next());
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'firebase-bearer-csrf',
                email: 'bearer-csrf@example.com',
                email_verified: true,
                exp: Math.floor(Date.now() / 1000) + 3600,
            });

            jest.doMock('../middleware/csrfMiddleware', () => ({
                csrfTokenValidator,
            }));
            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken,
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue({
                        ...bearerUser,
                        _id: '507f1f77bcf86cd799439043',
                        authUid: 'firebase-cookie-auth-route',
                        email: 'cookie-auth-route@example.com',
                        name: 'Cookie Auth Route User',
                    }),
                })),
                find: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue([bearerUser]),
                })),
                findOne: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue(bearerUser),
                })),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue({
                    sessionId: 'session-cookie-auth-route',
                    userId: '507f1f77bcf86cd799439043',
                    firebaseUid: 'firebase-cookie-auth-route',
                    email: 'cookie-auth-route@example.com',
                    emailVerified: true,
                    displayName: 'Cookie Auth Route User',
                    providerIds: ['password'],
                    authTimeSeconds: Math.floor(Date.now() / 1000) - 30,
                    issuedAtSeconds: Math.floor(Date.now() / 1000) - 30,
                    firebaseExpiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
                }),
                resolveSessionIdFromRequest: jest.fn((req) => (
                    String(req?.headers?.cookie || '').includes('session-cookie-auth-route')
                        ? 'session-cookie-auth-route'
                        : ''
                )),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: '', deviceLabel: '' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const bearerNext = jest.fn();
        const bearerReq = {
            method: 'POST',
            originalUrl: '/api/cart/commands',
            headers: {
                authorization: 'Bearer fresh-token-123',
                cookie: 'aura_sid=session-cookie-auth-route',
            },
            body: {},
            query: {},
            get: () => '',
        };
        await protect(bearerReq, {}, bearerNext);

        expect(verifyIdToken).toHaveBeenCalledWith('fresh-token-123', true);
        expect(csrfTokenValidator).not.toHaveBeenCalled();
        expect(bearerReq.supersededAuthSessionId).toBe('session-cookie-auth-route');
        expect(bearerNext).toHaveBeenCalledWith();

        const authRouteNext = jest.fn();
        await protect({
            method: 'POST',
            originalUrl: '/api/auth/sync',
            headers: {
                cookie: 'aura_sid=session-cookie-auth-route',
            },
            body: {},
            query: {},
            get: () => '',
        }, {}, authRouteNext);

        expect(csrfTokenValidator).not.toHaveBeenCalled();
        expect(authRouteNext).toHaveBeenCalledWith();
    });

    test('touches opaque browser sessions only after a successful response finishes', async () => {
        let protect;
        let touchBrowserSession;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const sessionRecord = {
            sessionId: 'session-cookie-touch',
            userId: '507f1f77bcf86cd799439031',
            firebaseUid: 'firebase-cookie-touch',
            email: 'touch-user@example.com',
            emailVerified: true,
            displayName: 'Touch User',
            phoneNumber: '+919876543210',
            providerIds: ['password'],
            authTimeSeconds: nowSeconds - 30,
            issuedAtSeconds: nowSeconds - 30,
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceMethod: 'browser_key',
        };

        jest.isolateModules(() => {
            touchBrowserSession = jest.fn().mockResolvedValue({
                ...sessionRecord,
                lastSeenAt: new Date().toISOString(),
            });

            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken: jest.fn(),
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue({
                        _id: '507f1f77bcf86cd799439031',
                        email: 'touch-user@example.com',
                        name: 'Touch User',
                        phone: '+919876543210',
                        isAdmin: false,
                        isVerified: true,
                        authAssurance: 'none',
                        authAssuranceAt: null,
                        authAssuranceAuthTime: null,
                        loginOtpAssuranceExpiresAt: null,
                        isSeller: false,
                        accountState: 'active',
                        softDeleted: false,
                        moderation: {},
                    }),
                })),
                findOne: jest.fn(),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue(sessionRecord),
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-touch'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession,
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: 'device-cookie-touch', deviceLabel: 'Touch Browser' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: true }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const makeReq = () => ({
            headers: {
                cookie: 'aura_sid=session-cookie-touch',
            },
            get: () => '',
        });

        const failedRes = new EventEmitter();
        failedRes.statusCode = 403;
        await protect(makeReq(), failedRes, jest.fn());
        expect(touchBrowserSession).not.toHaveBeenCalled();
        failedRes.emit('finish');
        await new Promise((resolve) => setImmediate(resolve));
        expect(touchBrowserSession).not.toHaveBeenCalled();

        const successRes = new EventEmitter();
        successRes.statusCode = 200;
        const successReq = makeReq();
        await protect(successReq, successRes, jest.fn());
        expect(touchBrowserSession).not.toHaveBeenCalled();
        const refreshedSessionRecord = {
            ...successReq.authSession,
            firebaseExpiresAtSeconds: nowSeconds + 7200,
            aal: 'aal2',
        };
        successReq.authSession = refreshedSessionRecord;
        successRes.emit('finish');
        await new Promise((resolve) => setImmediate(resolve));

        expect(touchBrowserSession).toHaveBeenCalledTimes(1);
        expect(touchBrowserSession).toHaveBeenCalledWith(refreshedSessionRecord);

        touchBrowserSession.mockClear();
        const rotatedRes = new EventEmitter();
        rotatedRes.statusCode = 200;
        const rotatedReq = makeReq();
        await protect(rotatedReq, rotatedRes, jest.fn());
        rotatedReq.authSession = {
            ...rotatedReq.authSession,
            sessionId: 'session-cookie-rotated',
        };
        rotatedRes.emit('finish');
        await new Promise((resolve) => setImmediate(resolve));

        expect(touchBrowserSession).not.toHaveBeenCalled();

        const crossSiteRes = new EventEmitter();
        crossSiteRes.statusCode = 200;
        await protect({
            ...makeReq(),
            headers: {
                cookie: 'aura_sid=session-cookie-touch',
                'sec-fetch-site': 'cross-site',
            },
        }, crossSiteRes, jest.fn());
        crossSiteRes.emit('finish');
        await new Promise((resolve) => setImmediate(resolve));

        expect(touchBrowserSession).not.toHaveBeenCalled();
    }, 30000);

    test('protect requires signed trusted-device proof for a same-device browser session when mode is always', async () => {
        let protect;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const touchedSession = {
            sessionId: 'session-cookie-2',
            userId: '507f1f77bcf86cd799439013',
            firebaseUid: 'firebase-cookie-uid-2',
            email: 'cookie-device@example.com',
            emailVerified: true,
            displayName: 'Cookie Device User',
            phoneNumber: '+919876543210',
            providerIds: ['password'],
            authTimeSeconds: nowSeconds - 30,
            issuedAtSeconds: nowSeconds - 30,
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceId: 'device-cookie-2',
            deviceMethod: 'browser_key',
        };

        jest.isolateModules(() => {
            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken: jest.fn(),
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue({
                        _id: '507f1f77bcf86cd799439013',
                        email: 'cookie-device@example.com',
                        name: 'Cookie Device User',
                        phone: '+919876543210',
                        isAdmin: false,
                        isVerified: true,
                        authAssurance: 'none',
                        authAssuranceAt: null,
                        authAssuranceAuthTime: null,
                        loginOtpAssuranceExpiresAt: null,
                        isSeller: false,
                        accountState: 'active',
                        softDeleted: false,
                        moderation: {},
                    }),
                })),
                findOne: jest.fn(),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue(touchedSession),
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-2'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn().mockResolvedValue(touchedSession),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: 'device-cookie-2', deviceLabel: 'Cookie Browser' }),
                verifyTrustedDeviceSession: jest.fn(({ deviceId = '', deviceSessionToken = '' } = {}) => (
                    deviceId === 'device-cookie-2' && deviceSessionToken === 'signed-device-session-2'
                        ? { success: true }
                        : { success: false, reason: 'Trusted device verification invalid' }
                )),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'always' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(true),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const unprovedReq = {
            headers: {
                cookie: 'aura_sid=session-cookie-2',
            },
            get: () => '',
        };
        const unprovedNext = jest.fn();

        await protect(unprovedReq, {}, unprovedNext);

        expect(unprovedNext).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            message: 'Trusted device verification required for this account',
        }));

        const provedReq = {
            headers: {
                cookie: 'aura_sid=session-cookie-2',
                'x-aura-device-session': 'signed-device-session-2',
            },
            get: (name) => name === 'x-aura-device-session' ? 'signed-device-session-2' : '',
        };
        const provedNext = jest.fn();

        await protect(provedReq, {}, provedNext);

        expect(provedReq.authSession).toMatchObject({
            sessionId: 'session-cookie-2',
            deviceId: 'device-cookie-2',
            deviceMethod: 'browser_key',
        });
        expect(provedNext).toHaveBeenCalledWith();
    });

    test('protect ignores a mismatched browser session cookie when bearer auth is fresh', async () => {
        let protect;
        let verifyIdToken;
        let resolveSessionIdFromRequest;
        let getBrowserSessionFromRequest;

        jest.isolateModules(() => {
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'firebase-bearer-uid',
                email: 'bearer-user@example.com',
                email_verified: true,
                exp: Math.floor(Date.now() / 1000) + 3600,
            });
            resolveSessionIdFromRequest = jest.fn().mockReturnValue('session-cookie-stale');
            getBrowserSessionFromRequest = jest.fn().mockResolvedValue({
                sessionId: 'session-cookie-stale',
                userId: '507f1f77bcf86cd799439999',
                firebaseUid: 'different-cookie-uid',
                email: 'other-user@example.com',
            });

            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken,
                    getUser: jest.fn(),
                }),
            }));
            const bearerUser = {
                _id: '507f1f77bcf86cd799439012',
                authUid: 'firebase-bearer-uid',
                email: 'bearer-user@example.com',
                name: 'Bearer User',
                phone: '+919811112222',
                trustedDevices: [
                    {
                        deviceId: 'device-bearer-1',
                        label: 'Bearer Browser',
                        method: 'browser_key',
                        publicKeySpkiBase64: 'public-key',
                    },
                ],
                isAdmin: false,
                isVerified: true,
                authAssurance: 'none',
                authAssuranceAt: null,
                authAssuranceAuthTime: null,
                loginOtpAssuranceExpiresAt: null,
                isSeller: false,
                accountState: 'active',
                softDeleted: false,
                moderation: {},
            };

            jest.doMock('../models/User', () => ({
                findById: jest.fn(),
                find: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue([bearerUser]),
                })),
                findOne: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue(bearerUser),
                })),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest,
                resolveSessionIdFromRequest,
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: '', deviceLabel: '' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: {
                cookie: 'aura_sid=session-cookie-stale',
                authorization: 'Bearer fresh-token-123',
            },
            get: () => '',
        };
        const next = jest.fn();

        await protect(req, {}, next);

        expect(verifyIdToken).toHaveBeenCalledWith('fresh-token-123', true);
        expect(resolveSessionIdFromRequest).toHaveBeenCalledWith(req);
        expect(getBrowserSessionFromRequest).toHaveBeenCalledWith(req);
        expect(req.supersededAuthSessionId).toBe('session-cookie-stale');
        expect(req.authUid).toBe('firebase-bearer-uid');
        expect(req.authSession).toBeNull();
        expect(req.user).toMatchObject({
            email: 'bearer-user@example.com',
            name: 'Bearer User',
        });
        expect(req.user.trustedDevices).toEqual([
            expect.objectContaining({
                deviceId: 'device-bearer-1',
                method: 'browser_key',
            }),
        ]);
        expect(next).toHaveBeenCalledWith();
    });

    test('protect preserves matching browser step-up context for bearer-auth admin requests', async () => {
        let protect;
        let verifyIdToken;
        let getBrowserSessionFromRequest;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const bearerUser = {
            _id: '507f1f77bcf86cd799439123',
            authUid: 'firebase-admin-uid',
            email: 'admin@example.com',
            name: 'Admin User',
            phone: '+919811112222',
            trustedDevices: [
                {
                    deviceId: 'device-admin-1',
                    label: 'Admin Browser',
                    method: 'browser_key',
                    publicKeySpkiBase64: 'public-key',
                },
            ],
            isAdmin: true,
            adminRoles: ['SUPER_ADMIN'],
            isVerified: true,
            authAssurance: 'none',
            authAssuranceAt: null,
            authAssuranceAuthTime: null,
            loginOtpAssuranceExpiresAt: null,
            isSeller: false,
            accountState: 'active',
            softDeleted: false,
            moderation: {},
        };
        const matchingSession = {
            sessionId: 'session-cookie-step-up',
            userId: bearerUser._id,
            firebaseUid: 'firebase-admin-uid',
            email: 'admin@example.com',
            emailVerified: true,
            displayName: 'Admin User',
            phoneNumber: '+919811112222',
            providerIds: ['google.com'],
            authTimeSeconds: nowSeconds - (30 * 60),
            issuedAtSeconds: nowSeconds - (30 * 60),
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceId: 'device-admin-1',
            deviceMethod: 'browser_key',
            aal: 'aal2',
            riskState: 'standard',
            stepUpUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        };

        jest.isolateModules(() => {
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'firebase-admin-uid',
                email: 'admin@example.com',
                email_verified: true,
                auth_time: nowSeconds - (30 * 60),
                iat: nowSeconds - (30 * 60),
                exp: nowSeconds + 3600,
            });

            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken,
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(),
                find: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue([bearerUser]),
                })),
                findOne: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue(bearerUser),
                })),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            getBrowserSessionFromRequest = jest.fn().mockResolvedValue(matchingSession);
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest,
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-step-up'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn().mockResolvedValue(matchingSession),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-admin-1',
                    deviceLabel: 'Admin Browser',
                }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));
            jest.doMock('../services/healthService', () => ({
                getCachedAdaptiveSecuritySignal: jest.fn().mockResolvedValue({
                    status: 'ok',
                    mode: 'standard',
                    degradedSignals: [],
                    restrictSensitiveActions: false,
                    requireStepUpForSensitiveActions: false,
                }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            method: 'GET',
            originalUrl: '/api/admin/ops/readiness',
            headers: {
                cookie: 'aura_sid=session-cookie-step-up',
                authorization: 'Bearer fresh-token-123',
            },
            get: (header) => req.headers[String(header || '').toLowerCase()] || '',
        };
        const next = jest.fn();

        await protect(req, {}, next);

        expect(verifyIdToken).toHaveBeenCalledWith('fresh-token-123', true);
        expect(getBrowserSessionFromRequest).toHaveBeenCalledWith(req);
        expect(req.authSession).toMatchObject({
            sessionId: 'session-cookie-step-up',
            deviceId: 'device-admin-1',
            deviceMethod: 'browser_key',
            stepUpUntil: matchingSession.stepUpUntil,
        });
        expect(req.authzPosture).toMatchObject({
            sensitivity: 'privileged',
            stepUpFresh: true,
            fresh: true,
        });
        expect(next).toHaveBeenCalledWith();
    });

    test('protect blocks stale sessions on sensitive routes even when the cookie is otherwise valid', async () => {
        let protect;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const touchedSession = {
            sessionId: 'session-cookie-stale-sensitive',
            userId: '507f1f77bcf86cd799439021',
            firebaseUid: 'firebase-cookie-stale',
            email: 'stale-sensitive@example.com',
            emailVerified: true,
            displayName: 'Stale Sensitive User',
            phoneNumber: '+919876543210',
            providerIds: ['password'],
            authTimeSeconds: nowSeconds - (30 * 60),
            issuedAtSeconds: nowSeconds - (30 * 60),
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceId: 'device-cookie-stale',
            deviceMethod: 'browser_key',
            aal: 'aal2',
            riskState: 'standard',
        };

        jest.isolateModules(() => {
            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken: jest.fn(),
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue({
                        _id: '507f1f77bcf86cd799439021',
                        email: 'stale-sensitive@example.com',
                        name: 'Stale Sensitive User',
                        phone: '+919876543210',
                        trustedDevices: [{ deviceId: 'device-cookie-stale', method: 'browser_key' }],
                        isAdmin: false,
                        isVerified: true,
                        authAssurance: 'password+otp',
                        authAssuranceAt: null,
                        authAssuranceAuthTime: null,
                        loginOtpAssuranceExpiresAt: null,
                        isSeller: false,
                        accountState: 'active',
                        softDeleted: false,
                        moderation: {},
                    }),
                })),
                findOne: jest.fn(),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue(touchedSession),
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-stale-sensitive'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn().mockResolvedValue(touchedSession),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: 'device-cookie-stale', deviceLabel: 'Cookie Browser' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));
            jest.doMock('../services/healthService', () => ({
                getCachedAdaptiveSecuritySignal: jest.fn().mockResolvedValue({
                    status: 'ok',
                    mode: 'standard',
                    degradedSignals: [],
                    restrictSensitiveActions: false,
                    requireStepUpForSensitiveActions: false,
                }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const headers = { cookie: 'aura_sid=session-cookie-stale-sensitive' };
        const req = {
            method: 'POST',
            originalUrl: '/api/payments/intents',
            headers,
            get: (header) => headers[header],
        };
        const next = jest.fn();

        await protect(req, {}, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/Recent re-authentication required/i),
            statusCode: 401,
        }));
    });

    test('protect shortens the allowed auth age for sensitive routes when the system health is degraded', async () => {
        let protect;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const touchedSession = {
            sessionId: 'session-cookie-degraded-sensitive',
            userId: '507f1f77bcf86cd799439022',
            firebaseUid: 'firebase-cookie-degraded',
            email: 'degraded-sensitive@example.com',
            emailVerified: true,
            displayName: 'Degraded Sensitive User',
            phoneNumber: '+919876543210',
            providerIds: ['password'],
            authTimeSeconds: nowSeconds - (10 * 60),
            issuedAtSeconds: nowSeconds - (10 * 60),
            firebaseExpiresAtSeconds: nowSeconds + 3600,
            amr: ['trusted_device'],
            deviceId: 'device-cookie-degraded',
            deviceMethod: 'browser_key',
            aal: 'aal1',
            riskState: 'standard',
        };

        jest.isolateModules(() => {
            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken: jest.fn(),
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue({
                        _id: '507f1f77bcf86cd799439022',
                        email: 'degraded-sensitive@example.com',
                        name: 'Degraded Sensitive User',
                        phone: '+919876543210',
                        trustedDevices: [{ deviceId: 'device-cookie-degraded', method: 'browser_key' }],
                        isAdmin: false,
                        isVerified: true,
                        authAssurance: 'none',
                        authAssuranceAt: null,
                        authAssuranceAuthTime: null,
                        loginOtpAssuranceExpiresAt: null,
                        isSeller: false,
                        accountState: 'active',
                        softDeleted: false,
                        moderation: {},
                    }),
                })),
                findOne: jest.fn(),
                findOneAndUpdate: jest.fn(),
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/browserSessionService', () => ({
                getBrowserSessionFromRequest: jest.fn().mockResolvedValue(touchedSession),
                resolveSessionIdFromRequest: jest.fn().mockReturnValue('session-cookie-degraded-sensitive'),
                revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
                touchBrowserSession: jest.fn().mockResolvedValue(touchedSession),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: 'device-cookie-degraded', deviceLabel: 'Cookie Browser' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));
            jest.doMock('../services/healthService', () => ({
                getCachedAdaptiveSecuritySignal: jest.fn().mockResolvedValue({
                    status: 'degraded',
                    mode: 'elevated',
                    degradedSignals: ['payment_outbox_worker'],
                    restrictSensitiveActions: false,
                    requireStepUpForSensitiveActions: true,
                }),
            }));
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                flags: { authDeviceChallengeMode: 'off' },
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const headers = { cookie: 'aura_sid=session-cookie-degraded-sensitive' };
        const req = {
            method: 'POST',
            originalUrl: '/api/orders/order-1/cancel',
            headers,
            get: (header) => headers[header],
        };
        const next = jest.fn();

        await protect(req, {}, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/Recent re-authentication required within 5 minutes/i),
            statusCode: 401,
        }));
    });
});
