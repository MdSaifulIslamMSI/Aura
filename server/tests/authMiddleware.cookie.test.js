describe('authMiddleware cookie session authentication', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
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
});
