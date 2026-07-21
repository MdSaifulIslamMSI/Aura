const express = require('express');
const request = require('supertest');

const ORIGINAL_ENV = { ...process.env };
const TEST_PRIMARY_FACTOR_METHOD = 'pwd';

jest.setTimeout(30_000);

describe('mfaController passkey response contract', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('binds a legacy admin passkey to the MFA challenge and exact current device before promotion', async () => {
        let app;
        let consumeMfaChallenge;
        let inspectMfaChallenge;
        let issueTrustedDeviceChallenge;
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
            credentialScope: 'recognition',
            adminEligibility: 'legacy_candidate',
            enrollmentContext: 'legacy_admin_snapshot',
            createdAt: new Date('2026-07-18T00:00:00.000Z'),
            expiresAt: new Date('2099-07-18T00:00:00.000Z'),
        };
        const otherLegacyDevice = {
            ...trustedDevice,
            deviceId: 'device-passkey-other',
            webauthnCredentialIdBase64Url: 'fixture-passkey-other-credential',
        };
        const verifiedTrustedDevice = {
            ...trustedDevice,
            credentialScope: 'admin',
            adminEligibility: 'verified',
            enrollmentContext: 'mfa',
        };
        const currentUser = {
            _id: '507f1f77bcf86cd799439015',
            __v: 4,
            name: 'Passkey User',
            email: 'passkey-user@example.test',
            isAdmin: true,
            isVerified: true,
            trustedDevices: [trustedDevice, otherLegacyDevice],
            mfa: { enabled: true, passkeys: [] },
            recoveryCodeState: { activeCount: 0 },
        };
        const updatedUser = {
            ...currentUser,
            __v: 5,
            trustedDevices: [verifiedTrustedDevice, otherLegacyDevice],
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
                    trustedDevice: verifiedTrustedDevice,
                    deviceSessionToken,
                    expiresAt,
                });
            issueTrustedDeviceChallenge = jest.fn().mockResolvedValue({
                token: 'fixture-passkey-options-token',
                method: 'webauthn',
                deviceId: trustedDevice.deviceId,
                challengeScope: 'mfa-passkey-login',
            });
            jest.doMock('../services/trustedDeviceChallengeService', () => ({
                extractTrustedDeviceContext: jest.fn((req) => ({
                    deviceId: String(req.headers['x-aura-device-id'] || ''),
                    deviceLabel: 'Fixture security key',
                })),
                getTrustedDeviceRegistration: jest.fn((user, deviceId) => (
                    user?.trustedDevices?.find((device) => device.deviceId === deviceId) || null
                )),
                issueTrustedDeviceChallenge,
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
                evaluateLogin: jest.fn().mockReturnValue({ mfaRequired: false }),
                hasPasskey: jest.fn(),
                hasTotp: jest.fn(),
                isAdminSubject: jest.fn((user) => Boolean(user?.isAdmin)),
                isCurrentLegacyAdminPasskeyCandidate: jest.fn(({ user, session }) => {
                    const current = user?.trustedDevices?.find((device) => (
                        device.deviceId === session?.deviceId
                    ));
                    return Boolean(
                        user?.isAdmin
                        && current?.credentialScope === 'recognition'
                        && current?.adminEligibility === 'legacy_candidate'
                        && current?.enrollmentContext === 'legacy_admin_snapshot'
                    );
                }),
                isEligiblePasskeyMfaDevice: jest.fn(({ user, device }) => Boolean(
                    device?.webauthnUserVerified
                    && (
                        !user?.isAdmin
                        || (
                            device?.credentialScope === 'admin'
                            && device?.adminEligibility === 'verified'
                        )
                    )
                )),
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

            const { passkeyLoginOptions, passkeyLoginVerify } = require('../controllers/mfaController');
            const { budgetRequestTimeout } = require('../middleware/requestTimeouts');
            app = express();
            app.use(express.json());
            const attachAuthContext = (req, _res, next) => {
                req.user = currentUser;
                req.authUid = 'uid-passkey-user';
                req.authToken = {
                    uid: 'uid-passkey-user',
                    email: currentUser.email,
                    email_verified: true,
                };
                req.authSession = {
                    sessionId: 'fixture-browser-session',
                    deviceId: trustedDevice.deviceId,
                    amr: [TEST_PRIMARY_FACTOR_METHOD],
                };
                req.requestId = 'passkey-timeout-race';
                req.trafficBudget = {
                    routeClass: 'AUTH_WEBAUTHN',
                    timeoutMs: 75,
                };
                next();
            };
            app.post(
                '/api/auth/mfa/passkey/login/options',
                attachAuthContext,
                budgetRequestTimeout(),
                passkeyLoginOptions
            );
            app.post(
                '/api/auth/mfa/passkey/login/verify',
                attachAuthContext,
                budgetRequestTimeout(),
                passkeyLoginVerify
            );
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
        const missingChallenge = await request(app)
            .post('/api/auth/mfa/passkey/login/options')
            .set('x-aura-device-id', trustedDevice.deviceId)
            .send({});

        expect(missingChallenge.statusCode).toBe(400);
        expect(missingChallenge.body.message).toBe('MFA challenge is required.');
        expect(inspectMfaChallenge).not.toHaveBeenCalled();
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();

        const wrongDevice = await request(app)
            .post('/api/auth/mfa/passkey/login/options')
            .set('x-aura-device-id', otherLegacyDevice.deviceId)
            .send({ challengeId: requestBody.challengeId });

        expect(wrongDevice.statusCode).toBe(403);
        expect(wrongDevice.body.message).toBe(
            'This passkey is not approved for MFA on the current device.'
        );
        expect(issueTrustedDeviceChallenge).not.toHaveBeenCalled();

        const options = await request(app)
            .post('/api/auth/mfa/passkey/login/options')
            .set('x-aura-device-id', trustedDevice.deviceId)
            .send({ challengeId: requestBody.challengeId });

        expect(options.statusCode).toBe(201);
        expect(issueTrustedDeviceChallenge).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: trustedDevice.deviceId,
            challengeScope: 'mfa-passkey-login',
            allowEnrollment: false,
        }));

        const cancelled = await request(app)
            .post('/api/auth/mfa/passkey/login/verify')
            .set('x-aura-device-id', trustedDevice.deviceId)
            .send(requestBody);

        expect(cancelled.statusCode).toBe(403);
        expect(cancelled.body.message).toBe('Passkey verification failed: assertion_cancelled');
        expect(inspectMfaChallenge).toHaveBeenCalledTimes(3);
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
        expect(inspectMfaChallenge).toHaveBeenCalledTimes(4);
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
            webAuthnStepUpUntil: expect.any(String),
        }));
        const persistedSession = refreshBrowserSession.mock.calls.at(-1)[0];
        expect(persistedSession.webAuthnStepUpUntil).toBe(persistedSession.stepUpUntil);

        let releaseInspection;
        inspectMfaChallenge.mockImplementationOnce(() => new Promise((resolve) => {
            releaseInspection = () => resolve({
                success: true,
                challenge: { purpose: 'login' },
            });
        }));
        const verificationCallsBeforeTimeout = verifyTrustedDeviceChallenge.mock.calls.length;
        const consumeCallsBeforeTimeout = consumeMfaChallenge.mock.calls.length;
        const refreshCallsBeforeTimeout = refreshBrowserSession.mock.calls.length;

        const timedOut = await request(app)
            .post('/api/auth/mfa/passkey/login/verify')
            .set('x-aura-device-id', trustedDevice.deviceId)
            .send(requestBody);

        expect(timedOut.statusCode).toBe(503);
        expect(timedOut.body).toMatchObject({
            success: false,
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            requestId: 'passkey-timeout-race',
        });

        releaseInspection();
        await new Promise((resolve) => setImmediate(resolve));

        expect(inspectMfaChallenge).toHaveBeenCalledTimes(5);
        expect(verifyTrustedDeviceChallenge).toHaveBeenCalledTimes(verificationCallsBeforeTimeout);
        expect(consumeMfaChallenge).toHaveBeenCalledTimes(consumeCallsBeforeTimeout);
        expect(refreshBrowserSession).toHaveBeenCalledTimes(refreshCallsBeforeTimeout);
    });
});
