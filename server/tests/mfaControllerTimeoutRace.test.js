const express = require('express');
const request = require('supertest');

const createDeferred = () => {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
};

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const buildHarness = ({ inspectMfaChallenge, timeoutMs = 30 } = {}) => {
    let app;
    const currentUser = {
        _id: '507f1f77bcf86cd799439015',
        email: 'mfa-timeout@example.test',
        isVerified: true,
        mfa: {
            enabled: true,
            totp: { enabled: true },
        },
        recoveryCodeState: { activeCount: 4 },
        trustedDevices: [],
    };
    const verifyEnabledTotpForUser = jest.fn().mockResolvedValue(currentUser);
    const verifyAndConsumeRecoveryCode = jest.fn().mockResolvedValue({
        user: currentUser,
        recoveryCodeState: { activeCount: 3 },
    });
    const consumeMfaChallenge = jest.fn().mockResolvedValue({ success: true });
    const refreshBrowserSession = jest.fn().mockResolvedValue({
        sessionId: 'session-after-mfa',
        aal: 'aal2',
    });

    jest.doMock('../models/User', () => ({
        findById: jest.fn(),
        findOneAndUpdate: jest.fn(),
    }));
    jest.doMock('../services/authSessionService', () => ({
        buildSessionPayload: jest.fn(() => ({ status: 'authenticated' })),
    }));
    jest.doMock('../services/browserSessionService', () => ({
        SESSION_STEP_UP_TTL_MS: 10 * 60 * 1000,
        clearBrowserSessionCookie: jest.fn(),
        refreshBrowserSession,
    }));
    jest.doMock('../services/trustedDeviceChallengeService', () => ({
        extractTrustedDeviceContext: jest.fn(),
        getTrustedDeviceRegistration: jest.fn(),
        issueTrustedDeviceChallenge: jest.fn(),
        verifyTrustedDeviceChallenge: jest.fn(),
    }));
    jest.doMock('../services/trustedDeviceManagementService', () => ({
        isActiveTrustedDevice: jest.fn(() => false),
        renameTrustedDevice: jest.fn(),
        revokeTrustedDevices: jest.fn(),
    }));
    jest.doMock('../services/totpMfaService', () => ({
        beginTotpSetup: jest.fn(),
        disableTotpAfterFreshMfa: jest.fn(),
        enableTotpAfterVerification: jest.fn(),
        getPendingTotpSetup: jest.fn(),
        verifyEnabledTotpForUser,
    }));
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
        isAdminSubject: jest.fn(() => false),
    }));
    jest.doMock('../services/recoveryCodeService', () => ({
        generateRecoveryCodes: jest.fn(),
        verifyAndConsumeRecoveryCode,
    }));
    jest.doMock('../config/mfaConfig', () => ({
        resolveMfaConfig: jest.fn(() => ({
            enabled: true,
            passkeyEnabled: true,
            recoveryCodesEnabled: true,
            totpEnabled: true,
        })),
    }));
    jest.doMock('../services/authSecurityTelemetryService', () => ({
        recordAuthSecurityEvent: jest.fn(),
    }));
    jest.doMock('../services/trustedDeviceAssuranceService', () => ({
        hasObservedWebAuthnUserVerification: jest.fn(() => false),
    }));
    jest.doMock('../middleware/authMiddleware', () => ({
        invalidateUserCache: jest.fn().mockResolvedValue(undefined),
        invalidateUserCacheByEmail: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../metrics/trafficResilienceMetrics', () => ({
        recordTrafficBudgetDenied: jest.fn(),
    }));
    jest.doMock('../utils/logger', () => ({ warn: jest.fn() }));

    jest.isolateModules(() => {
        const {
            recoveryVerify,
            verifyTotpLogin,
        } = require('../controllers/mfaController');
        const { budgetRequestTimeout } = require('../middleware/requestTimeouts');
        const injectAuthContext = (req, _res, next) => {
            req.user = currentUser;
            req.authUid = 'uid-mfa-timeout';
            req.authToken = {
                uid: 'uid-mfa-timeout',
                email: currentUser.email,
                email_verified: true,
            };
            req.authSession = null;
            req.requestId = 'mfa-controller-timeout-race';
            req.trafficBudget = {
                routeClass: 'AUTH_LOGIN',
                timeoutMs,
            };
            next();
        };

        app = express();
        app.use(express.json());
        app.post(
            '/api/auth/mfa/totp/verify-login',
            injectAuthContext,
            budgetRequestTimeout(),
            verifyTotpLogin
        );
        app.post(
            '/api/auth/mfa/recovery/verify',
            injectAuthContext,
            budgetRequestTimeout(),
            recoveryVerify
        );
        app.use((error, _req, res, _next) => {
            if (res.headersSent) return;
            res.status(error.statusCode || 500).json({ message: error.message });
        });
    });

    return {
        app,
        consumeMfaChallenge,
        refreshBrowserSession,
        verifyAndConsumeRecoveryCode,
        verifyEnabledTotpForUser,
    };
};

describe('MFA controller traffic-budget timeout races', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('does not verify TOTP, consume the challenge, or refresh the session after inspection times out', async () => {
        const inspectionEntered = createDeferred();
        const releaseInspection = createDeferred();
        const inspectMfaChallenge = jest.fn(async () => {
            inspectionEntered.resolve();
            await releaseInspection.promise;
            return {
                success: true,
                challenge: { purpose: 'login' },
            };
        });
        const {
            app,
            consumeMfaChallenge,
            refreshBrowserSession,
            verifyEnabledTotpForUser,
        } = buildHarness({ inspectMfaChallenge });

        const responsePromise = request(app)
            .post('/api/auth/mfa/totp/verify-login')
            .send({
                challengeId: 'totp-timeout-challenge',
                code: '123456',
                purpose: 'login',
            })
            .then((response) => response);

        await inspectionEntered.promise;
        const response = await responsePromise;

        expect(response.statusCode).toBe(503);
        expect(response.body).toMatchObject({
            success: false,
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            requestId: 'mfa-controller-timeout-race',
        });

        releaseInspection.resolve();
        await flushAsyncWork();

        expect(inspectMfaChallenge).toHaveBeenCalledTimes(1);
        expect(verifyEnabledTotpForUser).not.toHaveBeenCalled();
        expect(consumeMfaChallenge).not.toHaveBeenCalled();
        expect(refreshBrowserSession).not.toHaveBeenCalled();
    });

    test('does not consume a recovery code, consume the challenge, or refresh the session after inspection times out', async () => {
        const inspectionEntered = createDeferred();
        const releaseInspection = createDeferred();
        const inspectMfaChallenge = jest.fn(async () => {
            inspectionEntered.resolve();
            await releaseInspection.promise;
            return {
                success: true,
                challenge: { purpose: 'login' },
            };
        });
        const {
            app,
            consumeMfaChallenge,
            refreshBrowserSession,
            verifyAndConsumeRecoveryCode,
        } = buildHarness({ inspectMfaChallenge });

        const responsePromise = request(app)
            .post('/api/auth/mfa/recovery/verify')
            .send({
                challengeId: 'recovery-timeout-challenge',
                code: 'fixture-recovery-code',
                purpose: 'login',
            })
            .then((response) => response);

        await inspectionEntered.promise;
        const response = await responsePromise;

        expect(response.statusCode).toBe(503);
        expect(response.body).toMatchObject({
            success: false,
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            requestId: 'mfa-controller-timeout-race',
        });

        releaseInspection.resolve();
        await flushAsyncWork();

        expect(inspectMfaChallenge).toHaveBeenCalledTimes(1);
        expect(verifyAndConsumeRecoveryCode).not.toHaveBeenCalled();
        expect(consumeMfaChallenge).not.toHaveBeenCalled();
        expect(refreshBrowserSession).not.toHaveBeenCalled();
    });
});
