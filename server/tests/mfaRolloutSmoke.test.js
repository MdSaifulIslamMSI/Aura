const express = require('express');
const { rateLimit } = require('express-rate-limit');
const request = require('supertest');
const User = require('../models/User');
const { SENSITIVE_ACTION_CATEGORIES } = require('../config/sensitiveActionPolicy');
const { getMfaSecurityCenter, recoveryVerify, setupTotp } = require('../controllers/mfaController');
const { requireSensitiveAction } = require('../middleware/sensitiveActionMiddleware');
const { errorHandler } = require('../middleware/errorMiddleware');
const { generateRecoveryCodesForUser } = require('../services/authRecoveryCodeService');
const {
    clearMfaChallengeMemory,
    createMfaChallenge,
} = require('../services/mfaChallengeService');

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const ORIGINAL_ENV = { ...process.env };
const MFA_SECRET = 'R0lloutMfaKey32CharsPlusAlpha999';
const RECOVERY_SECRET = 'rollout-recovery-secret-32-characters-plus';
const testRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    standardHeaders: false,
    legacyHeaders: false,
});

const applyMfaEnv = (overrides = {}) => {
    process.env = {
        ...ORIGINAL_ENV,
        NODE_ENV: 'test',
        AUTH_RECOVERY_CODE_SECRET: RECOVERY_SECRET,
        AUTH_SESSION_ALLOW_MEMORY_FALLBACK: 'true',
        MFA_ENABLED: 'true',
        MFA_TOTP_ENABLED: 'true',
        MFA_PASSKEY_ENABLED: 'true',
        MFA_RECOVERY_CODES_ENABLED: 'true',
        MFA_REQUIRED_FOR_ADMINS: 'false',
        MFA_REQUIRED_FOR_SELLERS: 'false',
        MFA_EMAIL_OTP_FALLBACK_ENABLED: 'false',
        MFA_SECRET_ENCRYPTION_KEY: MFA_SECRET,
        ...overrides,
    };
};

const buildRuntimeSecret = (label = 'rollout') => (
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const buildMfaControllerApp = ({ user }) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = {
            _id: user._id,
            email: user.email,
            name: user.name,
            isVerified: true,
        };
        req.authUid = `uid-${user._id}`;
        req.authToken = {
            uid: `uid-${user._id}`,
            email: user.email,
            email_verified: true,
            name: user.name,
        };
        next();
    });
    app.get('/api/auth/mfa', getMfaSecurityCenter);
    app.post('/api/auth/mfa/totp/setup', setupTotp);
    app.post('/api/auth/mfa/recovery/verify', recoveryVerify);
    app.use(errorHandler);
    return app;
};

const buildAdminStepUpApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = {
            _id: 'admin-1',
            email: 'admin-rollout@example.test',
            isAdmin: true,
            adminRoles: ['ADMIN'],
            trustedDevices: [{
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'credential-admin-1',
                webauthnUserVerified: true,
                credentialScope: 'admin',
                adminEligibility: 'verified',
            }],
            mfa: {
                enabled: true,
                defaultMethod: 'passkey',
                passkeys: [{ credentialId: 'credential-admin-1' }],
                totp: {
                    enabled: true,
                    confirmedAt: new Date('2026-06-04T00:00:00.000Z'),
                },
            },
            recoveryCodeState: { activeCount: 2 },
        };
        req.authUid = 'uid-admin-1';
        req.authToken = { email: req.user.email, email_verified: true };
        req.authSession = {
            sessionId: 'admin-session-1',
            amr: ['password'],
            stepUpUntil: null,
        };
        req.authzPosture = {
            fresh: true,
            authAgeSeconds: 60,
            webAuthnStepUpFresh: true,
        };
        next();
    });
    app.post('/api/admin/payments/payouts/change', testRateLimiter, requireSensitiveAction({
        action: 'admin.payments.payout.change',
        category: SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
        riskLevel: 'critical',
        resourceType: 'payment',
    }), (_req, res) => {
        res.json({ ok: true });
    });
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({
            message: err.message,
            code: err.code,
            requiresStepUpMfa: err.requiresStepUpMfa,
            mfaChallenge: err.mfaChallenge,
            mfaPolicy: err.mfaPolicy,
        });
    });
    return app;
};

const buildIsolatedSyncApp = () => {
    let isolatedApp;
    let refreshBrowserSession;

    jest.isolateModules(() => {
        applyMfaEnv();
        refreshBrowserSession = jest.fn().mockResolvedValue({
            sessionId: 'session-should-not-be-created',
        });

        jest.doMock('../services/browserSessionService', () => ({
            SESSION_STEP_UP_TTL_MS: 10 * 60 * 1000,
            clearBrowserSessionCookie: jest.fn(),
            getBrowserSessionFromRequest: jest.fn(),
            refreshBrowserSession,
            revokeBrowserSession: jest.fn(),
        }));
        jest.doMock('../services/authSessionService', () => {
            const actual = jest.requireActual('../services/authSessionService');
            return {
                ...actual,
                syncAuthenticatedUser: jest.fn().mockResolvedValue({
                    _id: 'user-rollout-1',
                    name: 'Rollout User',
                    email: 'rollout-user@example.test',
                    phone: '+919876543210',
                    isAdmin: false,
                    isSeller: false,
                    isVerified: true,
                    accountState: 'active',
                    moderation: {},
                    mfa: {
                        enabled: true,
                        defaultMethod: 'totp',
                        totp: {
                            enabled: true,
                            confirmedAt: new Date('2026-06-04T00:00:00.000Z'),
                        },
                    },
                    recoveryCodeState: { activeCount: 2 },
                    loyalty: {},
                    createdAt: new Date('2026-06-04T00:00:00.000Z'),
                }),
            };
        });
        jest.doMock('../services/trustedDeviceChallengeService', () => ({
            TRUSTED_DEVICE_SESSION_HEADER: 'x-aura-device-session',
            extractTrustedDeviceChallengePayload: jest.fn().mockReturnValue(null),
            extractTrustedDeviceContext: jest.fn((req) => ({
                deviceId: req.headers['x-aura-device-id'] || '',
                deviceLabel: req.headers['x-aura-device-label'] || '',
            })),
            getTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
            hashTrustedDeviceSessionToken: jest.fn().mockReturnValue(''),
            issueTrustedDeviceBootstrapChallenge: jest.fn().mockResolvedValue(null),
            issueTrustedDeviceChallenge: jest.fn(),
            resolveTrustedDeviceBootstrapSignal: jest.fn().mockReturnValue({
                verified: false,
                deviceId: '',
                deviceSessionHash: '',
            }),
            verifyTrustedDeviceChallenge: jest.fn(),
            verifyTrustedDeviceSession: jest.fn().mockReturnValue({ success: false }),
        }));

        const { syncSession } = require('../controllers/authController');
        const { errorHandler: isolatedErrorHandler } = require('../middleware/errorMiddleware');
        isolatedApp = express();
        isolatedApp.use(express.json());
        isolatedApp.post('/api/auth/sync', (req, _res, next) => {
            req.user = {
                email: 'rollout-user@example.test',
                name: 'Rollout User',
                phone: '+919876543210',
                isVerified: true,
            };
            req.authUid = 'uid-rollout-user';
            req.authToken = {
                uid: 'uid-rollout-user',
                email: 'rollout-user@example.test',
                email_verified: true,
            };
            next();
        }, syncSession);
        isolatedApp.use(isolatedErrorHandler);
    });

    return { isolatedApp, refreshBrowserSession };
};

describe('Aura MFA staging rollout smoke', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        clearMfaChallengeMemory();
        jest.clearAllMocks();
        jest.dontMock('../services/authSessionService');
        jest.dontMock('../services/browserSessionService');
        jest.dontMock('../services/trustedDeviceChallengeService');
    });

    test('TOTP setup endpoint is reflected by the MFA status endpoint', async () => {
        applyMfaEnv();
        const user = await User.create({
            name: 'Rollout TOTP User',
            email: `${buildRuntimeSecret('rollout-totp')}@example.test`,
            isVerified: true,
        });
        const app = buildMfaControllerApp({ user });

        const beforeSetup = await request(app).get('/api/auth/mfa');
        expect(beforeSetup.statusCode).toBe(200);
        expect(beforeSetup.body.flags).toMatchObject({
            enabled: true,
            totpEnabled: true,
            passkeyEnabled: true,
            recoveryCodesEnabled: true,
        });
        expect(beforeSetup.body.mfa.methods.totp).toMatchObject({
            enabled: false,
            pending: false,
        });

        const setup = await request(app).post('/api/auth/mfa/totp/setup').send({});
        expect(setup.statusCode).toBe(201);
        expect(setup.body.manualKey).toEqual(expect.any(String));
        expect(setup.body.otpauthUri).toContain('otpauth://totp/');
        expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

        const afterSetup = await request(app).get('/api/auth/mfa');
        expect(afterSetup.statusCode).toBe(200);
        expect(afterSetup.body.mfa.methods.totp).toMatchObject({
            enabled: false,
            pending: true,
        });
    });

    test('primary login returns an MFA challenge without a final aura_sid session', async () => {
        const { isolatedApp, refreshBrowserSession } = buildIsolatedSyncApp();

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'rollout-user@example.test', name: 'Rollout User' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            status: 'mfa_challenge_required',
            requiresMfa: true,
            mfaChallenge: {
                purpose: 'login',
                allowedMethods: ['totp', 'recovery_code'],
                preferredMethod: 'totp',
            },
            mfaPolicy: {
                mfaRequired: true,
                reason: 'user_enabled',
            },
        });
        expect(refreshBrowserSession).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.body.session.sessionId).toBeUndefined();
    });

    test('MFA recovery-code login consumes a code once even across fresh challenges', async () => {
        applyMfaEnv();
        const user = await User.create({
            name: 'Rollout Recovery User',
            email: `${buildRuntimeSecret('rollout-recovery')}@example.test`,
            isVerified: true,
            mfa: {
                enabled: true,
                defaultMethod: 'totp',
                totp: {
                    enabled: true,
                    confirmedAt: new Date('2026-06-04T00:00:00.000Z'),
                },
            },
        });
        const { codes } = await generateRecoveryCodesForUser({
            userId: user._id,
            requirePasskey: false,
        });
        const app = buildMfaControllerApp({ user });
        const challenge = await createMfaChallenge({
            user,
            purpose: 'login',
            policy: {
                allowedMethods: ['recovery_code'],
                preferredMethod: 'recovery_code',
                reason: 'user_enabled',
            },
        });

        const firstUse = await request(app)
            .post('/api/auth/mfa/recovery/verify')
            .send({
                challengeId: challenge.challengeId,
                code: codes[0],
            });

        expect(firstUse.statusCode).toBe(200);
        expect(firstUse.body.status).toBe('authenticated');
        expect(firstUse.body.mfa.methods.recoveryCodes.activeCount).toBe(9);
        expect(firstUse.headers['set-cookie']?.join(';')).toContain('aura_sid=');

        const freshChallenge = await createMfaChallenge({
            user,
            purpose: 'login',
            policy: {
                allowedMethods: ['recovery_code'],
                preferredMethod: 'recovery_code',
                reason: 'user_enabled',
            },
        });
        const replay = await request(app)
            .post('/api/auth/mfa/recovery/verify')
            .send({
                challengeId: freshChallenge.challengeId,
                code: codes[0],
            });

        expect(replay.statusCode).toBe(401);
        expect(replay.body.message).toContain('invalid or already used');
    });

    test('admin destructive action returns a fresh MFA step-up challenge', async () => {
        applyMfaEnv({
            MFA_REQUIRED_FOR_ADMINS: 'true',
            AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES: 'true',
        });
        const app = buildAdminStepUpApp();

        const res = await request(app)
            .post('/api/admin/payments/payouts/change')
            .send({ payoutAccountId: 'acct_rollout_1' });

        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({
            code: 'FRESH_MFA_REQUIRED',
            requiresStepUpMfa: true,
            mfaChallenge: {
                purpose: 'step_up',
                allowedMethods: ['passkey', 'totp', 'recovery_code'],
                preferredMethod: 'passkey',
                action: 'admin.payments.payout.change',
            },
            mfaPolicy: {
                freshMfaRequired: true,
                preferredMethod: 'passkey',
                reason: 'dangerous_action',
            },
        });
    });
});
