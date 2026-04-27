const crypto = require('crypto');
const EventEmitter = require('events');
const express = require('express');
const request = require('supertest');

const app = require('../index');
const User = require('../models/User');
const { generateRecoveryCodesForUser } = require('../services/authRecoveryCodeService');

const buildRuntimeValue = (label = 'attack') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const buildStrongPassword = () => String.fromCharCode(79, 114, 99, 104, 105, 100, 33, 56, 118, 82, 50, 80);
const buildPhone = () => `+91${String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0')}`;

const createRsaProof = ({ challenge, mode, deviceId, privateKeyPem }) => {
    const message = Buffer.from(`aura-device-proof|${mode}|${deviceId}|${challenge}`, 'utf8');
    return crypto.sign(
        'sha256',
        message,
        {
            key: privateKeyPem,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32,
        }
    ).toString('base64');
};

const buildCsrfAttackApp = () => {
    const mockCsrfRedisStore = new Map();
    let isolatedApp;

    jest.isolateModules(() => {
        jest.doMock('../middleware/authMiddleware', () => ({
            protect: (req, _res, next) => {
                const authHeader = req.headers.authorization || '';
                const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

                if (token === 'token-user-a') {
                    req.authUid = 'uid-user-a';
                    req.authToken = { email: 'user-a@example.com' };
                    req.user = { id: 'uid-user-a', email: 'user-a@example.com' };
                    return next();
                }

                return next({ statusCode: 401, message: 'Unauthorized' });
            },
            protectPhoneFactorProof: (_req, _res, next) => next(),
            protectOptional: (req, _res, next) => {
                const cookie = String(req.headers.cookie || '');
                if (cookie.includes('aura_sid=session-cookie-a')) {
                    req.authUid = 'uid-user-a';
                    req.authToken = { email: 'user-a@example.com' };
                    req.user = { id: 'uid-user-a', email: 'user-a@example.com' };
                    req.authSession = { sessionId: 'session-cookie-a' };
                }
                next();
            },
        }));

        jest.doMock('../config/redis', () => ({
            getRedisClient: () => ({
                setEx: async (key, ttl, value) => {
                    mockCsrfRedisStore.set(key, { value, expiresAt: Date.now() + (ttl * 1000) });
                    return 'OK';
                },
                get: async (key) => {
                    const record = mockCsrfRedisStore.get(key);
                    if (!record) return null;
                    if (record.expiresAt < Date.now()) {
                        mockCsrfRedisStore.delete(key);
                        return null;
                    }
                    return record.value;
                },
                del: async (key) => {
                    mockCsrfRedisStore.delete(key);
                    return 1;
                },
            }),
            flags: { redisPrefix: 'login-attack-smoke' },
        }));

        jest.doMock('../middleware/distributedRateLimit', () => ({
            createDistributedRateLimit: () => (_req, _res, next) => next(),
        }));

        jest.doMock('../routes/otpRoutes', () => express.Router());

        jest.doMock('../controllers/authController', () => ({
            establishSessionCookie: (req, _res, next) => {
                if ((req.headers.authorization || '').startsWith('Bearer ')) {
                    req.authSession = { sessionId: 'session-cookie-a' };
                }
                next();
            },
            getSession: (_req, res) => res.json({ ok: true }),
            syncSession: (_req, res) => res.json({ synced: true }),
            generateBackupRecoveryCodes: (_req, res) => res.status(201).json({ success: true, recoveryCodes: [] }),
            verifyBackupRecoveryCode: (_req, res) => res.json({ success: true }),
            logoutSession: (_req, res) => res.json({ success: true }),
            completePhoneFactorLogin: (_req, res) => res.json({ completed: true }),
            completePhoneFactorVerification: (_req, res) => res.json({ completed: true }),
            requestBootstrapDeviceChallenge: (_req, res) => res.json({ success: true, deviceChallenge: null }),
            verifyDeviceChallenge: (_req, res) => res.json({ ok: true }),
        }));

        const authRoutes = require('../routes/authRoutes');

        isolatedApp = express();
        isolatedApp.use(express.json());
        isolatedApp.use('/api/auth', authRoutes);
        isolatedApp.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
        });
    });

    return isolatedApp;
};

describe('login attack smoke: route-level browser attacks', () => {
    afterEach(() => {
        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../config/redis');
        jest.dontMock('../middleware/distributedRateLimit');
        jest.dontMock('../routes/otpRoutes');
        jest.dontMock('../controllers/authController');
    });

    test('blocks cookie-session logout CSRF and accepts the same request with a fresh CSRF token', async () => {
        const attackApp = buildCsrfAttackApp();

        const missingToken = await request(attackApp)
            .post('/api/auth/logout')
            .set('Cookie', 'aura_sid=session-cookie-a')
            .set('Sec-Fetch-Site', 'cross-site')
            .set('User-Agent', 'login-attack-smoke')
            .set('Host', 'localhost:3000')
            .send({});

        expect(missingToken.statusCode).toBe(403);
        expect(missingToken.body.code).toBe('CSRF_TOKEN_MISSING');

        const sessionRes = await request(attackApp)
            .get('/api/auth/session')
            .set('Authorization', 'Bearer token-user-a')
            .set('User-Agent', 'login-attack-smoke')
            .set('Host', 'localhost:3000');

        const csrfToken = sessionRes.headers['x-csrf-token'];
        expect(csrfToken).toEqual(expect.any(String));

        const validLogout = await request(attackApp)
            .post('/api/auth/logout')
            .set('Cookie', 'aura_sid=session-cookie-a')
            .set('X-CSRF-Token', csrfToken)
            .set('User-Agent', 'login-attack-smoke')
            .set('Host', 'localhost:3000')
            .send({});

        expect(validLogout.statusCode).toBe(200);
        expect(validLogout.body.success).toBe(true);
    });
});

describe('login attack smoke: recovery-token attacks', () => {
    test('rejects recovery-code replay and reset flow token use from a different device', async () => {
        const user = await User.create({
            name: 'Attack Recovery User',
            email: `${buildRuntimeValue('attack-recovery')}@test.com`,
            phone: buildPhone(),
            isVerified: true,
            trustedDevices: [{
                deviceId: buildRuntimeValue('passkey-device'),
                label: 'Passkey',
                method: 'webauthn',
                publicKeySpkiBase64: Buffer.from(buildRuntimeValue('spki')).toString('base64'),
                webauthnCredentialIdBase64Url: buildRuntimeValue('credential'),
            }],
        });
        const { codes } = await generateRecoveryCodesForUser({ userId: user._id });

        const verified = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', 'attack-device-a')
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(verified.statusCode).toBe(200);
        expect(verified.body.flowToken).toEqual(expect.any(String));

        const replay = await request(app)
            .post('/api/auth/recovery-codes/verify')
            .set('X-Aura-Device-Id', 'attack-device-a')
            .send({
                email: user.email,
                code: codes[0],
            });

        expect(replay.statusCode).toBe(401);
        expect(replay.body.message).toContain('invalid or already used');

        const nextPassword = buildStrongPassword('wrong-device-reset');
        const wrongDeviceReset = await request(app)
            .post('/api/otp/reset-password')
            .set('X-Aura-Device-Id', 'attack-device-b')
            .send({
                flowToken: verified.body.flowToken,
                password: nextPassword,
            });

        expect(wrongDeviceReset.statusCode).toBe(403);
        expect(wrongDeviceReset.body.message).toMatch(/device.*mismatch/i);
    });
});

describe('login attack smoke: session middleware attacks', () => {
    afterEach(() => {
        jest.dontMock('../config/firebase');
        jest.dontMock('../models/User');
        jest.dontMock('../config/redis');
        jest.dontMock('../services/browserSessionService');
        jest.dontMock('../services/trustedDeviceChallengeService');
        jest.dontMock('../config/authTrustedDeviceFlags');
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('does not refresh cookie-session idle TTL from cross-site navigation', async () => {
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
            touchBrowserSession = jest.fn().mockResolvedValue(sessionRecord);

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

        const makeReq = (headers = {}) => ({
            headers: {
                cookie: 'aura_sid=session-cookie-touch',
                ...headers,
            },
            get: () => '',
        });

        const sameSiteRes = new EventEmitter();
        sameSiteRes.statusCode = 200;
        await protect(makeReq(), sameSiteRes, jest.fn());
        sameSiteRes.emit('finish');
        await new Promise((resolve) => setImmediate(resolve));
        expect(touchBrowserSession).toHaveBeenCalledTimes(1);

        const crossSiteRes = new EventEmitter();
        crossSiteRes.statusCode = 200;
        await protect(makeReq({ 'sec-fetch-site': 'cross-site' }), crossSiteRes, jest.fn());
        crossSiteRes.emit('finish');
        await new Promise((resolve) => setImmediate(resolve));

        expect(touchBrowserSession).toHaveBeenCalledTimes(1);
    });

    test('prefers fresh bearer auth over a stale cookie and records the superseded session', async () => {
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
            getBrowserSessionFromRequest = jest.fn();

            jest.doMock('../config/firebase', () => ({
                auth: () => ({
                    verifyIdToken,
                    getUser: jest.fn(),
                }),
            }));
            jest.doMock('../models/User', () => ({
                findById: jest.fn(),
                find: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue([{
                        _id: '507f1f77bcf86cd799439012',
                        authUid: 'firebase-bearer-uid',
                        email: 'bearer-user@example.com',
                        name: 'Bearer User',
                        phone: '+919811112222',
                        trustedDevices: [{
                            deviceId: 'device-bearer-1',
                            label: 'Bearer Browser',
                            method: 'browser_key',
                            publicKeySpkiBase64: 'public-key',
                        }],
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
                    }]),
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
        expect(getBrowserSessionFromRequest).not.toHaveBeenCalled();
        expect(req.supersededAuthSessionId).toBe('session-cookie-stale');
        expect(req.authUid).toBe('firebase-bearer-uid');
        expect(req.user).toMatchObject({
            email: 'bearer-user@example.com',
            name: 'Bearer User',
        });
    });
});

describe('login attack smoke: trusted-device replay attacks', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('rejects browser-key trusted-device challenge replay', async () => {
        let service;
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439111';
        const deviceId = 'device_replay_123456';
        const authContext = {
            authUid: 'firebase-uid-replay',
            authToken: { iat: 1710000001 },
        };

        jest.isolateModules(() => {
            jest.dontMock('../services/trustedDeviceChallengeService');
            jest.doMock('../models/User', () => ({
                findById: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue({
                        _id: userId,
                        trustedDevices: dbState.trustedDevices,
                    }),
                }),
                updateOne: jest.fn().mockImplementation(async (_filter, update) => {
                    dbState.trustedDevices = update.$set.trustedDevices;
                    return { acknowledged: true, modifiedCount: 1 };
                }),
            }));

            service = require('../services/trustedDeviceChallengeService');
        });

        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { format: 'der', type: 'spki' },
            privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
        });
        const publicKeySpkiBase64 = Buffer.from(publicKey).toString('base64');

        const enrollChallenge = await service.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            deviceId,
            deviceLabel: 'Replay laptop',
            ...authContext,
        });

        const enrollResult = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            token: enrollChallenge.token,
            proof: createRsaProof({
                challenge: enrollChallenge.challenge,
                mode: enrollChallenge.mode,
                deviceId,
                privateKeyPem: privateKey,
            }),
            publicKeySpkiBase64,
            deviceId,
            deviceLabel: 'Replay laptop',
            ...authContext,
        });

        expect(enrollResult.success).toBe(true);

        const assertChallenge = await service.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            deviceId,
            deviceLabel: 'Replay laptop',
            ...authContext,
        });
        const proof = createRsaProof({
            challenge: assertChallenge.challenge,
            mode: assertChallenge.mode,
            deviceId,
            privateKeyPem: privateKey,
        });

        const firstVerification = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            token: assertChallenge.token,
            proof,
            deviceId,
            deviceLabel: 'Replay laptop',
            ...authContext,
        });
        const replayVerification = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            token: assertChallenge.token,
            proof,
            deviceId,
            deviceLabel: 'Replay laptop',
            ...authContext,
        });

        expect(firstVerification.success).toBe(true);
        expect(replayVerification).toEqual({
            success: false,
            reason: 'Device challenge already used',
        });
    });
});
