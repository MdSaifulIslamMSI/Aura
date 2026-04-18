describe('Auth Middleware claim-driven verification bootstrap', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('protect bootstraps users with isVerified=false when token email_verified is absent', async () => {
        jest.resetModules();

        let protect;
        let verifyIdToken;
        let find;
        let findOneAndUpdate;

        jest.isolateModules(() => {
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'uid-unverified',
                email: 'new-user@example.com',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });
            find = jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) }));
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
                find,
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
            {
                $or: [
                    { authUid: 'uid-unverified' },
                    { email: 'new-user@example.com' },
                ],
            },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                    authUid: 'uid-unverified',
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
        let find;
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
            find = jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) }));
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
                find,
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
            {
                $or: [
                    { authUid: 'uid-social-email-fallback' },
                    { email: 'social-fallback@example.com' },
                ],
            },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                    authUid: 'uid-social-email-fallback',
                    email: 'social-fallback@example.com',
                    isVerified: true,
                }),
            }),
            expect.any(Object)
        );
        expect(req.authToken.email).toBe('social-fallback@example.com');
        expect(next).toHaveBeenCalledWith();
    });

    test('protect bootstraps uid-backed social accounts when neither token nor Firebase user record exposes email', async () => {
        jest.resetModules();

        let protect;
        let verifyIdToken;
        let getUser;
        let find;
        let findOneAndUpdate;

        jest.isolateModules(() => {
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'uid-x-no-email',
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'twitter.com' },
            });
            getUser = jest.fn().mockResolvedValue({
                displayName: 'X User',
                emailVerified: false,
                providerData: [],
            });
            find = jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) }));
            findOneAndUpdate = jest.fn().mockResolvedValue({
                _id: '507f191e810c19729de860eb',
                authUid: 'uid-x-no-email',
                email: 'dWlkLXgtbm8tZW1haWw@auth.aura.invalid',
                name: 'X User',
                isVerified: true,
            });

            jest.doMock('../config/firebase', () => ({
                auth: () => ({ verifyIdToken, getUser }),
            }));
            jest.doMock('../models/User', () => ({
                find,
                findOneAndUpdate,
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: { authorization: 'Bearer token-x-no-email' },
        };
        const res = {};
        const next = jest.fn();

        await protect(req, res, next);

        expect(verifyIdToken).toHaveBeenCalledWith('token-x-no-email', true);
        expect(getUser).toHaveBeenCalledWith('uid-x-no-email');
        expect(findOneAndUpdate).toHaveBeenCalledWith(
            {
                $or: [
                    { authUid: 'uid-x-no-email' },
                    { email: 'dwlklxgtbm8tzw1haww@auth.aura.invalid' },
                ],
            },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                    authUid: 'uid-x-no-email',
                    email: 'dwlklxgtbm8tzw1haww@auth.aura.invalid',
                    isVerified: false,
                }),
            }),
            expect.any(Object)
        );
        expect(req.authToken.email).toBe('');
        expect(next).toHaveBeenCalledWith();
    });

    test('protect prefers the canonical public-email profile over a stale uid placeholder', async () => {
        jest.resetModules();

        let protect;
        let verifyIdToken;
        let find;
        let findOneAndUpdate;

        jest.isolateModules(() => {
            verifyIdToken = jest.fn().mockResolvedValue({
                uid: 'uid-split-social',
                email: 'admin@example.com',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });
            find = jest.fn(() => ({
                lean: jest.fn().mockResolvedValue([
                    {
                        _id: 'placeholder-user',
                        authUid: 'uid-split-social',
                        email: 'dWlkLXNwbGl0LXNvY2lhbA@auth.aura.invalid',
                        name: 'Placeholder User',
                        isAdmin: false,
                        isVerified: true,
                        loyalty: { pointsBalance: 0 },
                        createdAt: new Date('2026-03-01T00:00:00.000Z'),
                    },
                    {
                        _id: 'canonical-user',
                        authUid: '',
                        email: 'admin@example.com',
                        name: 'Canonical Admin',
                        isAdmin: true,
                        isVerified: true,
                        loyalty: { pointsBalance: 1808 },
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                ]),
            }));
            findOneAndUpdate = jest.fn();

            jest.doMock('../config/firebase', () => ({
                auth: () => ({ verifyIdToken }),
            }));
            jest.doMock('../models/User', () => ({
                find,
                findOneAndUpdate,
            }));
            jest.doMock('../config/redis', () => ({
                getRedisClient: () => null,
                flags: { redisPrefix: 'test' },
            }));

            protect = require('../middleware/authMiddleware').protect;
        });

        const req = {
            headers: { authorization: 'Bearer token-split-123' },
        };
        const res = {};
        const next = jest.fn();

        await protect(req, res, next);

        expect(verifyIdToken).toHaveBeenCalledWith('token-split-123', true);
        expect(req.user._id).toBe('canonical-user');
        expect(req.user.isAdmin).toBe(true);
        expect(req.user.loyalty.pointsBalance).toBe(1808);
        expect(findOneAndUpdate).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });
});
