const request = require('supertest');
const app = require('../index');

jest.setTimeout(30000);

describe('Auth API surface', () => {
    test('GET /api/auth/session should fail without token', async () => {
        const res = await request(app).get('/api/auth/session');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/auth/sync should fail without token', async () => {
        const res = await request(app)
            .post('/api/auth/sync')
            .send({
                email: 'test@example.com',
                name: 'Test User',
                phone: '+919876543210',
        });
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/auth/otp/send should expose OTP validation under auth aliases', async () => {
        const res = await request(app)
            .post('/api/auth/otp/send')
            .send({ phone: '1234567890', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('required');
    });

    test('POST /api/auth/otp/reset-password should expose recovery validation under auth aliases', async () => {
        const res = await request(app)
            .post('/api/auth/otp/reset-password')
            .send({ email: 'test@example.com' });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('required');
    });
});


describe('Auth sync verified-email gating', () => {
    test('POST /api/auth/sync rejects unverified auth token', async () => {
        let isolatedApp;

        jest.isolateModules(() => {
            jest.doMock('../models/User', () => ({
                findOneAndUpdate: jest.fn(),
                findById: jest.fn(),
                findOne: jest.fn(),
            }));
            jest.doMock('../services/latticeChallengeService', () => ({
                generateLatticeChallenge: jest.fn().mockResolvedValue({ challengeId: 'stub' }),
                verifyLatticeProof: jest.fn(),
            }));

            const express = require('express');
            const { syncSession } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/sync', (req, res, next) => {
                req.user = {
                    email: 'unverified@example.com',
                    name: 'Unverified User',
                    isVerified: false,
                };
                req.authUid = 'uid-unverified';
                req.authToken = {
                    email: 'unverified@example.com',
                    email_verified: false,
                };
                next();
            }, syncSession);
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'unverified@example.com', name: 'Unverified User' });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('Email verification is required before session sync');
    });
});

describe('Auth sync lattice challenge policy', () => {
    const originalChallengeMode = process.env.AUTH_LATTICE_CHALLENGE_MODE;

    afterEach(() => {
        process.env.AUTH_LATTICE_CHALLENGE_MODE = originalChallengeMode;
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../services/authSessionService');
        jest.dontMock('../services/latticeChallengeService');
    });

    const buildIsolatedSyncApp = ({ challengeMode = '', isAdmin = false } = {}) => {
        let isolatedApp;
        const generateLatticeChallenge = jest.fn().mockResolvedValue({ challengeId: 'stub-challenge' });

        jest.isolateModules(() => {
            process.env.AUTH_LATTICE_CHALLENGE_MODE = challengeMode;

            jest.doMock('../services/authSessionService', () => {
                const actual = jest.requireActual('../services/authSessionService');
                return {
                    ...actual,
                    syncAuthenticatedUser: jest.fn().mockResolvedValue({
                        _id: 'user-1',
                        name: 'Verified User',
                        email: 'verified@example.com',
                        phone: '+919876543210',
                        isAdmin,
                        isSeller: false,
                        isVerified: true,
                        accountState: 'active',
                        moderation: {},
                        loyalty: {},
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    }),
                };
            });

            jest.doMock('../services/latticeChallengeService', () => ({
                generateLatticeChallenge,
                verifyLatticeProof: jest.fn(),
            }));

            const express = require('express');
            const { syncSession } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/sync', (req, _res, next) => {
                req.user = {
                    email: 'verified@example.com',
                    name: 'Verified User',
                    phone: '+919876543210',
                    isVerified: true,
                    isAdmin,
                    isSeller: false,
                };
                req.authUid = 'uid-verified';
                req.authToken = {
                    email: 'verified@example.com',
                    email_verified: true,
                };
                next();
            }, syncSession);
            isolatedApp.use(errorHandler);
        });

        return { isolatedApp, generateLatticeChallenge };
    };

    test('POST /api/auth/sync does not require lattice challenge by default', async () => {
        const { isolatedApp, generateLatticeChallenge } = buildIsolatedSyncApp();

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.latticeChallenge).toBeNull();
        expect(generateLatticeChallenge).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync can require lattice challenge when policy is always', async () => {
        const { isolatedApp, generateLatticeChallenge } = buildIsolatedSyncApp({ challengeMode: 'always' });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('lattice_challenge_required');
        expect(res.body.latticeChallenge).toEqual({ challengeId: 'stub-challenge' });
        expect(generateLatticeChallenge).toHaveBeenCalledTimes(1);
    });
});

describe('Firebase phone factor completion', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const buildIsolatedPhoneFactorApp = ({
        storedPhone = '+919876543210',
        tokenPhone = '+919876543210',
        loginEmailOtpVerifiedAt = new Date().toISOString(),
    } = {}) => {
        let isolatedApp;

        jest.isolateModules(() => {
            jest.doMock('../models/User', () => ({
                findOne: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue({
                            _id: 'user-1',
                            name: 'Verified User',
                            email: 'verified@example.com',
                            phone: storedPhone,
                            avatar: '',
                            gender: '',
                            dob: null,
                            bio: '',
                            isAdmin: false,
                            isVerified: true,
                            loginEmailOtpVerifiedAt,
                            isSeller: false,
                            sellerActivatedAt: null,
                            accountState: 'active',
                            moderation: {},
                            loyalty: {},
                            createdAt: new Date('2026-01-01T00:00:00.000Z'),
                        }),
                    }),
                }),
                findOneAndUpdate: jest.fn().mockResolvedValue({
                    _id: 'user-1',
                    name: 'Verified User',
                    email: 'verified@example.com',
                    phone: storedPhone,
                    avatar: '',
                    gender: '',
                    dob: null,
                    bio: '',
                    isAdmin: false,
                    isVerified: true,
                    isSeller: false,
                    sellerActivatedAt: null,
                    accountState: 'active',
                    moderation: {},
                    loyalty: {},
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                }),
            }));
            jest.doMock('../services/authSessionService', () => {
                const actual = jest.requireActual('../services/authSessionService');
                return {
                    ...actual,
                    persistAuthSnapshot: jest.fn().mockResolvedValue(undefined),
                };
            });
            jest.doMock('../middleware/authMiddleware', () => ({
                invalidateUserCache: jest.fn().mockResolvedValue(undefined),
                invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
            }));

            const express = require('express');
            const { completePhoneFactorLogin } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/complete-phone-factor-login', (req, _res, next) => {
                req.user = {
                    email: 'verified@example.com',
                    name: 'Verified User',
                    phone: storedPhone,
                    isVerified: true,
                };
                req.authUid = 'uid-verified';
                req.authToken = {
                    email: 'verified@example.com',
                    email_verified: true,
                    phone_number: tokenPhone,
                };
                next();
            }, completePhoneFactorLogin);
            isolatedApp.use(errorHandler);
        });

        return isolatedApp;
    };

    test('POST /api/auth/complete-phone-factor-login upgrades assurance when Firebase phone matches the account', async () => {
        const isolatedApp = buildIsolatedPhoneFactorApp();

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-login')
            .send({
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.session.phone).toBe('+919876543210');
        expect(res.body.profile.email).toBe('verified@example.com');
    });

    test('POST /api/auth/complete-phone-factor-login rejects mismatched verified phone numbers', async () => {
        const isolatedApp = buildIsolatedPhoneFactorApp({ tokenPhone: '+919811112222' });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-login')
            .send({
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('Verified phone number does not match');
    });

    test('POST /api/auth/complete-phone-factor-login requires a recent email OTP verification first', async () => {
        const isolatedApp = buildIsolatedPhoneFactorApp({ loginEmailOtpVerifiedAt: null });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-login')
            .send({
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('Email OTP verification is required');
    });
});
