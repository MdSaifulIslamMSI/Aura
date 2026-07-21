const request = require('supertest');
const app = require('../index');
const User = require('../models/User');
const { generateRecoveryCodesForUser } = require('../services/authRecoveryCodeService');
const { signLoginRiskSignals } = require('../services/authRiskSignalService');
const { DesktopHandoffAssuranceError } = require('../services/desktopHandoffAssuranceService');
const {
    issueTrustedDeviceSession,
    TRUSTED_DEVICE_SESSION_HEADER,
} = require('../services/trustedDeviceChallengeService');
const { inspectOtpFlowToken } = require('../utils/otpFlowToken');
const buildRuntimeSecret = (label = 'test') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}-suite`;
const GENERIC_PHONE_FACTOR_VERIFICATION_MESSAGE = 'If account details are valid, verification will proceed.';

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

    test('POST /api/auth/desktop-handoff/custom-token should fail without token', async () => {
        const res = await request(app)
            .post('/api/auth/desktop-handoff/custom-token')
            .send({ requestId: '123e4567-e89b-12d3-a456-426614174000' });
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

    test('POST /api/auth/logout rejects oversized auth request bodies before controller work', async () => {
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify({ payload: 'x'.repeat(70 * 1024) }));

        expect(res.statusCode).toBe(413);
    });
});

describe('Auth backup recovery codes', () => {
    const originalRecoveryCodeSecret = process.env.AUTH_RECOVERY_CODE_SECRET;

    beforeEach(() => {
        process.env.AUTH_RECOVERY_CODE_SECRET = buildRuntimeSecret('auth-recovery-route');
    });

    afterEach(() => {
        process.env.AUTH_RECOVERY_CODE_SECRET = originalRecoveryCodeSecret;
    });

    test('POST /api/auth/recovery-codes/verify consumes one code and returns a reset flow token', async () => {
        const deviceId = 'device-recovery-route';
        const user = await User.create({
            name: 'Recovery Route User',
            email: `${buildRuntimeSecret('recovery-route')}@test.com`,
            phone: '+919876543210',
            isVerified: true,
            trustedDevices: [{
                deviceId,
                label: 'Passkey',
                method: 'webauthn',
                publicKeySpkiBase64: Buffer.from(buildRuntimeSecret('spki')).toString('base64'),
                webauthnCredentialIdBase64Url: buildRuntimeSecret('credential'),
            }],
        });
        const { codes } = await generateRecoveryCodesForUser({ userId: user._id });
        const { deviceSessionToken } = issueTrustedDeviceSession({ user, deviceId });

        const res = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', deviceId)
            .set(TRUSTED_DEVICE_SESSION_HEADER, deviceSessionToken)
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            flowToken: expect.any(String),
            flowTokenExpiresAt: expect.any(String),
            recoveryCodeState: {
                activeCount: 9,
            },
        });

        const replay = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', deviceId)
            .set(TRUSTED_DEVICE_SESSION_HEADER, deviceSessionToken)
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(replay.statusCode).toBe(401);
        expect(replay.body.message).toContain('invalid or already used');
    });

    test('POST /api/auth/recovery-codes/verify accepts a valid code without an old device session', async () => {
        const deviceId = 'device-recovery-session-required';
        const user = await User.create({
            name: 'Recovery Session Required User',
            email: `${buildRuntimeSecret('recovery-session-required')}@test.com`,
            phone: '+919876543214',
            isVerified: true,
            trustedDevices: [{
                deviceId,
                label: 'Passkey',
                method: 'webauthn',
                publicKeySpkiBase64: Buffer.from(buildRuntimeSecret('spki')).toString('base64'),
                webauthnCredentialIdBase64Url: buildRuntimeSecret('credential'),
            }],
        });
        const { codes } = await generateRecoveryCodesForUser({ userId: user._id });

        const recoveredFromNewBrowser = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', deviceId)
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(recoveredFromNewBrowser.statusCode).toBe(200);
        expect(recoveredFromNewBrowser.body).toMatchObject({
            success: true,
            flowToken: expect.any(String),
        });

        const replay = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', deviceId)
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(replay.statusCode).toBe(401);
        expect(replay.body.message).toBe('Recovery code is invalid or already used.');
    });

    test('POST /api/auth/recovery-codes/verify accepts a valid code when the old device is lost', async () => {
        const deviceId = 'device-recovery-retry';
        const user = await User.create({
            name: 'Recovery Missing Device User',
            email: `${buildRuntimeSecret('recovery-missing-device')}@test.com`,
            phone: '+919876543213',
            isVerified: true,
            trustedDevices: [{
                deviceId,
                label: 'Passkey',
                method: 'webauthn',
                publicKeySpkiBase64: Buffer.from(buildRuntimeSecret('spki')).toString('base64'),
                webauthnCredentialIdBase64Url: buildRuntimeSecret('credential'),
            }],
        });
        const { codes } = await generateRecoveryCodesForUser({ userId: user._id });

        const recoveredWithoutDevice = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(recoveredWithoutDevice.statusCode).toBe(200);
        expect(recoveredWithoutDevice.body).toMatchObject({
            success: true,
            flowToken: expect.any(String),
        });
    });

    test('POST /api/auth/recovery-codes/verify masks unknown and wrong recovery code failures', async () => {
        const deviceId = 'device-recovery-invalid-code';
        const user = await User.create({
            name: 'Recovery Wrong Code User',
            email: `${buildRuntimeSecret('recovery-wrong')}@test.com`,
            phone: '+919876543212',
            isVerified: true,
            trustedDevices: [{
                deviceId,
                label: 'Passkey',
                method: 'webauthn',
                publicKeySpkiBase64: Buffer.from(buildRuntimeSecret('spki')).toString('base64'),
                webauthnCredentialIdBase64Url: buildRuntimeSecret('credential'),
            }],
        });
        await generateRecoveryCodesForUser({ userId: user._id });
        const { deviceSessionToken } = issueTrustedDeviceSession({ user, deviceId });

        const wrongCode = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', deviceId)
            .set(TRUSTED_DEVICE_SESSION_HEADER, deviceSessionToken)
            .send({
                email: user.email,
                code: 'WRONG-CODE-0000',
            });
        const unknownAccount = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', deviceId)
            .set(TRUSTED_DEVICE_SESSION_HEADER, deviceSessionToken)
            .send({
                email: `${buildRuntimeSecret('recovery-unknown')}@test.com`,
                code: 'WRONG-CODE-0000',
            });

        expect(wrongCode.statusCode).toBe(401);
        expect(unknownAccount.statusCode).toBe(401);
        expect(wrongCode.body.message).toBe('Recovery code is invalid or already used.');
        expect(unknownAccount.body.message).toBe(wrongCode.body.message);
    });

    test('POST /api/auth/recovery-codes/verify issues a one-time reset flow that is not bound to the lost device', async () => {
        const deviceId = 'device-recovery-a';
        const user = await User.create({
            name: 'Recovery Device Bound User',
            email: `${buildRuntimeSecret('recovery-device-bound')}@test.com`,
            phone: '+919876543211',
            isVerified: true,
            trustedDevices: [{
                deviceId,
                label: 'Passkey',
                method: 'webauthn',
                publicKeySpkiBase64: Buffer.from(buildRuntimeSecret('spki')).toString('base64'),
                webauthnCredentialIdBase64Url: buildRuntimeSecret('credential'),
            }],
        });
        const { codes } = await generateRecoveryCodesForUser({ userId: user._id });
        const { deviceSessionToken } = issueTrustedDeviceSession({ user, deviceId });

        const verifyRes = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', deviceId)
            .set(TRUSTED_DEVICE_SESSION_HEADER, deviceSessionToken)
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(verifyRes.statusCode).toBe(200);
        expect(verifyRes.body.flowToken).toEqual(expect.any(String));
        expect(inspectOtpFlowToken(verifyRes.body.flowToken)).toMatchObject({
            purpose: 'forgot-password',
            factor: 'recovery-code',
            nextStep: 'reset-password',
            signalBond: {},
        });
    });
});


describe('Auth sync verified-email gating', () => {
    afterEach(() => {
        jest.dontMock('../config/authTrustedDeviceFlags');
        jest.resetModules();
        jest.clearAllMocks();
    });

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
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge: jest.fn().mockResolvedValue({ token: 'stub' }),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({ verified: false, deviceId: '', deviceSessionHash: '' }),
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
            jest.doMock('../config/authTrustedDeviceFlags', () => ({
                shouldRequireTrustedDevice: jest.fn().mockReturnValue(false),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: '', deviceLabel: '' }),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge: jest.fn().mockResolvedValue({ token: 'stub' }),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({ verified: false, deviceId: '', deviceSessionHash: '' }),
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

describe('Browser session replacement hardening', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('establishSessionCookie revokes a superseded cookie session after minting the replacement', async () => {
        let isolatedApp;
        let refreshBrowserSession;
        let revokeBrowserSession;

        jest.isolateModules(() => {
            refreshBrowserSession = jest.fn().mockResolvedValue({
                sessionId: 'new-session-1',
            });
            revokeBrowserSession = jest.fn().mockResolvedValue(undefined);

            jest.doMock('../services/browserSessionService', () => ({
                clearBrowserSessionCookie: jest.fn(),
                getBrowserSessionFromRequest: jest.fn(),
                refreshBrowserSession,
                revokeBrowserSession,
            }));

            const express = require('express');
            const { establishSessionCookie } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.get('/mint-session', (req, _res, next) => {
                req.user = {
                    _id: '507f1f77bcf86cd799439099',
                    email: 'replace-session@example.com',
                };
                req.authUid = 'uid-replace-session';
                req.authToken = {
                    email: 'replace-session@example.com',
                    email_verified: true,
                };
                req.supersededAuthSessionId = 'old-session-1';
                next();
            }, establishSessionCookie, (req, res) => {
                res.json({
                    sessionId: req.authSession?.sessionId,
                    supersededAuthSessionId: req.supersededAuthSessionId || null,
                });
            });
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp).get('/mint-session');

        expect(res.statusCode).toBe(200);
        expect(refreshBrowserSession).toHaveBeenCalledWith(expect.objectContaining({
            authUid: 'uid-replace-session',
            user: expect.objectContaining({
                email: 'replace-session@example.com',
            }),
        }));
        expect(revokeBrowserSession).toHaveBeenCalledWith('old-session-1');
        expect(res.body).toEqual({
            sessionId: 'new-session-1',
            supersededAuthSessionId: null,
        });
    });

    test('establishSessionCookie refreshes matching session metadata from fresh bearer proof', async () => {
        let isolatedApp;
        let refreshBrowserSession;

        jest.isolateModules(() => {
            refreshBrowserSession = jest.fn().mockResolvedValue({
                sessionId: 'existing-session-1',
                firebaseExpiresAtSeconds: 2000000000,
                amr: ['webauthn', 'mfa'],
            });

            jest.doMock('../services/browserSessionService', () => ({
                clearBrowserSessionCookie: jest.fn(),
                getBrowserSessionFromRequest: jest.fn(),
                refreshBrowserSession,
                revokeBrowserSession: jest.fn(),
            }));

            const express = require('express');
            const { establishSessionCookie } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.get('/refresh-session', (req, _res, next) => {
                req.headers.authorization = 'Bearer fresh-token';
                req.user = {
                    _id: '507f1f77bcf86cd799439099',
                    email: 'refresh-session@example.com',
                };
                req.authUid = 'uid-refresh-session';
                req.authToken = {
                    uid: 'uid-refresh-session',
                    exp: 2000000000,
                };
                req.authSession = {
                    sessionId: 'existing-session-1',
                    firebaseUid: 'uid-refresh-session',
                    firebaseExpiresAtSeconds: 1000000000,
                    amr: ['webauthn', 'mfa'],
                };
                next();
            }, establishSessionCookie, (req, res) => {
                res.json({ session: req.authSession });
            });
            isolatedApp.get('/keep-cookie-session', (req, _res, next) => {
                req.user = {
                    _id: '507f1f77bcf86cd799439099',
                    email: 'refresh-session@example.com',
                };
                req.authUid = 'uid-refresh-session';
                req.authToken = {
                    uid: 'uid-refresh-session',
                    exp: 1000000000,
                };
                req.authSession = {
                    sessionId: 'existing-session-1',
                    firebaseUid: 'uid-refresh-session',
                    firebaseExpiresAtSeconds: 1000000000,
                    amr: ['webauthn', 'mfa'],
                };
                next();
            }, establishSessionCookie, (req, res) => {
                res.json({ session: req.authSession });
            });
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp).get('/refresh-session');
        const cookieSessionRes = await request(isolatedApp).get('/keep-cookie-session');

        expect(res.statusCode).toBe(200);
        expect(refreshBrowserSession).toHaveBeenCalledWith(expect.objectContaining({
            currentSession: expect.objectContaining({
                sessionId: 'existing-session-1',
                amr: ['webauthn', 'mfa'],
            }),
            authToken: expect.objectContaining({
                exp: 2000000000,
            }),
            rotate: false,
        }));
        expect(res.body.session).toMatchObject({
            sessionId: 'existing-session-1',
            firebaseExpiresAtSeconds: 2000000000,
            amr: ['webauthn', 'mfa'],
        });
        expect(refreshBrowserSession).toHaveBeenCalledTimes(1);
        expect(cookieSessionRes.statusCode).toBe(200);
        expect(cookieSessionRes.body.session).toMatchObject({
            sessionId: 'existing-session-1',
            firebaseExpiresAtSeconds: 1000000000,
            amr: ['webauthn', 'mfa'],
        });
    });
});

describe('Trusted device bootstrap challenge', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('POST /api/auth/bootstrap-device-challenge returns a fresh trusted-device challenge for recovery flows', async () => {
        let isolatedApp;
        const bootstrapToken = buildRuntimeSecret('bootstrap-ref');
        const challengeValue = buildRuntimeSecret('challenge-ref');
        const publicKeySpkiBase64 = buildRuntimeSecret('key-ref');
        const deviceSessionToken = buildRuntimeSecret('session-ref');
        const issueTrustedDeviceBootstrapChallenge = jest.fn().mockResolvedValue({
            token: bootstrapToken,
            challenge: challengeValue,
            mode: 'assert',
            deviceId: 'device-test-1234',
        });

        jest.isolateModules(() => {
            jest.doMock('../models/User', () => ({
                findOne: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue({
                        _id: 'user-1',
                        email: 'verified@example.com',
                        phone: '+919876543210',
                        isVerified: true,
                        trustedDevices: [{
                            deviceId: 'device-test-1234',
                            label: 'Verified Browser',
                            publicKeySpkiBase64,
                        }],
                    }),
                }),
                findById: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceChallengePayload: jest.fn().mockReturnValue({}),
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-test-1234',
                    deviceLabel: 'Verified Browser',
                }),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(deviceSessionToken),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue('device-session-hash'),
                issueTrustedDeviceBootstrapChallenge,
                issueTrustedDeviceChallenge: jest.fn(),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockResolvedValue({
                    required: false,
                    verified: false,
                    deviceId: '',
                    deviceSessionHash: '',
                    reason: '',
                }),
                verifyTrustedDeviceChallenge: jest.fn(),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));

            const express = require('express');
            const { requestBootstrapDeviceChallenge } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/bootstrap-device-challenge', requestBootstrapDeviceChallenge);
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp)
            .post('/api/auth/bootstrap-device-challenge')
            .set('x-aura-device-id', 'device-test-1234')
            .set('x-aura-device-session', deviceSessionToken)
            .send({
                scope: 'otp-send:forgot-password',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            deviceChallenge: {
                token: bootstrapToken,
                challenge: challengeValue,
                mode: 'assert',
                deviceId: 'device-test-1234',
                audience: 'public',
                purpose: 'sign_in',
                surface: 'authentication',
                requiredAssurance: 'device_proof',
                blocking: true,
                exitMode: 'sign_out',
            },
        });
        expect(issueTrustedDeviceBootstrapChallenge).toHaveBeenCalledWith(expect.objectContaining({
            scope: 'otp-send:forgot-password',
        }));
    });
});

describe('Auth sync lattice challenge policy', () => {
    const originalDeviceChallengeMode = process.env.AUTH_DEVICE_CHALLENGE_MODE;
    const originalChallengeMode = process.env.AUTH_LATTICE_CHALLENGE_MODE;
    const originalRiskEngineMode = process.env.AUTH_RISK_ENGINE_MODE;
    const originalRiskSignalSecret = process.env.AUTH_RISK_SIGNAL_SECRET;
    const originalMfaEnabled = process.env.MFA_ENABLED;
    const originalMfaTotpEnabled = process.env.MFA_TOTP_ENABLED;
    const originalMfaPasskeyEnabled = process.env.MFA_PASSKEY_ENABLED;
    const originalMfaRecoveryCodesEnabled = process.env.MFA_RECOVERY_CODES_ENABLED;
    const originalMfaSecretEncryptionKey = process.env.MFA_SECRET_ENCRYPTION_KEY;

    afterEach(() => {
        process.env.AUTH_DEVICE_CHALLENGE_MODE = originalDeviceChallengeMode;
        process.env.AUTH_LATTICE_CHALLENGE_MODE = originalChallengeMode;
        process.env.AUTH_RISK_ENGINE_MODE = originalRiskEngineMode;
        if (originalRiskSignalSecret === undefined) {
            delete process.env.AUTH_RISK_SIGNAL_SECRET;
        } else {
            process.env.AUTH_RISK_SIGNAL_SECRET = originalRiskSignalSecret;
        }
        for (const [key, value] of [
            ['MFA_ENABLED', originalMfaEnabled],
            ['MFA_TOTP_ENABLED', originalMfaTotpEnabled],
            ['MFA_PASSKEY_ENABLED', originalMfaPasskeyEnabled],
            ['MFA_RECOVERY_CODES_ENABLED', originalMfaRecoveryCodesEnabled],
            ['MFA_SECRET_ENCRYPTION_KEY', originalMfaSecretEncryptionKey],
        ]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../services/authSessionService');
        jest.dontMock('../services/browserSessionService');
        jest.dontMock('../services/desktopHandoffAssuranceService');
        jest.dontMock('../services/trustedDeviceChallengeService');
    });

    const buildIsolatedSyncApp = ({
        challengeMode = '',
        isAdmin = false,
        authSession = null,
        riskEngineMode = '',
        riskSignalSecret = '',
        mfaEnabled = false,
        userMfa = null,
        trustedDevices = [],
        recoveryCodeState = { activeCount: 0 },
        desktopHandoffGrant = null,
        desktopHandoffConsumeError = null,
        persistedDesktopHandoffClaim = false,
        trustedDeviceSessionValid = false,
        trustedDeviceSessionExpiresAtMs = 0,
        trustedDeviceChallengeError = null,
    } = {}) => {
        let isolatedApp;
        const challengeToken = buildRuntimeSecret('challenge-ref');
        const challengeValue = buildRuntimeSecret('sig-ref');
        const issueTrustedDeviceChallenge = jest.fn().mockImplementation(async ({
            deviceId = 'device-test-1234',
            challengeScope = '',
        } = {}) => {
            if (trustedDeviceChallengeError) throw trustedDeviceChallengeError;
            return {
                token: challengeToken,
                challenge: challengeValue,
                mode: 'assert',
                deviceId,
                scope: challengeScope,
            };
        });
        const refreshBrowserSession = jest.fn().mockImplementation(({
            req = {},
            riskState = '',
            deviceMethod = '',
            stepUpUntil = null,
            webAuthnStepUpUntil = null,
            additionalAmr = [],
        } = {}) => Promise.resolve({
            sessionId: 'session-created-1',
            firebaseUid: 'uid-verified',
            email: 'verified@example.com',
            emailVerified: true,
            displayName: 'Verified User',
            phoneNumber: '+919876543210',
            providerIds: ['password'],
            deviceId: req.headers?.['x-aura-device-id'] || 'device-test-1234',
            deviceMethod,
            amr: ['password', ...additionalAmr],
            riskState: riskState || 'standard',
            stepUpUntil,
            webAuthnStepUpUntil,
        }));
        const revokeBrowserSession = jest.fn().mockResolvedValue(undefined);
        const consumeDesktopHandoffAssuranceGrant = jest.fn().mockImplementation(async () => {
            if (desktopHandoffConsumeError) throw desktopHandoffConsumeError;
            return desktopHandoffGrant;
        });
        const inspectDesktopHandoffAssurance = jest.fn().mockReturnValue({ ready: true });
        const userFixture = {
            _id: 'user-1',
            name: 'Verified User',
            email: 'verified@example.com',
            phone: '+919876543210',
            isAdmin,
            isSeller: false,
            isVerified: true,
            accountState: 'active',
            moderation: {},
            mfa: userMfa || undefined,
            trustedDevices,
            recoveryCodeState,
            loyalty: {},
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };

        jest.isolateModules(() => {
            process.env.AUTH_DEVICE_CHALLENGE_MODE = challengeMode;
            process.env.AUTH_LATTICE_CHALLENGE_MODE = '';
            process.env.AUTH_RISK_ENGINE_MODE = riskEngineMode;
            process.env.AUTH_RISK_SIGNAL_SECRET = riskSignalSecret;
            process.env.MFA_ENABLED = mfaEnabled ? 'true' : 'false';
            process.env.MFA_TOTP_ENABLED = mfaEnabled ? 'true' : 'false';
            process.env.MFA_PASSKEY_ENABLED = mfaEnabled ? 'true' : 'false';
            process.env.MFA_RECOVERY_CODES_ENABLED = 'true';
            process.env.MFA_SECRET_ENCRYPTION_KEY = 'test-mfa-secret-encryption-key-32-characters-plus';

            jest.doMock('../services/browserSessionService', () => ({
                SESSION_STEP_UP_TTL_MS: 10 * 60 * 1000,
                clearBrowserSessionCookie: jest.fn(),
                getBrowserSessionFromRequest: jest.fn(),
                refreshBrowserSession,
                revokeBrowserSession,
            }));

            jest.doMock('../services/authSessionService', () => {
                const actual = jest.requireActual('../services/authSessionService');
                return {
                    ...actual,
                    resolveAuthenticatedSession: jest.fn().mockResolvedValue({
                        user: userFixture,
                        payload: {
                            status: 'authenticated',
                            user: userFixture,
                            session: authSession,
                        },
                    }),
                    syncAuthenticatedUser: jest.fn().mockResolvedValue(userFixture),
                };
            });

            jest.doMock('../services/desktopHandoffAssuranceService', () => ({
                createDesktopHandoffAssuranceGrant: jest.fn(),
                consumeDesktopHandoffAssuranceGrant,
                inspectDesktopHandoffAssurance,
            }));

            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn((req) => ({
                    deviceId: req.headers['x-aura-device-id'] || '',
                    deviceLabel: req.headers['x-aura-device-label'] || '',
                })),
                getTrustedDeviceRegistration: jest.fn((_user, deviceId = '') => (
                    trustedDevices.find((device) => {
                        if (device.deviceId !== deviceId || device.revokedAt) return false;
                        const expiresAtMs = device.expiresAt ? new Date(device.expiresAt).getTime() : 0;
                        return !Number.isFinite(expiresAtMs) || expiresAtMs <= 0 || expiresAtMs > Date.now();
                    }) || null
                )),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge,
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({ verified: false, deviceId: '', deviceSessionHash: '' }),
                verifyTrustedDeviceChallenge: jest.fn(),
                verifyTrustedDeviceSession: jest.fn(({ deviceId = '', deviceSessionToken = '' } = {}) => {
                    const success = trustedDeviceSessionValid || Boolean(
                        desktopHandoffGrant
                        && deviceId === desktopHandoffGrant.deviceId
                        && deviceSessionToken === desktopHandoffGrant.deviceSessionToken
                    );
                    return {
                        success,
                        ...(success ? {
                            expiresAtMs: trustedDeviceSessionExpiresAtMs || (Date.now() + (60 * 60 * 1000)),
                        } : {}),
                    };
                }),
                shouldReproveTrustedDeviceSession: jest.fn((verification = {}) => Boolean(
                    verification.success
                    && Number(verification.expiresAtMs || 0) - Date.now() <= (5 * 60 * 1000)
                )),
            }));

            const express = require('express');
            const { getSession, prepareDesktopHandoff, syncSession } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            const establishAuthContext = (req, _res, next) => {
                req.user = {
                    email: 'verified@example.com',
                    name: 'Verified User',
                    phone: '+919876543210',
                    isVerified: true,
                    isAdmin,
                    isSeller: false,
                    mfa: userMfa || undefined,
                    trustedDevices,
                    recoveryCodeState,
                };
                req.authUid = 'uid-verified';
                req.authToken = {
                    email: 'verified@example.com',
                    email_verified: true,
                    ...(desktopHandoffGrant || persistedDesktopHandoffClaim ? {
                        desktop_handoff: true,
                        desktop_request_id: '123e4567-e89b-12d3-a456-426614174000',
                    } : {}),
                };
                req.authSession = authSession;
                next();
            };
            isolatedApp.post('/api/auth/sync', establishAuthContext, syncSession);
            isolatedApp.get('/api/auth/session', establishAuthContext, getSession);
            isolatedApp.post('/api/auth/desktop-handoff/prepare', establishAuthContext, prepareDesktopHandoff);
            isolatedApp.use(errorHandler);
        });

        return {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            inspectDesktopHandoffAssurance,
            issueTrustedDeviceChallenge,
            refreshBrowserSession,
            revokeBrowserSession,
        };
    };

    test('POST /api/auth/sync does not require trusted device challenge by default', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge, refreshBrowserSession } = buildIsolatedSyncApp();

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.deviceChallenge).toBeNull();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
        expect(refreshBrowserSession).toHaveBeenCalledTimes(1);
        expect(res.body.session.sessionId).toBe('session-created-1');
    });

    test('POST /api/auth/sync returns MFA challenge without final session when user MFA is enabled', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge, refreshBrowserSession } = buildIsolatedSyncApp({
            mfaEnabled: true,
            userMfa: {
                enabled: true,
                defaultMethod: 'totp',
                totp: {
                    enabled: true,
                    confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
                },
            },
            recoveryCodeState: { activeCount: 2 },
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('mfa_challenge_required');
        expect(res.body.requiresMfa).toBe(true);
        expect(res.body.deviceChallenge).toBeNull();
        expect(res.body.mfaChallenge).toMatchObject({
            purpose: 'login',
            allowedMethods: ['totp', 'recovery_code'],
            preferredMethod: 'totp',
            audience: 'public',
            surface: 'authentication',
            presentationPurpose: 'sign_in',
            blocking: true,
            requiredAssurance: 'mfa',
        });
        expect(res.body.mfaPolicy).toMatchObject({
            mfaRequired: true,
            reason: 'user_enabled',
            audience: 'public',
            surface: 'authentication',
            presentationPurpose: 'sign_in',
            blocking: true,
            requiredAssurance: 'mfa',
        });
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
        expect(refreshBrowserSession).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.body.session.sessionId).toBeUndefined();
    });

    test('POST /api/auth/sync labels a passkey-only admin challenge as admin passkey assurance', async () => {
        const credentialId = 'admin-passkey-credential-1';
        const { isolatedApp, refreshBrowserSession } = buildIsolatedSyncApp({
            isAdmin: true,
            mfaEnabled: true,
            userMfa: {
                enabled: true,
                defaultMethod: 'passkey',
                passkeys: [{ credentialId }],
            },
            trustedDevices: [{
                deviceId: 'device-admin-passkey-1',
                method: 'webauthn',
                webauthnCredentialIdBase64Url: credentialId,
                webauthnUserVerified: true,
                credentialScope: 'admin',
                adminEligibility: 'verified',
            }],
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            status: 'mfa_challenge_required',
            mfaChallenge: {
                allowedMethods: ['passkey'],
                audience: 'admin',
                requiredAssurance: 'admin_passkey',
            },
            mfaPolicy: {
                allowedMethods: ['passkey'],
                audience: 'admin',
                requiredAssurance: 'admin_passkey',
            },
        });
        expect(res.body.mfaChallenge).not.toHaveProperty('nextAssurance');
        expect(res.body.mfaPolicy).not.toHaveProperty('nextAssurance');
        expect(refreshBrowserSession).not.toHaveBeenCalled();
        expect(res.body.session.sessionId).toBeUndefined();
    });

    test('POST /api/auth/sync consumes browser assurance only to challenge the target desktop device', async () => {
        const credentialId = 'admin-passkey-credential-desktop-relay';
        const desktopHandoffGrant = {
            bootstrapExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            requestId: '123e4567-e89b-12d3-a456-426614174000',
            loginMfaSatisfied: true,
            adminPasskeySatisfied: true,
        };
        const sourceBrowserDeviceId = 'aura_hosted_browser_device_1';
        const targetDesktopDeviceId = 'aura_old_desktop_device_1';
        const {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            issueTrustedDeviceChallenge,
            refreshBrowserSession,
        } = buildIsolatedSyncApp({
            isAdmin: true,
            mfaEnabled: true,
            userMfa: {
                enabled: true,
                defaultMethod: 'passkey',
                passkeys: [{ credentialId }],
            },
            trustedDevices: [{
                deviceId: sourceBrowserDeviceId,
                method: 'webauthn',
                webauthnCredentialIdBase64Url: credentialId,
                webauthnUserVerified: true,
                credentialScope: 'admin',
                adminEligibility: 'verified',
                sessionVersion: 'desktop-relay-session-v1',
            }],
            desktopHandoffGrant,
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', targetDesktopDeviceId)
            .send({
                email: 'verified@example.com',
                name: 'Verified User',
                desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            status: 'device_challenge_required',
            deviceChallenge: {
                deviceId: targetDesktopDeviceId,
                scope: 'desktop_handoff_target',
            },
            mfaChallenge: null,
            desktopHandoff: {
                targetDeviceProofRequired: true,
            },
        });
        expect(res.body).not.toHaveProperty('deviceSessionToken');
        expect(res.body.desktopHandoff).not.toHaveProperty('assuranceTransferred');
        expect(res.body.desktopHandoff).not.toHaveProperty('deviceId');
        expect(res.body.desktopHandoff).not.toHaveProperty('deviceMethod');
        expect(consumeDesktopHandoffAssuranceGrant).toHaveBeenCalledWith(expect.objectContaining({
            desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
        }));
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: targetDesktopDeviceId,
            challengeScope: 'desktop_handoff_target',
            desktopHandoffBootstrap: {
                expiresAt: desktopHandoffGrant.bootstrapExpiresAt,
                requestId: desktopHandoffGrant.requestId,
                loginMfaSatisfied: true,
                adminPasskeySatisfied: true,
            },
        }));
        expect(refreshBrowserSession).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync requires a fresh handoff after target challenge infrastructure fails', async () => {
        const targetDesktopDeviceId = 'aura_desktop_device_transient_1';
        const {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            issueTrustedDeviceChallenge,
        } = buildIsolatedSyncApp({
            desktopHandoffGrant: {
                bootstrapExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
            trustedDeviceChallengeError: new Error('challenge signer unavailable'),
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', targetDesktopDeviceId)
            .send({
                email: 'verified@example.com',
                name: 'Verified User',
                desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(503);
        expect(res.body).toMatchObject({
            success: false,
            code: 'DESKTOP_HANDOFF_TARGET_CHALLENGE_UNAVAILABLE',
        });
        expect(consumeDesktopHandoffAssuranceGrant).toHaveBeenCalledTimes(1);
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
    });

    test('POST /api/auth/sync returns the source session-store restart code after grant consumption', async () => {
        const sessionStoreError = new DesktopHandoffAssuranceError(
            'Desktop handoff source browser session could not be verified.',
            503,
            'DESKTOP_HANDOFF_ASSURANCE_SESSION_STORE_UNAVAILABLE'
        );
        const {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            issueTrustedDeviceChallenge,
        } = buildIsolatedSyncApp({
            desktopHandoffGrant: {
                bootstrapExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
            desktopHandoffConsumeError: sessionStoreError,
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'aura_desktop_device_session_store_1')
            .send({
                email: 'verified@example.com',
                name: 'Verified User',
                desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(503);
        expect(res.body).toMatchObject({
            success: false,
            code: 'DESKTOP_HANDOFF_ASSURANCE_SESSION_STORE_UNAVAILABLE',
        });
        expect(consumeDesktopHandoffAssuranceGrant).toHaveBeenCalledTimes(1);
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync preserves target challenge security validation errors', async () => {
        const validationError = new Error('Desktop handoff target assurance binding is invalid.');
        validationError.statusCode = 403;
        validationError.code = 'DESKTOP_HANDOFF_TARGET_BINDING_INVALID';
        const {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            issueTrustedDeviceChallenge,
        } = buildIsolatedSyncApp({
            desktopHandoffGrant: {
                bootstrapExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
            trustedDeviceChallengeError: validationError,
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'aura_desktop_device_invalid_binding_1')
            .send({
                email: 'verified@example.com',
                name: 'Verified User',
                desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({
            success: false,
            code: 'DESKTOP_HANDOFF_TARGET_BINDING_INVALID',
        });
        expect(res.body.code).not.toBe('DESKTOP_HANDOFF_TARGET_CHALLENGE_UNAVAILABLE');
        expect(consumeDesktopHandoffAssuranceGrant).toHaveBeenCalledTimes(1);
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
    });

    test('POST /api/auth/sync rejects a legacy WebAuthn target before consuming its handoff grant', async () => {
        const targetDesktopDeviceId = 'aura_legacy_desktop_webauthn_1';
        const {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            issueTrustedDeviceChallenge,
        } = buildIsolatedSyncApp({
            desktopHandoffGrant: {
                bootstrapExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
            trustedDevices: [{
                deviceId: targetDesktopDeviceId,
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'legacy-target-credential',
            }],
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', targetDesktopDeviceId)
            .send({
                email: 'verified@example.com',
                name: 'Verified User',
                desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('DESKTOP_TARGET_IDENTITY_ROTATION_REQUIRED');
        expect(consumeDesktopHandoffAssuranceGrant).not.toHaveBeenCalled();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync rejects a missing target device before consuming its handoff grant', async () => {
        const {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            issueTrustedDeviceChallenge,
        } = buildIsolatedSyncApp({
            desktopHandoffGrant: {
                bootstrapExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({
                email: 'verified@example.com',
                name: 'Verified User',
                desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Aura Desktop must provide its local trusted-device identity.');
        expect(consumeDesktopHandoffAssuranceGrant).not.toHaveBeenCalled();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync does not replay a consumed handoff grant after the target device owns a valid session', async () => {
        const {
            isolatedApp,
            consumeDesktopHandoffAssuranceGrant,
            issueTrustedDeviceChallenge,
            refreshBrowserSession,
        } = buildIsolatedSyncApp({
            persistedDesktopHandoffClaim: true,
            trustedDeviceSessionValid: true,
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'aura_desktop_device_1')
            .set('x-aura-device-session', 'electron-owned-device-session')
            .send({
                email: 'verified@example.com',
                name: 'Verified User',
                desktopHandoffRequestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            status: 'authenticated',
            deviceChallenge: null,
            mfaChallenge: null,
        });
        expect(res.body).not.toHaveProperty('desktopHandoff');
        expect(consumeDesktopHandoffAssuranceGrant).not.toHaveBeenCalled();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
        expect(refreshBrowserSession).toHaveBeenCalledTimes(1);
    });

    test('GET /api/auth/session requests local-key reproof after the target device token expires', async () => {
        const authSession = {
            sessionId: 'desktop-target-session',
            deviceId: 'aura_desktop_device_1',
            deviceMethod: 'browser_key',
            amr: ['password', 'desktop_handoff', 'device_binding'],
        };
        const trustedDevices = [{
            deviceId: authSession.deviceId,
            method: 'browser_key',
            sessionVersion: 'desktop-session-v1',
        }];
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp({
            authSession,
            trustedDevices,
        });

        const res = await request(isolatedApp)
            .get('/api/auth/session')
            .set('x-aura-device-id', authSession.deviceId);

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            status: 'device_challenge_required',
            deviceChallenge: { deviceId: authSession.deviceId },
        });
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            allowEnrollment: false,
            deviceId: authSession.deviceId,
        }));
    });

    test('GET /api/auth/session proactively reproofs a target device token near expiry', async () => {
        const authSession = {
            sessionId: 'desktop-target-session',
            deviceId: 'aura_desktop_device_1',
            deviceMethod: 'browser_key',
            amr: ['password', 'desktop_handoff', 'device_binding'],
        };
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp({
            authSession,
            trustedDevices: [{
                deviceId: authSession.deviceId,
                method: 'browser_key',
                sessionVersion: 'desktop-session-v1',
            }],
            trustedDeviceSessionValid: true,
            trustedDeviceSessionExpiresAtMs: Date.now() + 60_000,
        });

        const res = await request(isolatedApp)
            .get('/api/auth/session')
            .set('x-aura-device-id', authSession.deviceId)
            .set('x-aura-device-session', 'near-expiry-device-session');

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('device_challenge_required');
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            allowEnrollment: false,
            deviceId: authSession.deviceId,
        }));
    });

    test('GET /api/auth/session keeps a healthy proved target session authenticated', async () => {
        const authSession = {
            sessionId: 'desktop-target-session',
            deviceId: 'aura_desktop_device_1',
            deviceMethod: 'browser_key',
            amr: ['password', 'desktop_handoff', 'device_binding'],
        };
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp({
            authSession,
            trustedDevices: [{
                deviceId: authSession.deviceId,
                method: 'browser_key',
                sessionVersion: 'desktop-session-v1',
            }],
            trustedDeviceSessionValid: true,
            trustedDeviceSessionExpiresAtMs: Date.now() + (60 * 60 * 1000),
        });

        const res = await request(isolatedApp)
            .get('/api/auth/session')
            .set('x-aura-device-id', authSession.deviceId)
            .set('x-aura-device-session', 'healthy-device-session');

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.deviceChallenge).toBeNull();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
    });

    test.each([
        ['deleted', []],
        ['revoked', [{
            deviceId: 'aura_desktop_device_1',
            method: 'browser_key',
            revokedAt: new Date().toISOString(),
        }]],
        ['expired', [{
            deviceId: 'aura_desktop_device_1',
            method: 'browser_key',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        }]],
        ['replaced by a passkey registration', [{
            deviceId: 'aura_desktop_device_1',
            method: 'webauthn',
            webauthnCredentialIdBase64Url: 'passkey-credential-id',
        }]],
    ])('GET /api/auth/session requires fresh sign-in for a %s desktop registration', async (
        _label,
        trustedDevices
    ) => {
        const authSession = {
            sessionId: 'desktop-target-session',
            deviceId: 'aura_desktop_device_1',
            deviceMethod: 'browser_key',
            amr: ['password', 'desktop_handoff', 'device_binding'],
        };
        const {
            isolatedApp,
            issueTrustedDeviceChallenge,
            revokeBrowserSession,
        } = buildIsolatedSyncApp({ authSession, trustedDevices });

        const res = await request(isolatedApp)
            .get('/api/auth/session')
            .set('x-aura-device-id', authSession.deviceId);

        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('DESKTOP_HANDOFF_FRESH_SIGN_IN_REQUIRED');
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
        expect(revokeBrowserSession).toHaveBeenCalledWith(authSession.sessionId);
    });

    test('POST /api/auth/desktop-handoff/prepare returns the browser device checkpoint before handoff readiness', async () => {
        const {
            isolatedApp,
            inspectDesktopHandoffAssurance,
            issueTrustedDeviceChallenge,
        } = buildIsolatedSyncApp();

        const res = await request(isolatedApp)
            .post('/api/auth/desktop-handoff/prepare')
            .set('x-aura-device-id', 'aura_hosted_browser_device_1')
            .send({
                requestId: '123e4567-e89b-12d3-a456-426614174000',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            status: 'device_challenge_required',
            handoffReady: false,
            deviceChallenge: {
                deviceId: 'aura_hosted_browser_device_1',
            },
            mfaChallenge: null,
        });
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'aura_hosted_browser_device_1',
        }));
        expect(inspectDesktopHandoffAssurance).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync requires trusted-device proof before MFA when both gates apply', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge, refreshBrowserSession } = buildIsolatedSyncApp({
            challengeMode: 'always',
            mfaEnabled: true,
            userMfa: {
                enabled: true,
                defaultMethod: 'totp',
                totp: {
                    enabled: true,
                    confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
                },
            },
            recoveryCodeState: { activeCount: 2 },
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            status: 'device_challenge_required',
            requiresMfa: false,
            mfaChallenge: null,
        });
        expect(res.body.deviceChallenge).toBeTruthy();
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
        expect(refreshBrowserSession).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync can require trusted device challenge when policy is always', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge, refreshBrowserSession } = buildIsolatedSyncApp({ challengeMode: 'always' });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('device_challenge_required');
        expect(res.body.deviceChallenge).toEqual({
            token: expect.any(String),
            challenge: expect.any(String),
            mode: 'assert',
            deviceId: 'device-test-1234',
            audience: 'public',
            purpose: 'sign_in',
            surface: 'authentication',
            requiredAssurance: 'device_proof',
            blocking: true,
            exitMode: 'sign_out',
        });
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
        expect(refreshBrowserSession).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.body.session.sessionId).toBeUndefined();
    });

    test('POST /api/auth/sync labels an admin trusted-device challenge with admin assurance', async () => {
        const { isolatedApp, refreshBrowserSession } = buildIsolatedSyncApp({
            challengeMode: 'always',
            isAdmin: true,
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.deviceChallenge).toMatchObject({
            audience: 'admin',
            purpose: 'sign_in',
            surface: 'authentication',
            requiredAssurance: 'device_proof',
            nextAssurance: 'admin_passkey',
            blocking: true,
            exitMode: 'sign_out',
        });
        expect(refreshBrowserSession).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync does not treat a browser-key binding as MFA assurance', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp({
            challengeMode: 'always',
            authSession: {
                sessionId: 'session-1',
                deviceId: 'device-test-1234',
                deviceMethod: 'browser_key',
                amr: ['password', 'trusted_device'],
            },
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('device_challenge_required');
        expect(res.body.deviceChallenge).toBeTruthy();
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
    });

    test('POST /api/auth/sync keeps high login risk monitor-only by default', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp({ riskEngineMode: 'monitor' });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .set('x-aura-ip-reputation', 'denylist')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.deviceChallenge).toBeNull();
        expect(res.body.session.riskState).toBe('standard');
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync ignores unsigned high-risk headers when enforcement is staged on', async () => {
        const { isolatedApp, issueTrustedDeviceChallenge } = buildIsolatedSyncApp({ riskEngineMode: 'enforce' });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .set('x-aura-ip-reputation', 'denylist')
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.session.riskState).toBe('standard');
        expect(res.body.deviceChallenge).toBeNull();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();
    });

    test('POST /api/auth/sync requires step-up for signed high login risk when enforcement is staged on', async () => {
        const riskSignalSecret = buildRuntimeSecret('risk-signal-secret');
        const timestamp = new Date().toISOString();
        const signature = signLoginRiskSignals({
            method: 'POST',
            path: '/api/auth/sync',
            deviceId: 'device-test-1234',
            signals: { ipReputation: 'denylist' },
            timestamp,
            secret: riskSignalSecret,
        });
        const { isolatedApp, issueTrustedDeviceChallenge, refreshBrowserSession } = buildIsolatedSyncApp({
            riskEngineMode: 'enforce',
            riskSignalSecret,
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .set('x-aura-device-id', 'device-test-1234')
            .set('x-aura-ip-reputation', 'denylist')
            .set('x-aura-login-risk-timestamp', timestamp)
            .set('x-aura-login-risk-signature', signature)
            .send({ email: 'verified@example.com', name: 'Verified User' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('device_challenge_required');
        expect(res.body.deviceChallenge).toEqual({
            token: expect.any(String),
            challenge: expect.any(String),
            mode: 'assert',
            deviceId: 'device-test-1234',
            audience: 'public',
            purpose: 'sign_in',
            surface: 'authentication',
            requiredAssurance: 'device_proof',
            blocking: true,
            exitMode: 'sign_out',
        });
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
        expect(refreshBrowserSession).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.body.session.sessionId).toBeUndefined();
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
        tokenAuthTime = Math.floor(Date.now() / 1000) - 60,
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
                    auth_time: tokenAuthTime,
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

    test('POST /api/auth/complete-phone-factor-login rejects stale Firebase auth time', async () => {
        const isolatedApp = buildIsolatedPhoneFactorApp({
            tokenAuthTime: Math.floor(Date.now() / 1000) - (16 * 60),
        });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-login')
            .send({
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toContain('Fresh login is required');
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
    const originalOtpFlowSecret = process.env.OTP_FLOW_SECRET;

    afterEach(() => {
        process.env.OTP_FLOW_SECRET = originalOtpFlowSecret;
        jest.resetModules();
        jest.clearAllMocks();
    });

    const buildIsolatedPhoneFactorVerificationApp = ({
        purpose = 'signup',
        storedPhone = '+919876543210',
        tokenPhone = '+919876543210',
        tokenAuthTime = Math.floor(Date.now() / 1000) - 60,
        signupEmailOtpVerifiedAt = new Date().toISOString(),
        resetEmailOtpVerifiedAt = new Date().toISOString(),
        isVerified = false,
        userRecord,
        findOneAndUpdateResult,
        bootstrapSignal = { verified: false, deviceId: '', deviceSessionHash: '' },
        captureMocks = null,
    } = {}) => {
        let isolatedApp;

        jest.isolateModules(() => {
            const resolvedUserRecord = userRecord !== undefined
                ? userRecord
                : {
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
                };
            const resolvedUpdatedUser = findOneAndUpdateResult !== undefined
                ? findOneAndUpdateResult
                : {
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
                };
            const mockUserModel = {
                findOne: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue(resolvedUserRecord),
                    }),
                }),
                updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
                findOneAndUpdate: jest.fn().mockResolvedValue(resolvedUpdatedUser),
            };
            const mockOtpFlowGrantService = {
                registerOtpFlowGrant: jest.fn().mockResolvedValue(null),
                consumeOtpFlowGrant: jest.fn().mockResolvedValue(null),
            };
            jest.doMock('../models/User', () => mockUserModel);
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
            jest.doMock('../services/otpFlowGrantService', () => mockOtpFlowGrantService);
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceChallengePayload: jest.fn().mockReturnValue({}),
                extractTrustedDeviceContext: jest.fn().mockReturnValue({ deviceId: '', deviceLabel: '' }),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge: jest.fn().mockResolvedValue(null),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockResolvedValue(bootstrapSignal),
                verifyTrustedDeviceChallenge: jest.fn(),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
            }));
            if (captureMocks) {
                captureMocks({
                    User: mockUserModel,
                    otpFlowGrantService: mockOtpFlowGrantService,
                });
            }

            const express = require('express');
            const { completePhoneFactorVerification } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/complete-phone-factor-verification', (req, _res, next) => {
                req.authUid = 'uid-phone';
                req.authToken = {
                    phone_number: tokenPhone,
                    auth_time: tokenAuthTime,
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
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');
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
        expect(res.body.flowToken).toEqual(expect.any(String));
        expect(res.body.flowTokenExpiresAt).toEqual(expect.any(String));
    });

    test('POST /api/auth/complete-phone-factor-verification does not mark recovery verified before trusted-device proof', async () => {
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');
        let mocks;
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({
            purpose: 'forgot-password',
            isVerified: true,
            bootstrapSignal: {
                required: true,
                verified: false,
                deviceId: '',
                deviceSessionHash: '',
                method: '',
                reason: 'Fresh trusted device verification is required.',
            },
            captureMocks: (captured) => {
                mocks = captured;
            },
        });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'forgot-password',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('Fresh trusted device verification is required');
        expect(mocks.User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.otpFlowGrantService.registerOtpFlowGrant).not.toHaveBeenCalled();
    });

    test('POST /api/auth/complete-phone-factor-verification masks stale signup email OTP state', async () => {
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({ purpose: 'signup', signupEmailOtpVerifiedAt: null, isVerified: false });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'signup',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toBe(GENERIC_PHONE_FACTOR_VERIFICATION_MESSAGE);
    });

    test('POST /api/auth/complete-phone-factor-verification masks missing signup flow state', async () => {
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({ purpose: 'signup', userRecord: null });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'signup',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toBe(GENERIC_PHONE_FACTOR_VERIFICATION_MESSAGE);
    });

    test('POST /api/auth/complete-phone-factor-verification rejects stale signup Firebase auth time', async () => {
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({
            purpose: 'signup',
            isVerified: false,
            tokenAuthTime: Math.floor(Date.now() / 1000) - (16 * 60),
        });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'signup',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toContain('Fresh login is required');
    });

    test('POST /api/auth/complete-phone-factor-verification masks recovery phone mismatch', async () => {
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({
            purpose: 'forgot-password',
            isVerified: true,
            storedPhone: '+919811112222',
        });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'forgot-password',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toBe(GENERIC_PHONE_FACTOR_VERIFICATION_MESSAGE);
    });

    test('POST /api/auth/complete-phone-factor-verification rejects stale recovery Firebase auth time', async () => {
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');
        const isolatedApp = buildIsolatedPhoneFactorVerificationApp({
            purpose: 'forgot-password',
            isVerified: true,
            tokenAuthTime: Math.floor(Date.now() / 1000) - (16 * 60),
        });

        const res = await request(isolatedApp)
            .post('/api/auth/complete-phone-factor-verification')
            .send({
                purpose: 'forgot-password',
                email: 'verified@example.com',
                phone: '+919876543210',
            });

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toContain('Fresh login is required');
    });
});

describe('Trusted device verification response payload', () => {
    const originalMfaEnabled = process.env.MFA_ENABLED;
    const originalMfaTotpEnabled = process.env.MFA_TOTP_ENABLED;
    const originalMfaPasskeyEnabled = process.env.MFA_PASSKEY_ENABLED;
    const originalMfaRecoveryCodesEnabled = process.env.MFA_RECOVERY_CODES_ENABLED;
    const originalMfaSecretEncryptionKey = process.env.MFA_SECRET_ENCRYPTION_KEY;

    afterEach(() => {
        for (const [key, value] of [
            ['MFA_ENABLED', originalMfaEnabled],
            ['MFA_TOTP_ENABLED', originalMfaTotpEnabled],
            ['MFA_PASSKEY_ENABLED', originalMfaPasskeyEnabled],
            ['MFA_RECOVERY_CODES_ENABLED', originalMfaRecoveryCodesEnabled],
            ['MFA_SECRET_ENCRYPTION_KEY', originalMfaSecretEncryptionKey],
        ]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        jest.resetModules();
        jest.clearAllMocks();
    });

    const buildDesktopHandoffTargetVerifyApp = ({
        includeHandoffClaim = true,
        sourceAssurance = true,
    } = {}) => {
        let isolatedApp;
        const requestId = '123e4567-e89b-42d3-a456-426614174007';
        const sourceDeviceId = 'hosted_admin_passkey_source_123';
        const targetDeviceId = 'aura_desktop_target_bridge_456';
        const sourceDeviceSessionToken = buildRuntimeSecret('source-device-session');
        const targetDeviceSessionToken = buildRuntimeSecret('target-device-session');
        const sourceStepUpUntil = new Date(Date.now() + 5 * 60_000).toISOString();
        const targetDevice = {
            deviceId: targetDeviceId,
            label: 'Aura Desktop',
            method: 'browser_key',
            credentialScope: 'recognition',
            adminEligibility: 'none',
        };
        const adminUser = {
            _id: 'admin-desktop-handoff-1',
            email: 'admin-handoff@example.com',
            name: 'Admin Handoff',
            isAdmin: true,
            isVerified: true,
            authAssurance: 'password+otp',
            loginOtpAssuranceExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            mfa: {
                enabled: true,
                defaultMethod: 'passkey',
                passkeys: [{ credentialId: 'source-admin-passkey-credential' }],
            },
            trustedDevices: [{
                deviceId: sourceDeviceId,
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'source-admin-passkey-credential',
                webauthnUserVerified: true,
                credentialScope: 'admin',
                adminEligibility: 'verified',
            }],
        };
        const refreshBrowserSession = jest.fn().mockImplementation(async ({
            deviceMethod = '',
            stepUpUntil = null,
            webAuthnStepUpUntil = null,
            additionalAmr = [],
            riskState = '',
        } = {}) => ({
            sessionId: 'desktop-target-session-1',
            firebaseUid: 'uid-admin-handoff',
            email: adminUser.email,
            emailVerified: true,
            displayName: adminUser.name,
            providerIds: ['password'],
            deviceId: targetDeviceId,
            deviceMethod,
            aal: additionalAmr.some((entry) => String(entry).startsWith('desktop_handoff_admin_mfa:'))
                ? 'aal2'
                : 'aal1',
            amr: ['password', ...additionalAmr],
            stepUpUntil: stepUpUntil ? new Date(stepUpUntil).toISOString() : null,
            webAuthnStepUpUntil: webAuthnStepUpUntil
                ? new Date(webAuthnStepUpUntil).toISOString()
                : null,
            riskState,
        }));
        const revokeBrowserSession = jest.fn().mockResolvedValue(undefined);
        const verifyTrustedDeviceChallenge = jest.fn().mockResolvedValue({
            success: true,
            mode: 'enroll',
            method: 'browser_key',
            trustedDevice: targetDevice,
            deviceSessionToken: targetDeviceSessionToken,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
            desktopHandoffBootstrap: {
                requestId,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                loginMfaSatisfied: true,
                adminPasskeySatisfied: true,
            },
        });

        jest.isolateModules(() => {
            process.env.MFA_ENABLED = 'true';
            process.env.MFA_TOTP_ENABLED = 'false';
            process.env.MFA_PASSKEY_ENABLED = 'true';
            process.env.MFA_RECOVERY_CODES_ENABLED = 'false';
            process.env.MFA_SECRET_ENCRYPTION_KEY = 'test-mfa-secret-encryption-key-32-characters-plus';

            jest.doMock('../services/authSessionService', () => ({
                buildSessionPayload: jest.fn(({
                    status,
                    authSession,
                    deviceChallenge,
                    mfaChallenge,
                    mfaPolicy,
                } = {}) => ({
                    status,
                    deviceChallenge: deviceChallenge || null,
                    mfaChallenge: mfaChallenge || null,
                    mfaPolicy: mfaPolicy || null,
                    session: authSession || {},
                    profile: adminUser,
                    roles: { isAdmin: true, isSeller: false, isVerified: true },
                    intelligence: null,
                })),
                persistAuthSnapshot: jest.fn().mockResolvedValue(undefined),
                resolveAuthenticatedSession: jest.fn(),
                syncAuthenticatedUser: jest.fn(),
                applyLoginAssuranceToSession: jest.fn(),
            }));
            jest.doMock('../middleware/authMiddleware', () => ({
                invalidateUserCache: jest.fn().mockResolvedValue(undefined),
                invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
            }));
            jest.doMock('../services/browserSessionService', () => ({
                SESSION_STEP_UP_TTL_MS: 10 * 60 * 1000,
                clearBrowserSessionCookie: jest.fn(),
                getBrowserSessionFromRequest: jest.fn(),
                refreshBrowserSession,
                revokeBrowserSession,
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: targetDeviceId,
                    deviceLabel: 'Aura Desktop',
                }),
                getTrustedDeviceRegistration: jest.fn(),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge: jest.fn(),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({ verified: false, deviceId: '', deviceSessionHash: '' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
                verifyTrustedDeviceChallenge,
            }));

            const express = require('express');
            const { verifyDeviceChallenge } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/verify-device', (req, _res, next) => {
                req.user = adminUser;
                req.authUid = 'uid-admin-handoff';
                req.authToken = {
                    email: adminUser.email,
                    email_verified: true,
                    ...(includeHandoffClaim ? {
                        desktop_handoff: true,
                        desktop_request_id: requestId,
                    } : {}),
                };
                req.authSession = {
                    sessionId: 'hosted-source-session-1',
                    deviceId: sourceDeviceId,
                    deviceMethod: 'webauthn',
                    aal: sourceAssurance ? 'aal3' : 'aal1',
                    amr: sourceAssurance
                        ? ['password', 'webauthn', 'passkey', 'totp', 'mfa']
                        : ['password'],
                    deviceSessionToken: sourceDeviceSessionToken,
                    stepUpUntil: sourceAssurance ? sourceStepUpUntil : null,
                    webAuthnStepUpUntil: sourceAssurance ? sourceStepUpUntil : null,
                };
                next();
            }, verifyDeviceChallenge);
            isolatedApp.use(errorHandler);
        });

        return {
            adminUser,
            isolatedApp,
            refreshBrowserSession,
            requestId,
            revokeBrowserSession,
            sourceDeviceId,
            sourceDeviceSessionToken,
            sourceStepUpUntil,
            targetDeviceId,
            targetDeviceSessionToken,
            verifyTrustedDeviceChallenge,
        };
    };

    test('POST /api/auth/verify-device derives only target-bound admin login MFA from a sealed handoff proof', async () => {
        const {
            isolatedApp,
            refreshBrowserSession,
            revokeBrowserSession,
            sourceDeviceId,
            sourceDeviceSessionToken,
            sourceStepUpUntil,
            targetDeviceId,
            targetDeviceSessionToken,
            verifyTrustedDeviceChallenge,
        } = buildDesktopHandoffTargetVerifyApp();
        const { buildDesktopHandoffMfaMarker } = require('../services/mfaPolicyService');
        const adminMarker = buildDesktopHandoffMfaMarker(targetDeviceId, { admin: true });

        const res = await request(isolatedApp)
            .post('/api/auth/verify-device')
            .send({
                token: buildRuntimeSecret('target-challenge'),
                method: 'browser_key',
                proof: buildRuntimeSecret('target-proof'),
                desktopHandoffTarget: true,
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            status: 'authenticated',
            deviceSessionToken: targetDeviceSessionToken,
            session: {
                sessionId: 'desktop-target-session-1',
                deviceId: targetDeviceId,
                deviceMethod: 'browser_key',
                aal: 'aal2',
                amr: ['password', 'desktop_handoff', 'device_binding', 'mfa', adminMarker],
                stepUpUntil: new Date(0).toISOString(),
                webAuthnStepUpUntil: new Date(0).toISOString(),
            },
        });
        expect(res.body).not.toHaveProperty('desktopHandoffBootstrap');
        expect(res.body.deviceSessionToken).not.toBe(sourceDeviceSessionToken);
        expect(res.body.session.deviceId).not.toBe(sourceDeviceId);
        expect(res.body.session.amr).not.toEqual(expect.arrayContaining(['webauthn', 'passkey', 'totp']));
        expect(res.body.session.aal).not.toBe('aal3');
        expect(res.body.session.stepUpUntil).not.toBe(sourceStepUpUntil);
        expect(res.body.session.webAuthnStepUpUntil).not.toBe(sourceStepUpUntil);
        expect(verifyTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            expectedScope: 'desktop_handoff_target',
            deviceId: targetDeviceId,
        }));
        expect(refreshBrowserSession).toHaveBeenCalledWith(expect.objectContaining({
            currentSession: null,
            rotate: false,
            deviceMethod: 'browser_key',
            additionalAmr: ['desktop_handoff', 'device_binding', 'mfa', adminMarker],
            user: expect.objectContaining({
                authAssurance: '',
                loginOtpAssuranceExpiresAt: null,
            }),
        }));
        const refreshCall = refreshBrowserSession.mock.calls[0][0];
        expect(new Date(refreshCall.stepUpUntil).getTime()).toBe(0);
        expect(new Date(refreshCall.webAuthnStepUpUntil).getTime()).toBe(0);
        expect(revokeBrowserSession).toHaveBeenCalledWith('hosted-source-session-1');
    });

    test('POST /api/auth/verify-device rejects a body-only desktop target marker without a handoff claim', async () => {
        const {
            isolatedApp,
            refreshBrowserSession,
            verifyTrustedDeviceChallenge,
        } = buildDesktopHandoffTargetVerifyApp({ includeHandoffClaim: false });

        const res = await request(isolatedApp)
            .post('/api/auth/verify-device')
            .send({
                token: buildRuntimeSecret('body-only-target-challenge'),
                method: 'browser_key',
                proof: buildRuntimeSecret('body-only-target-proof'),
                desktopHandoffTarget: true,
            });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toMatch(/target proof is not authorized/i);
        expect(verifyTrustedDeviceChallenge).not.toHaveBeenCalled();
        expect(refreshBrowserSession).not.toHaveBeenCalled();
    });

    test('POST /api/auth/verify-device cannot derive target MFA from a generic-scope verification', async () => {
        const {
            isolatedApp,
            refreshBrowserSession,
            targetDeviceId,
            verifyTrustedDeviceChallenge,
        } = buildDesktopHandoffTargetVerifyApp({ sourceAssurance: false });

        const res = await request(isolatedApp)
            .post('/api/auth/verify-device')
            .send({
                token: buildRuntimeSecret('generic-challenge'),
                method: 'browser_key',
                proof: buildRuntimeSecret('generic-proof'),
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('mfa_challenge_required');
        expect(res.body).not.toHaveProperty('desktopHandoffBootstrap');
        expect(verifyTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            expectedScope: '',
            deviceId: targetDeviceId,
        }));
        expect(refreshBrowserSession).not.toHaveBeenCalled();
    });

    test('POST /api/auth/verify-device returns an authenticated session payload after successful verification', async () => {
        let isolatedApp;
        const verifiedDeviceSessionToken = buildRuntimeSecret('session-ref');
        const challengeToken = buildRuntimeSecret('challenge-ref');
        const challengeProof = buildRuntimeSecret('sig-ref');
        const refreshBrowserSession = jest.fn().mockResolvedValue({
            sessionId: 'verified-session-1',
            firebaseUid: 'uid-verified',
            deviceId: 'device-test-1234',
            deviceMethod: 'browser_key',
            amr: ['password', 'trusted_device'],
        });

        jest.isolateModules(() => {
            jest.doMock('../services/authSessionService', () => ({
                buildSessionPayload: jest.fn().mockReturnValue({
                    status: 'authenticated',
                    deviceChallenge: null,
                    session: {
                        sessionId: 'verified-session-1',
                        uid: 'uid-verified',
                        email: 'verified@example.com',
                        emailVerified: true,
                        displayName: 'Verified User',
                        phone: '+919876543210',
                        providerIds: ['password'],
                    },
                    profile: {
                        _id: 'user-1',
                        name: 'Verified User',
                        email: 'verified@example.com',
                        phone: '+919876543210',
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
                    intelligence: null,
                }),
                persistAuthSnapshot: jest.fn().mockResolvedValue(undefined),
                resolveAuthenticatedSession: jest.fn(),
                syncAuthenticatedUser: jest.fn(),
                applyLoginAssuranceToSession: jest.fn(),
            }));
            jest.doMock('../middleware/authMiddleware', () => ({
                invalidateUserCache: jest.fn().mockResolvedValue(undefined),
                invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
            }));
            jest.doMock('../services/browserSessionService', () => ({
                clearBrowserSessionCookie: jest.fn(),
                getBrowserSessionFromRequest: jest.fn(),
                refreshBrowserSession,
                revokeBrowserSession: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-test-1234',
                    deviceLabel: 'Verified Browser',
                }),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge: jest.fn(),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({ verified: false, deviceId: '', deviceSessionHash: '' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
                verifyTrustedDeviceChallenge: jest.fn().mockResolvedValue({
                    success: true,
                    mode: 'assert',
                    method: 'browser_key',
                    deviceSessionToken: verifiedDeviceSessionToken,
                    expiresAt: new Date('2026-04-12T14:00:00.000Z').toISOString(),
                }),
            }));

            const express = require('express');
            const { verifyDeviceChallenge } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/verify-device', (req, _res, next) => {
                req.user = {
                    _id: 'user-1',
                    email: 'verified@example.com',
                    name: 'Verified User',
                    phone: '+919876543210',
                    isVerified: true,
                };
                req.authUid = 'uid-verified';
                req.authToken = {
                    email: 'verified@example.com',
                    email_verified: true,
                };
                req.authSession = {
                    sessionId: 'bootstrap-session-1',
                };
                next();
            }, verifyDeviceChallenge);
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp)
            .post('/api/auth/verify-device')
            .send({
                token: challengeToken,
                method: 'browser_key',
                proof: challengeProof,
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status).toBe('authenticated');
        expect(res.body.deviceChallenge).toBeNull();
        expect(res.body.session).toMatchObject({
            sessionId: 'verified-session-1',
            email: 'verified@example.com',
        });
        expect(refreshBrowserSession).toHaveBeenCalledTimes(1);
    });

    test('POST /api/auth/verify-device advances to MFA instead of authenticating early', async () => {
        let isolatedApp;
        const verifiedDeviceSessionToken = buildRuntimeSecret('session-mfa-ref');
        const challengeToken = buildRuntimeSecret('challenge-mfa-ref');
        const challengeProof = buildRuntimeSecret('sig-mfa-ref');
        const refreshBrowserSession = jest.fn().mockResolvedValue({
            sessionId: 'verified-session-mfa-1',
            firebaseUid: 'uid-verified',
            deviceId: 'device-test-1234',
            deviceMethod: 'browser_key',
            amr: ['password', 'device_binding'],
        });

        jest.isolateModules(() => {
            process.env.MFA_ENABLED = 'true';
            process.env.MFA_TOTP_ENABLED = 'true';
            process.env.MFA_PASSKEY_ENABLED = 'false';
            process.env.MFA_RECOVERY_CODES_ENABLED = 'true';
            process.env.MFA_SECRET_ENCRYPTION_KEY = 'test-mfa-secret-encryption-key-32-characters-plus';

            jest.doMock('../services/authSessionService', () => ({
                buildSessionPayload: jest.fn(({
                    status,
                    authSession,
                    deviceChallenge,
                    mfaChallenge,
                    mfaPolicy,
                } = {}) => ({
                    status,
                    deviceChallenge: deviceChallenge || null,
                    mfaChallenge: mfaChallenge || null,
                    requiresMfa: Boolean(mfaChallenge),
                    mfaPolicy: mfaPolicy || null,
                    session: {
                        ...(authSession?.sessionId ? { sessionId: authSession.sessionId } : {}),
                        uid: 'uid-verified',
                        email: 'verified@example.com',
                        emailVerified: true,
                        displayName: 'Verified User',
                        phone: '+919876543210',
                        providerIds: ['password'],
                    },
                    profile: {
                        _id: 'user-1',
                        name: 'Verified User',
                        email: 'verified@example.com',
                        isAdmin: false,
                        isVerified: true,
                    },
                    roles: { isAdmin: false, isSeller: false, isVerified: true },
                    intelligence: null,
                })),
                persistAuthSnapshot: jest.fn().mockResolvedValue(undefined),
                resolveAuthenticatedSession: jest.fn(),
                syncAuthenticatedUser: jest.fn(),
                applyLoginAssuranceToSession: jest.fn(),
            }));
            jest.doMock('../middleware/authMiddleware', () => ({
                invalidateUserCache: jest.fn().mockResolvedValue(undefined),
                invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
            }));
            jest.doMock('../services/browserSessionService', () => ({
                SESSION_STEP_UP_TTL_MS: 10 * 60 * 1000,
                clearBrowserSessionCookie: jest.fn(),
                getBrowserSessionFromRequest: jest.fn(),
                refreshBrowserSession,
                revokeBrowserSession: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-test-1234',
                    deviceLabel: 'Verified Browser',
                }),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge: jest.fn(),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({ verified: false, deviceId: '', deviceSessionHash: '' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
                verifyTrustedDeviceChallenge: jest.fn().mockResolvedValue({
                    success: true,
                    mode: 'assert',
                    method: 'browser_key',
                    postDeviceMfaRequired: true,
                    postDeviceMfaReason: 'login_risk_high',
                    deviceSessionToken: verifiedDeviceSessionToken,
                    expiresAt: new Date('2026-04-12T14:00:00.000Z').toISOString(),
                }),
            }));

            const express = require('express');
            const { verifyDeviceChallenge } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/verify-device', (req, _res, next) => {
                req.user = {
                    _id: 'user-1',
                    email: 'verified@example.com',
                    name: 'Verified User',
                    isVerified: true,
                    mfa: {
                        enabled: true,
                        defaultMethod: 'totp',
                        totp: {
                            enabled: true,
                            confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
                        },
                    },
                    recoveryCodeState: { activeCount: 2 },
                };
                req.authUid = 'uid-verified';
                req.authToken = { email: 'verified@example.com', email_verified: true };
                req.authSession = { sessionId: 'bootstrap-session-mfa-1', amr: ['password'] };
                next();
            }, verifyDeviceChallenge);
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp)
            .post('/api/auth/verify-device')
            .send({
                token: challengeToken,
                method: 'browser_key',
                proof: challengeProof,
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            status: 'mfa_challenge_required',
            requiresMfa: true,
            deviceChallenge: null,
            mfaChallenge: {
                purpose: 'login',
                allowedMethods: ['totp', 'recovery_code'],
                preferredMethod: 'totp',
                audience: 'public',
                surface: 'authentication',
                presentationPurpose: 'sign_in',
                blocking: true,
                requiredAssurance: 'mfa',
            },
            mfaPolicy: {
                mfaRequired: true,
                reason: 'suspicious_login',
                audience: 'public',
                surface: 'authentication',
                presentationPurpose: 'sign_in',
                blocking: true,
                requiredAssurance: 'mfa',
            },
            deviceSessionToken: verifiedDeviceSessionToken,
            mfaBlocked: false,
            mfaError: null,
        });
        expect(res.body.session.sessionId).toBeUndefined();
        expect(refreshBrowserSession).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
    });

    test('POST /api/auth/verify-device preserves the device token when admin MFA has no available method', async () => {
        let isolatedApp;
        const verifiedDeviceSessionToken = buildRuntimeSecret('session-admin-blocked-ref');
        const refreshBrowserSession = jest.fn();

        jest.isolateModules(() => {
            jest.doMock('../services/authSessionService', () => ({
                buildSessionPayload: jest.fn(({
                    status,
                    authSession,
                    mfaChallenge,
                    mfaPolicy,
                } = {}) => ({
                    status,
                    deviceChallenge: null,
                    mfaChallenge: mfaChallenge || null,
                    requiresMfa: Boolean(mfaChallenge),
                    mfaPolicy: mfaPolicy || null,
                    session: authSession?.sessionId
                        ? { sessionId: authSession.sessionId, email: 'admin@example.com' }
                        : { email: 'admin@example.com' },
                    profile: {
                        _id: 'admin-1',
                        email: 'admin@example.com',
                        isAdmin: true,
                        isVerified: true,
                    },
                    roles: { isAdmin: true, isSeller: false, isVerified: true },
                    intelligence: null,
                })),
                persistAuthSnapshot: jest.fn().mockResolvedValue(undefined),
                resolveAuthenticatedSession: jest.fn(),
                syncAuthenticatedUser: jest.fn(),
                applyLoginAssuranceToSession: jest.fn(),
            }));
            jest.doMock('../middleware/authMiddleware', () => ({
                invalidateUserCache: jest.fn().mockResolvedValue(undefined),
                invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
            }));
            jest.doMock('../services/browserSessionService', () => ({
                SESSION_STEP_UP_TTL_MS: 10 * 60 * 1000,
                clearBrowserSessionCookie: jest.fn(),
                getBrowserSessionFromRequest: jest.fn(),
                refreshBrowserSession,
                revokeBrowserSession: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: 'device-admin-1234',
                    deviceLabel: 'Admin Browser',
                }),
                getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
                issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
                issueTrustedDeviceChallenge: jest.fn(),
                resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({ verified: false, deviceId: '', deviceSessionHash: '' }),
                verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
                verifyTrustedDeviceChallenge: jest.fn().mockResolvedValue({
                    success: true,
                    mode: 'assert',
                    method: 'browser_key',
                    deviceSessionToken: verifiedDeviceSessionToken,
                    expiresAt: new Date('2026-04-12T14:00:00.000Z').toISOString(),
                }),
            }));
            jest.doMock('../services/mfaPolicyService', () => {
                const actual = jest.requireActual('../services/mfaPolicyService');
                return {
                    ...actual,
                    evaluateLogin: jest.fn().mockReturnValue({
                        mfaRequired: true,
                        freshMfaRequired: false,
                        allowedMethods: [],
                        preferredMethod: null,
                        reason: 'admin_policy',
                        block: true,
                        role: 'admin',
                    }),
                };
            });

            const express = require('express');
            const { verifyDeviceChallenge } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/verify-device', (req, _res, next) => {
                req.user = {
                    _id: 'admin-1',
                    email: 'admin@example.com',
                    name: 'Admin User',
                    isAdmin: true,
                    isVerified: true,
                };
                req.authUid = 'uid-admin';
                req.authToken = { email: 'admin@example.com', email_verified: true };
                req.authSession = null;
                next();
            }, verifyDeviceChallenge);
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp)
            .post('/api/auth/verify-device')
            .send({
                token: buildRuntimeSecret('challenge-admin-blocked-ref'),
                method: 'browser_key',
                proof: buildRuntimeSecret('sig-admin-blocked-ref'),
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            status: 'mfa_challenge_required',
            requiresMfa: true,
            mfaBlocked: true,
            mfaChallenge: null,
            mfaPolicy: {
                mfaRequired: true,
                allowedMethods: [],
                reason: 'admin_policy',
                block: true,
                audience: 'admin',
                surface: 'authentication',
                presentationPurpose: 'sign_in',
                blocking: true,
                requiredAssurance: 'mfa',
                nextAssurance: 'admin_passkey',
            },
            mfaError: {
                code: 'MFA_METHOD_REQUIRED',
                message: 'MFA is required but no allowed verification method is available.',
            },
            deviceSessionToken: verifiedDeviceSessionToken,
        });
        expect(res.body.session.sessionId).toBeUndefined();
        expect(refreshBrowserSession).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
    });
});
