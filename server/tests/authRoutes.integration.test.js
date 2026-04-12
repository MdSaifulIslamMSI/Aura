const request = require('supertest');
const app = require('../index');

jest.setTimeout(30000);

describe('Auth API surface', () => {
    test('POST /api/auth/exchange should fail without token', async () => {
        const res = await request(app).post('/api/auth/exchange');
        expect(res.statusCode).toBe(401);
    });

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

    test('POST /api/auth/complete-phone-factor-verification should fail without token', async () => {
        const res = await request(app)
            .post('/api/auth/complete-phone-factor-verification')
            .send({ purpose: 'signup', email: 'test@example.com', phone: '+919876543210' });
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/auth/logout should succeed even without an active session', async () => {
        const res = await request(app).post('/api/auth/logout');
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
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
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: '', deviceLabel: '' }),
                issueTrustedDeviceChallenge: jest.fn().mockResolvedValue({ token: 'stub' }),
                verifyTrustedDeviceChallenge: jest.fn(),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
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

    test('POST /api/auth/sync forwards trusted social provider identity for unverified OAuth emails', async () => {
        let isolatedApp;
        let syncAuthenticatedUserMock;

        jest.isolateModules(() => {
            jest.doMock('../services/authSessionService', () => ({
                buildSessionPayload: jest.fn().mockReturnValue({
                    status: 'authenticated',
                    deviceChallenge: null,
                    session: {
                        uid: 'uid-x-social',
                        email: 'x-social@example.com',
                        emailVerified: false,
                        displayName: 'X Social User',
                        phone: '',
                        providerIds: ['twitter.com'],
                    },
                    intelligence: null,
                    profile: {
                        _id: 'user-1',
                        name: 'X Social User',
                        email: 'x-social@example.com',
                        phone: '',
                        isAdmin: false,
                        isVerified: true,
                        isSeller: false,
                        sellerActivatedAt: null,
                        accountState: 'active',
                        moderation: {},
                        loyalty: {},
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                    roles: {
                        isAdmin: false,
                        isSeller: false,
                        isVerified: true,
                    },
                    error: null,
                }),
                persistAuthSnapshot: jest.fn().mockResolvedValue(undefined),
                resolveAuthenticatedSession: jest.fn(),
                applyLoginAssuranceToSession: jest.fn(async ({ user }) => user),
                syncAuthenticatedUser: (syncAuthenticatedUserMock = jest.fn().mockResolvedValue({
                    _id: 'user-1',
                    name: 'X Social User',
                    email: 'x-social@example.com',
                    phone: '',
                    isAdmin: false,
                    isVerified: true,
                    isSeller: false,
                    sellerActivatedAt: null,
                    accountState: 'active',
                    moderation: {},
                    loyalty: {},
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                })),
            }));
            jest.doMock('../middleware/authMiddleware', () => ({
                invalidateUserCache: jest.fn().mockResolvedValue(undefined),
                invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: '', deviceLabel: '' }),
                issueTrustedDeviceChallenge: jest.fn().mockResolvedValue({ token: 'stub' }),
                verifyTrustedDeviceChallenge: jest.fn(),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));

            const express = require('express');
            const { syncSession } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/sync', (req, _res, next) => {
                req.user = {
                    email: 'x-social@example.com',
                    name: 'X Social User',
                    isVerified: false,
                };
                req.authUid = 'uid-x-social';
                req.authToken = {
                    email: 'x-social@example.com',
                    email_verified: false,
                    firebase: { sign_in_provider: 'twitter.com' },
                };
                req.authIdentity = {
                    uid: 'uid-x-social',
                    email: 'x-social@example.com',
                    displayName: 'X Social User',
                    phoneNumber: '',
                    emailVerified: false,
                };
                next();
            }, syncSession);
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'x-social@example.com', name: 'X Social User' });

        expect(res.statusCode).toBe(200);
        expect(syncAuthenticatedUserMock).toHaveBeenCalledWith(expect.objectContaining({
            authUser: expect.objectContaining({
                uid: 'uid-x-social',
                email: 'x-social@example.com',
                emailVerified: false,
                signInProvider: 'twitter.com',
                providerIds: ['twitter.com'],
            }),
        }));
    });
});

describe('Auth sync lattice challenge policy', () => {
    const originalDeviceChallengeMode = process.env.AUTH_DEVICE_CHALLENGE_MODE;
    const originalChallengeMode = process.env.AUTH_LATTICE_CHALLENGE_MODE;

    afterEach(() => {
        process.env.AUTH_DEVICE_CHALLENGE_MODE = originalDeviceChallengeMode;
        process.env.AUTH_LATTICE_CHALLENGE_MODE = originalChallengeMode;
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../services/authSessionService');
        jest.dontMock('../services/trustedDeviceChallengeService');
    });

    const buildIsolatedSyncApp = ({ challengeMode = '', isAdmin = false } = {}) => {
        let isolatedApp;
        const issueTrustedDeviceChallenge = jest.fn().mockResolvedValue({
            token: 'stub-challenge',
            challenge: 'device-proof',
            mode: 'assert',
            deviceId: 'device-test-1234',
        });

        jest.isolateModules(() => {
            process.env.AUTH_DEVICE_CHALLENGE_MODE = challengeMode;
            process.env.AUTH_LATTICE_CHALLENGE_MODE = '';

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

            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn((req) => ({
                    deviceId: req.headers['x-aura-device-id'] || '',
                    deviceLabel: req.headers['x-aura-device-label'] || '',
                })),
                issueTrustedDeviceChallenge,
                verifyTrustedDeviceChallenge: jest.fn(),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
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

        return { isolatedApp, issueTrustedDeviceChallenge };
    };

    test('POST /api/auth/sync does not require trusted device challenge by default', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp();

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.deviceChallenge).toBeNull();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync can require trusted device challenge when policy is always', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp({ challengeMode: 'always' });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('device_challenge_required');
        expect(res.body.deviceChallenge).toEqual({
            token: 'stub-challenge',
            challenge: 'device-proof',
            mode: 'assert',
            deviceId: 'device-test-1234',
        });
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
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

describe('Firebase phone factor completion for signup and recovery', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const buildIsolatedPhoneFactorVerificationApp = ({
        purpose = 'signup',
        storedPhone = '+919876543210',
        tokenPhone = '+919876543210',
        signupEmailOtpVerifiedAt = new Date().toISOString(),
        resetEmailOtpVerifiedAt = new Date().toISOString(),
        isVerified = false,
    } = {}) => {
        let isolatedApp;

        jest.isolateModules(() => {
            jest.doMock('../models/User', () => ({
                findOne: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue({
                            _id: 'user-1',
                            name: purpose === 'signup' ? 'Pending User' : 'Verified User',
                            email: 'verified@example.com',
                            phone: storedPhone,
                            avatar: '',
                            gender: '',
                            dob: null,
                            bio: '',
                            isAdmin: false,
                            isVerified,
                            signupEmailOtpVerifiedAt,
                            resetEmailOtpVerifiedAt,
                            isSeller: false,
                            sellerActivatedAt: null,
                            accountState: 'active',
                            moderation: {},
                            loyalty: {},
                            createdAt: new Date('2026-01-01T00:00:00.000Z'),
                        }),
                    }),
                }),
                updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
                findOneAndUpdate: jest.fn().mockResolvedValue({
                    _id: 'user-1',
                    name: purpose === 'signup' ? 'Pending User' : 'Verified User',
                    email: 'verified@example.com',
                    phone: storedPhone,
                    avatar: '',
                    gender: '',
                    dob: null,
                    bio: '',
                    isAdmin: false,
                    isVerified: purpose === 'signup' ? true : true,
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
            const { completePhoneFactorVerification } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/complete-phone-factor-verification', (req, _res, next) => {
                req.authUid = 'uid-phone';
                req.authToken = {
                    phone_number: tokenPhone,
                };
                next();
            }, completePhoneFactorVerification);
            isolatedApp.use(errorHandler);
        });

        return isolatedApp;
    };

    test('POST /api/auth/complete-phone-factor-verification completes signup when Firebase phone matches', async () => {
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({ purpose: 'signup', isVerified: false });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'signup',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.purpose).toBe('signup');
    });

    test('POST /api/auth/complete-phone-factor-verification completes recovery when Firebase phone matches', async () => {
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({ purpose: 'forgot-password', isVerified: true });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'forgot-password',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.purpose).toBe('forgot-password');
    });

    test('POST /api/auth/complete-phone-factor-verification requires a recent signup email OTP first', async () => {
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({ purpose: 'signup', signupEmailOtpVerifiedAt: null, isVerified: false });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'signup',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('Signup email verification is required');
    });
});
