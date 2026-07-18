const express = require('express');
const request = require('supertest');

const ORIGINAL_ENV = { ...process.env };
const TEST_PRIMARY_FACTOR_METHOD = 'pwd';

describe('mfaController passkey response contract', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('preserves the MFA challenge after a cancelled passkey assertion and consumes it after a successful retry', async () => {
        let app;
        let consumeMfaChallenge;
        let inspectMfaChallenge;
        let refreshBrowserSession;
        let verifyTrustedDeviceChallenge;
        const deviceSessionToken = 'fixture-rotated-device-session';
        const expiresAt = '2099-07-18T12:00:00.000Z';
        const trustedDevice = {
            deviceId: 'device-passkey-1',
            label: 'Fixture security key',
            method: 'webauthn',
            webauthnCredentialIdBase64Url: 'fixture-passkey-credential',
            webauthnUserVerified: true,
            credentialScope: 'mfa',
            createdAt: new Date('2026-07-18T00:00:00.000Z'),
            expiresAt: new Date('2099-07-18T00:00:00.000Z'),
        };
        const currentUser = {
            _id: '507f1f77bcf86cd799439015',
            __v: 4,
            name: 'Passkey User',
            email: 'passkey-user@example.test',
            isVerified: true,
            trustedDevices: [trustedDevice],
            mfa: { enabled: true, passkeys: [] },
            recoveryCodeState: { activeCount: 0 },
        };
        const updatedUser = {
            ...currentUser,
            __v: 5,
            mfa: {
                enabled: true,
                defaultMethod: 'passkey',
                passkeys: [{ credentialId: trustedDevice.webauthnCredentialIdBase64Url }],
            },
        };

        jest.isolateModules(() => {
            process.env.MFA_ENABLED = 'true';
            process.env.MFA_PASSKEY_ENABLED = 'true';

            const userQuery = {
                select: jest.fn(() => userQuery),
                lean: jest.fn().mockResolvedValue(currentUser),
            };
            jest.doMock('../models/User', () => ({
                findById: jest.fn().mockReturnValue(userQuery),
                findOneAndUpdate: jest.fn().mockResolvedValue(updatedUser),
            }));
            jest.doMock('../services/authSessionService', () => ({
                buildSessionPayload: jest.fn(({ status, authSession } = {}) => ({
                    status,
                    session: { sessionId: authSession?.sessionId || '' },
                })),
            }));

            refreshBrowserSession = jest.fn().mockResolvedValue({
                sessionId: 'session-after-passkey',
                deviceId: trustedDevice.deviceId,
                deviceMethod: 'webauthn',
                aal: 'aal2',
                amr: [TEST_PRIMARY_FACTOR_METHOD, 'webauthn', 'passkey', 'mfa'],
            });
            jest.doMock('../services/browserSessionService', () => ({
                SESSION_STEP_UP_TTL_MS: 10 * 60 * 1000,
                clearBrowserSessionCookie: jest.fn(),
                refreshBrowserSession,
            }));

            verifyTrustedDeviceChallenge = jest.fn()
                .mockResolvedValueOnce({
                    success: false,
                    reason: 'assertion_cancelled',
                })
                .mockResolvedValueOnce({
                    success: true,
                    method: 'webauthn',
                    trustedDevice,
                    deviceSessionToken,
                    expiresAt,
                });
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn().mockReturnValue({
                    deviceId: trustedDevice.deviceId,
                    deviceLabel: trustedDevice.label,
                }),
                getTrustedDeviceRegistration: jest.fn(),
                issueTrustedDeviceChallenge: jest.fn(),
                verifyTrustedDeviceChallenge,
            }));
            jest.doMock('../services/trustedDeviceManagementService', () => ({
                isActiveTrustedDevice: jest.fn().mockReturnValue(true),
                renameTrustedDevice: jest.fn(),
                revokeTrustedDevices: jest.fn(),
            }));
            jest.doMock('../services/totpMfaService', () => ({}));
            inspectMfaChallenge = jest.fn().mockResolvedValue({
                success: true,
                challenge: { purpose: 'login' },
            });
            consumeMfaChallenge = jest.fn().mockResolvedValue({ success: true });
            jest.doMock('../services/mfaChallengeService', () => ({
                consumeMfaChallenge,
                createMfaChallenge: jest.fn(),
                inspectMfaChallenge,
            }));
            jest.doMock('../services/mfaPolicyService', () => ({
                MFA_METHODS: {
                    PASSKEY: 'passkey',
                    TOTP: 'totp',
                    RECOVERY_CODE: 'recovery_code',
                },
                buildPublicMfaPolicy: jest.fn(),
                evaluateAction: jest.fn(),
                evaluateLogin: jest.fn(),
                hasPasskey: jest.fn(),
                hasTotp: jest.fn(),
                isAdminSubject: jest.fn((user) => Boolean(user?.isAdmin)),
            }));
            jest.doMock('../services/recoveryCodeService', () => ({}));
            jest.doMock('../config/mfaConfig', () => ({
                resolveMfaConfig: jest.fn().mockReturnValue({
                    enabled: true,
                    passkeyEnabled: true,
                }),
            }));
            jest.doMock('../services/authSecurityTelemetryService', () => ({
                recordAuthSecurityEvent: jest.fn(),
            }));
            jest.doMock('../services/trustedDeviceAssuranceService', () => ({
                hasObservedWebAuthnUserVerification: jest.fn((device) => (
                    device?.webauthnUserVerified === true
                )),
            }));
            jest.doMock('../middleware/authMiddleware', () => ({
                invalidateUserCache: jest.fn().mockResolvedValue(undefined),
                invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
            }));

            const { passkeyLoginVerify } = require('../controllers/mfaController');
            app = express();
            app.use(express.json());
            app.post('/api/auth/mfa/passkey/login/verify', (req, _res, next) => {
                req.user = currentUser;
                req.authUid = 'uid-passkey-user';
                req.authToken = {
                    uid: 'uid-passkey-user',
                    email: currentUser.email,
                    email_verified: true,
                };
                req.authSession = null;
                next();
            }, passkeyLoginVerify);
            app.use((error, _req, res, _next) => {
                res.status(error.statusCode || 500).json({ message: error.message });
            });
        });

        const requestBody = {
            challengeId: 'fixture-mfa-challenge',
            token: 'fixture-passkey-challenge',
            method: 'webauthn',
            proof: 'fixture-passkey-proof',
        };
        const cancelled = await request(app)
            .post('/api/auth/mfa/passkey/login/verify')
            .set('x-aura-device-id', trustedDevice.deviceId)
            .send(requestBody);

        expect(cancelled.statusCode).toBe(403);
        expect(cancelled.body.message).toBe('Passkey verification failed: assertion_cancelled');
        expect(inspectMfaChallenge).toHaveBeenCalledTimes(1);
        expect(verifyTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
        expect(consumeMfaChallenge).not.toHaveBeenCalled();
        expect(refreshBrowserSession).not.toHaveBeenCalled();

        const response = await request(app)
            .post('/api/auth/mfa/passkey/login/verify')
            .set('x-aura-device-id', trustedDevice.deviceId)
            .send(requestBody);

        expect(response.statusCode).toBe(200);
        expect(response.body).toMatchObject({
            success: true,
            status: 'authenticated',
            message: 'Passkey MFA verified.',
            deviceSessionToken,
            expiresAt,
            session: { sessionId: 'session-after-passkey' },
        });
        expect(verifyTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: trustedDevice.deviceId,
            expectedScope: 'mfa-passkey-login',
        }));
        expect(inspectMfaChallenge).toHaveBeenCalledTimes(2);
        expect(consumeMfaChallenge).toHaveBeenCalledTimes(1);
        expect(consumeMfaChallenge).toHaveBeenCalledWith(expect.objectContaining({
            challengeId: requestBody.challengeId,
            userId: currentUser._id,
            method: 'passkey',
            purpose: 'login',
        }));
        expect(verifyTrustedDeviceChallenge.mock.invocationCallOrder[1]).toBeLessThan(
            consumeMfaChallenge.mock.invocationCallOrder[0]
        );
        expect(refreshBrowserSession).toHaveBeenCalledWith(expect.objectContaining({
            deviceMethod: 'webauthn',
            additionalAmr: ['webauthn', 'passkey', 'mfa'],
        }));
    });
});
