describe('browserSessionService', () => {
    const originalEnv = { ...process.env };

    const createResponseStub = () => {
        const headers = new Map();
        return {
            getHeader: (name) => headers.get(name),
            setHeader: (name, value) => headers.set(name, value),
        };
    };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('creates opaque browser sessions with hardened cookies and assurance metadata', async () => {
        process.env.AUTH_SESSION_ADMIN_HOSTS = 'admin.aura.local';
        process.env.AUTH_SESSION_COOKIE_SECURE = 'true';

        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-admin-1',
                    deviceLabel: 'Admin Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const req = {
            headers: {
                host: 'admin.aura.local',
                'x-forwarded-proto': 'https',
            },
            secure: true,
        };
        const res = createResponseStub();

        const session = await browserSessionService.createBrowserSession({
            req,
            res,
            user: {
                _id: '507f1f77bcf86cd799439011',
                email: 'admin@example.com',
                name: 'Admin User',
                phone: '+919876543210',
                isAdmin: true,
                isSeller: false,
                isVerified: true,
                authAssurance: 'password+otp',
                loginOtpAssuranceExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            },
            authUid: 'firebase-admin-1',
            authToken: {
                email: 'admin@example.com',
                email_verified: true,
                name: 'Admin User',
                phone_number: '+919876543210',
                auth_time: nowSeconds - 30,
                iat: nowSeconds - 30,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'password',
                },
            },
            deviceMethod: 'webauthn',
            stepUpUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            additionalAmr: ['otp'],
        });

        const storedSession = await browserSessionService.getBrowserSession(session.sessionId);
        const setCookieHeader = res.getHeader('Set-Cookie');

        expect(session.sessionId).toBeTruthy();
        expect(session.userId).toBe('507f1f77bcf86cd799439011');
        expect(session.scope).toBe('admin');
        expect(session.deviceId).toBe('device-admin-1');
        expect(session.deviceMethod).toBe('webauthn');
        expect(session.aal).toBe('aal2');
        expect(session.amr).toEqual(expect.arrayContaining(['password', 'otp', 'webauthn']));
        expect(storedSession).toMatchObject({
            sessionId: session.sessionId,
            firebaseUid: 'firebase-admin-1',
            email: 'admin@example.com',
        });
        expect(setCookieHeader).toEqual(expect.arrayContaining([
            expect.stringContaining('aura_sid='),
        ]));
        expect(setCookieHeader[0]).toContain('HttpOnly');
        expect(setCookieHeader[0]).toContain('Secure');
        expect(setCookieHeader[0]).toContain('SameSite=Strict');
    });

    test('rotates and revokes opaque browser sessions', async () => {
        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-seller-1',
                    deviceLabel: 'Seller Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const req = {
            headers: {
                host: 'localhost:5173',
            },
            secure: false,
        };

        const firstSession = await browserSessionService.createBrowserSession({
            req,
            user: {
                _id: '507f1f77bcf86cd799439012',
                email: 'seller@example.com',
                name: 'Seller User',
                phone: '+919876543211',
                isAdmin: false,
                isSeller: true,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-seller-1',
            authToken: {
                email: 'seller@example.com',
                email_verified: true,
                name: 'Seller User',
                phone_number: '+919876543211',
                auth_time: nowSeconds - 60,
                iat: nowSeconds - 60,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'google.com',
                },
            },
        });

        const rotatedSession = await browserSessionService.refreshBrowserSession({
            req,
            currentSession: firstSession,
            user: {
                _id: '507f1f77bcf86cd799439012',
                email: 'seller@example.com',
                name: 'Seller User',
                phone: '+919876543211',
                isAdmin: false,
                isSeller: true,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-seller-1',
            authToken: {
                email: 'seller@example.com',
                email_verified: true,
                name: 'Seller User',
                phone_number: '+919876543211',
                auth_time: nowSeconds - 10,
                iat: nowSeconds - 10,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'google.com',
                },
            },
            deviceMethod: 'browser_key',
            rotate: true,
        });

        expect(rotatedSession.sessionId).not.toBe(firstSession.sessionId);
        expect(rotatedSession.scope).toBe('seller');
        expect(rotatedSession.deviceMethod).toBe('browser_key');
        expect(rotatedSession.aal).toBe('aal2');
        expect(rotatedSession.amr).toEqual(expect.arrayContaining(['social_google', 'trusted_device']));
        await expect(browserSessionService.getBrowserSession(firstSession.sessionId)).resolves.toBeNull();

        await browserSessionService.revokeBrowserSession(rotatedSession.sessionId);
        await expect(browserSessionService.getBrowserSession(rotatedSession.sessionId)).resolves.toBeNull();
    });

    test('revokes all opaque browser sessions for a user after credential reset', async () => {
        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-reset-session-1',
                    deviceLabel: 'Reset Session Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const req = {
            headers: {
                host: 'localhost:5173',
            },
            secure: false,
        };
        const targetUser = {
            _id: '507f1f77bcf86cd799439022',
            email: 'reset-session@example.com',
            name: 'Reset Session',
            phone: '+919876543221',
            isAdmin: false,
            isSeller: false,
            isVerified: true,
            authAssurance: 'none',
        };
        const otherUser = {
            ...targetUser,
            _id: '507f1f77bcf86cd799439023',
            email: 'other-session@example.com',
        };
        const authToken = {
            email: targetUser.email,
            email_verified: true,
            name: targetUser.name,
            phone_number: targetUser.phone,
            auth_time: nowSeconds - 60,
            iat: nowSeconds - 60,
            exp: nowSeconds + 3600,
            firebase: {
                sign_in_provider: 'password',
            },
        };

        const firstSession = await browserSessionService.createBrowserSession({
            req,
            user: targetUser,
            authUid: 'firebase-reset-session',
            authToken,
        });
        const secondSession = await browserSessionService.createBrowserSession({
            req,
            user: targetUser,
            authUid: 'firebase-reset-session',
            authToken,
        });
        const otherSession = await browserSessionService.createBrowserSession({
            req,
            user: otherUser,
            authUid: 'firebase-other-session',
            authToken: {
                ...authToken,
                email: otherUser.email,
            },
        });

        const result = await browserSessionService.revokeBrowserSessionsForUser(targetUser._id);

        expect(result.revoked).toBe(2);
        await expect(browserSessionService.getBrowserSession(firstSession.sessionId)).resolves.toBeNull();
        await expect(browserSessionService.getBrowserSession(secondSession.sessionId)).resolves.toBeNull();
        await expect(browserSessionService.getBrowserSession(otherSession.sessionId)).resolves.toMatchObject({
            sessionId: otherSession.sessionId,
            userId: otherUser._id,
        });
    });

    test('uses SameSite=None for secure loopback frontends talking to a remote API origin', async () => {
        process.env.AUTH_SESSION_COOKIE_SECURE = 'true';

        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-loopback-1',
                    deviceLabel: 'Loopback Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const req = {
            headers: {
                host: 'api.aura-aws.internal',
                origin: 'http://localhost:4173',
                'x-forwarded-proto': 'https',
            },
            secure: true,
        };
        const res = createResponseStub();

        await browserSessionService.createBrowserSession({
            req,
            res,
            user: {
                _id: '507f1f77bcf86cd799439013',
                email: 'loopback@example.com',
                name: 'Loopback User',
                phone: '+919876543212',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-loopback-1',
            authToken: {
                email: 'loopback@example.com',
                email_verified: true,
                name: 'Loopback User',
                phone_number: '+919876543212',
                auth_time: nowSeconds - 15,
                iat: nowSeconds - 15,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'password',
                },
            },
        });

        const setCookieHeader = res.getHeader('Set-Cookie');

        expect(setCookieHeader).toEqual(expect.arrayContaining([
            expect.stringContaining('aura_sid='),
        ]));
        expect(setCookieHeader[0]).toContain('Secure');
        expect(setCookieHeader[0]).toContain('SameSite=None');
    });

    test('uses SameSite=None for secure hosted frontends talking to a different API origin', async () => {
        process.env.AUTH_SESSION_COOKIE_SECURE = 'true';

        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-hosted-1',
                    deviceLabel: 'Hosted Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const req = {
            headers: {
                host: 'api.aura-aws.internal',
                origin: 'https://aurapilot.vercel.app',
                'x-forwarded-proto': 'https',
            },
            secure: true,
        };
        const res = createResponseStub();

        await browserSessionService.createBrowserSession({
            req,
            res,
            user: {
                _id: '507f1f77bcf86cd799439014',
                email: 'hosted@example.com',
                name: 'Hosted User',
                phone: '+919876543213',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-hosted-1',
            authToken: {
                email: 'hosted@example.com',
                email_verified: true,
                name: 'Hosted User',
                phone_number: '+919876543213',
                auth_time: nowSeconds - 15,
                iat: nowSeconds - 15,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'google.com',
                },
            },
        });

        const setCookieHeader = res.getHeader('Set-Cookie');

        expect(setCookieHeader).toEqual(expect.arrayContaining([
            expect.stringContaining('aura_sid='),
        ]));
        expect(setCookieHeader[0]).toContain('Secure');
        expect(setCookieHeader[0]).toContain('SameSite=None');
    });

    test('stores trusted social sessions as email-verified when the persisted profile is verified', async () => {
        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-social-1',
                    deviceLabel: 'Social Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const req = {
            headers: {
                host: 'localhost:5173',
            },
            secure: false,
        };

        const session = await browserSessionService.createBrowserSession({
            req,
            user: {
                _id: '507f1f77bcf86cd799439015',
                email: 'social-admin@example.com',
                name: 'Social Admin',
                phone: '+919876543214',
                isAdmin: true,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-social-admin',
            authToken: {
                email: 'social-admin@example.com',
                email_verified: false,
                name: 'Social Admin',
                phone_number: '+919876543214',
                auth_time: nowSeconds - 30,
                iat: nowSeconds - 30,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'twitter.com',
                },
            },
        });

        expect(session.emailVerified).toBe(true);
        expect(session.amr).toEqual(expect.arrayContaining(['social_x']));

        const storedSession = await browserSessionService.getBrowserSession(session.sessionId);
        expect(storedSession.emailVerified).toBe(true);
    });

    test('falls back to in-memory session storage when Redis rejects a session write', async () => {
        let browserSessionService;
        let logger;
        const redisClient = {
            setEx: jest.fn().mockRejectedValue(new Error('redis write failed')),
            get: jest.fn().mockResolvedValue(null),
            del: jest.fn().mockResolvedValue(1),
        };

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => redisClient,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../utils/logger', () => ({
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-redis-fallback-1',
                    deviceLabel: 'Redis Fallback Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
            logger = require('../utils/logger');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const req = {
            headers: {
                host: 'localhost:4173',
            },
            secure: false,
        };

        const session = await browserSessionService.createBrowserSession({
            req,
            user: {
                _id: '507f1f77bcf86cd799439016',
                email: 'fallback@example.com',
                name: 'Fallback User',
                phone: '+919876543215',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-redis-fallback',
            authToken: {
                email: 'fallback@example.com',
                email_verified: true,
                name: 'Fallback User',
                phone_number: '+919876543215',
                auth_time: nowSeconds - 15,
                iat: nowSeconds - 15,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'google.com',
                },
            },
        });

        const storedSession = await browserSessionService.getBrowserSession(session.sessionId);

        expect(redisClient.setEx).toHaveBeenCalled();
        expect(storedSession).toMatchObject({
            sessionId: session.sessionId,
            firebaseUid: 'firebase-redis-fallback',
            email: 'fallback@example.com',
        });
        expect(logger.warn).toHaveBeenCalledWith(
            'browser_session.persist_failed_memory_fallback',
            expect.objectContaining({
                sessionId: session.sessionId,
                error: 'redis write failed',
            })
        );

        await browserSessionService.revokeBrowserSession(session.sessionId);
        await expect(browserSessionService.getBrowserSession(session.sessionId)).resolves.toBeNull();
    });

    test('sets Secure on production cookies even when proxy headers are missing', async () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK = 'true';
        delete process.env.AUTH_SESSION_COOKIE_SECURE;

        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({}),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const res = createResponseStub();

        await browserSessionService.createBrowserSession({
            req: {
                headers: {
                    host: 'api.example.com',
                    origin: 'https://app.example.com',
                },
                secure: false,
            },
            res,
            user: {
                _id: '507f1f77bcf86cd799439017',
                email: 'prod-cookie@example.com',
                name: 'Prod Cookie',
                phone: '+919876543216',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-prod-cookie',
            authToken: {
                email: 'prod-cookie@example.com',
                email_verified: true,
                name: 'Prod Cookie',
                phone_number: '+919876543216',
                auth_time: nowSeconds - 15,
                iat: nowSeconds - 15,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'password',
                },
            },
        });

        const setCookieHeader = res.getHeader('Set-Cookie');

        expect(setCookieHeader[0]).toContain('Secure');
        expect(setCookieHeader[0]).toContain('SameSite=None');
    });

    test('fails closed in production when Redis rejects a session write', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK;

        let browserSessionService;
        let logger;
        const redisClient = {
            setEx: jest.fn().mockRejectedValue(new Error('redis write failed')),
            get: jest.fn().mockResolvedValue(null),
            del: jest.fn().mockResolvedValue(1),
        };

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => redisClient,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../utils/logger', () => ({
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({}),
            }));

            browserSessionService = require('../services/browserSessionService');
            logger = require('../utils/logger');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);

        await expect(browserSessionService.createBrowserSession({
            req: {
                headers: {
                    host: 'api.example.com',
                    origin: 'https://app.example.com',
                },
                secure: false,
            },
            user: {
                _id: '507f1f77bcf86cd799439018',
                email: 'prod-failclosed@example.com',
                name: 'Prod Fail Closed',
                phone: '+919876543217',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-prod-failclosed',
            authToken: {
                email: 'prod-failclosed@example.com',
                email_verified: true,
                name: 'Prod Fail Closed',
                phone_number: '+919876543217',
                auth_time: nowSeconds - 15,
                iat: nowSeconds - 15,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'password',
                },
            },
        })).rejects.toThrow('redis write failed');

        expect(logger.error).toHaveBeenCalledWith(
            'browser_session.persist_failed_no_fallback',
            expect.objectContaining({
                error: 'redis write failed',
            })
        );
    });
});
