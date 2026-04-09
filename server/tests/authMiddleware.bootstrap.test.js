describe('Auth Middleware claim-driven verification bootstrap', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('protect bootstraps users with isVerified=false when token email_verified is absent', async () => {
        jest.resetModules();

        let protect;
        let verifyIdToken;
        let findOne;
        let findOneAndUpdate;

        jest.isolateModules(() => {
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'uid-unverified',
                email: 'new-user@example.com',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });
            findOne = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) }));
            findOneAndUpdate = jest.fn().mockResolvedValue({
                _id: '507f1f77bcf86cd799439011',
                email: 'new-user@example.com',
                name: 'New User',
                isVerified: false,
            });

            jest.doMock('../config/firebase', () => ({
                auth: () => ({ verifyIdToken }),
            }));
            jest.doMock('../models/User', () => ({
                findOne,
                findOneAndUpdate,
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: { authorization: 'Bearer token-123' },
        };
        const res = {};
        const next = jest.fn();

        await protect(req, res, next);

        expect(verifyIdToken).toHaveBeenCalledWith('token-123', true);
        expect(findOneAndUpdate).toHaveBeenCalledWith(
            { email: 'new-user@example.com' },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                    isVerified: false,
                }),
            }),
            expect.any(Object)
        );
        expect(next).toHaveBeenCalledWith();
    });

    test('protect falls back to the Firebase user record when the verified token omits email', async () => {
        jest.resetModules();

        let protect;
        let verifyIdToken;
        let getUser;
        let findOne;
        let findOneAndUpdate;

        jest.isolateModules(() => {
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'uid-social-email-fallback',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });
            getUser = jest.fn().mockResolvedValue({
                email: 'social-fallback@example.com',
                displayName: 'Social Fallback',
                emailVerified: true,
            });
            findOne = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) }));
            findOneAndUpdate = jest.fn().mockResolvedValue({
                _id: '507f191e810c19729de860ea',
                email: 'social-fallback@example.com',
                name: 'Social Fallback',
                isVerified: true,
            });

            jest.doMock('../config/firebase', () => ({
                auth: () => ({ verifyIdToken, getUser }),
            }));
            jest.doMock('../models/User', () => ({
                findOne,
                findOneAndUpdate,
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: { authorization: 'Bearer token-x-123' },
        };
        const res = {};
        const next = jest.fn();

        await protect(req, res, next);

        expect(verifyIdToken).toHaveBeenCalledWith('token-x-123', true);
        expect(getUser).toHaveBeenCalledWith('uid-social-email-fallback');
        expect(findOneAndUpdate).toHaveBeenCalledWith(
            { email: 'social-fallback@example.com' },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                    email: 'social-fallback@example.com',
                    isVerified: true,
                }),
            }),
            expect.any(Object)
        );
        expect(req.authToken.email).toBe('social-fallback@example.com');
        expect(next).toHaveBeenCalledWith();
    });
});
