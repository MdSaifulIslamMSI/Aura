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
});
