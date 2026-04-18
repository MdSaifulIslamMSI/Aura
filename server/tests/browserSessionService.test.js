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

    test('fails closed in production when shared browser-session storage is unavailable', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK;

        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-prod-1',
                    deviceLabel: 'Production Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);

        await expect(browserSessionService.createBrowserSession({
            req: {
                headers: {
                    host: 'api.aura-aws.internal',
                    'x-forwarded-proto': 'https',
                },
                secure: true,
            },
            user: {
                _id: '507f1f77bcf86cd799439016',
                email: 'prod-user@example.com',
                name: 'Prod User',
                phone: '+919876543215',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-prod-user',
            authToken: {
                email: 'prod-user@example.com',
                email_verified: true,
                name: 'Prod User',
                phone_number: '+919876543215',
                auth_time: nowSeconds - 15,
                iat: nowSeconds - 15,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'password',
                },
            },
        })).rejects.toMatchObject({
            statusCode: 503,
            message: browserSessionService.BROWSER_SESSION_STORAGE_UNAVAILABLE_MESSAGE,
        });
    });

    test('allows an explicit production override for browser-session memory fallback', async () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK = 'true';

        let browserSessionService;

        jest.isolateModules(() => {
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-prod-override-1',
                    deviceLabel: 'Production Override Browser',
                }),
            }));

            browserSessionService = require('../services/browserSessionService');
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        const session = await browserSessionService.createBrowserSession({
            req: {
                headers: {
                    host: 'api.aura-aws.internal',
                    'x-forwarded-proto': 'https',
                },
                secure: true,
            },
            user: {
                _id: '507f1f77bcf86cd799439017',
                email: 'prod-override@example.com',
                name: 'Prod Override User',
                phone: '+919876543216',
                isAdmin: false,
                isSeller: false,
                isVerified: true,
                authAssurance: 'none',
            },
            authUid: 'firebase-prod-override',
            authToken: {
                email: 'prod-override@example.com',
                email_verified: true,
                name: 'Prod Override User',
                phone_number: '+919876543216',
                auth_time: nowSeconds - 15,
                iat: nowSeconds - 15,
                exp: nowSeconds + 3600,
                firebase: {
                    sign_in_provider: 'password',
                },
            },
        });

        await expect(browserSessionService.getBrowserSession(session.sessionId)).resolves.toMatchObject({
            sessionId: session.sessionId,
            email: 'prod-override@example.com',
        });
    });
});
