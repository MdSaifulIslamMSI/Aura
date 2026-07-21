const express = require('express');
const request = require('supertest');

const createDeferred = () => {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const buildVerifyDeviceHarness = ({
    protect,
    trustedDeviceVerificationLimiter,
    csrfTokenValidatorUnlessBearerAuth,
    verifyDeviceChallenge,
    timeoutMs = 30,
}) => {
    let app;
    const passThrough = jest.fn((_req, _res, next) => next());
    const endpoint = jest.fn((_req, res) => res.status(204).end());

    jest.doMock('express-rate-limit', () => ({
        rateLimit: jest.fn(() => passThrough),
    }));
    jest.doMock('../middleware/distributedRateLimit', () => ({
        createDistributedRateLimit: jest.fn(({ name }) => (
            name === 'auth_verify_device'
                ? trustedDeviceVerificationLimiter
                : passThrough
        )),
    }));
    jest.doMock('../controllers/authController', () => ({
        establishSessionCookie: passThrough,
        generateBackupRecoveryCodes: endpoint,
        getSession: endpoint,
        logoutSession: endpoint,
        requestBootstrapDeviceChallenge: endpoint,
        syncSession: endpoint,
        completePhoneFactorLogin: endpoint,
        completePhoneFactorVerification: endpoint,
        completeDuoLogin: endpoint,
        completeEnterpriseLogin: endpoint,
        verifyBackupRecoveryCode: endpoint,
        verifyDeviceChallenge,
        issueDesktopHandoffToken: endpoint,
        prepareDesktopHandoff: endpoint,
        issueDesktopOwnerAccessToken: endpoint,
        startEnterpriseLogin: endpoint,
        startDuoLogin: endpoint,
        startDuoStepUp: endpoint,
    }));
    jest.doMock('../controllers/mfaController', () => ({
        createStepUpChallenge: endpoint,
        disableTotp: endpoint,
        getMfaSecurityCenter: endpoint,
        getTotpQr: endpoint,
        passkeyLoginOptions: endpoint,
        passkeyLoginVerify: endpoint,
        passkeyRegisterOptions: endpoint,
        passkeyRegisterVerify: endpoint,
        passkeyRemove: endpoint,
        renameTrustedDevice: endpoint,
        recoveryRegenerate: endpoint,
        recoveryVerify: endpoint,
        revokeOtherTrustedDevices: endpoint,
        revokeTrustedDevice: endpoint,
        setupTotp: endpoint,
        verifyTotpLogin: endpoint,
        verifyTotpSetup: endpoint,
    }));
    jest.doMock('../middleware/authMiddleware', () => ({
        protect,
        protectOptional: passThrough,
        protectPhoneFactorProof: passThrough,
    }));
    jest.doMock('../middleware/validate', () => jest.fn(() => passThrough));
    jest.doMock('../middleware/routeSecurityGuards', () => ({
        sensitiveActions: {
            accountRecoveryChange: passThrough,
            authFactorChange: passThrough,
        },
    }));
    jest.doMock('../validators/userValidators', () => ({ loginSchema: {} }));
    jest.doMock('../middleware/csrfMiddleware', () => ({
        csrfTokenGenerator: passThrough,
        csrfTokenValidator: passThrough,
        csrfTokenValidatorUnlessBearerAuth,
    }));
    jest.doMock('../middleware/turnstileMiddleware', () => ({
        requireTurnstile: jest.fn(() => passThrough),
    }));
    jest.doMock('../routes/otpRoutes', () => express.Router());
    jest.doMock('../metrics/trafficResilienceMetrics', () => ({
        recordTrafficBudgetDenied: jest.fn(),
    }));
    jest.doMock('../utils/logger', () => ({ warn: jest.fn() }));

    jest.isolateModules(() => {
        const authRouter = require('../routes/authRoutes');
        const { budgetRequestTimeout } = require('../middleware/requestTimeouts');

        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.requestId = 'auth-commit-boundary-test';
            req.trafficBudget = {
                routeClass: 'AUTH_WEBAUTHN',
                timeoutMs,
            };
            next();
        });
        app.use(budgetRequestTimeout());
        app.use('/api/auth', authRouter);
    });

    return app;
};

describe('auth route traffic-budget commit boundary', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('returns 503 when authentication exceeds the budget and never reaches the controller', async () => {
        const authenticationEntered = createDeferred();
        const releaseAuthentication = createDeferred();
        const protect = jest.fn((_req, _res, next) => {
            authenticationEntered.resolve();
            releaseAuthentication.promise.then(() => next());
        });
        const limiter = jest.fn((_req, _res, next) => next());
        const csrf = jest.fn((_req, _res, next) => next());
        const controller = jest.fn((_req, res) => res.json({ success: true }));
        const app = buildVerifyDeviceHarness({
            protect,
            trustedDeviceVerificationLimiter: limiter,
            csrfTokenValidatorUnlessBearerAuth: csrf,
            verifyDeviceChallenge: controller,
        });

        const responsePromise = request(app)
            .post('/api/auth/verify-device')
            .send({ token: 'fixture-token', proof: 'fixture-proof' })
            .then((response) => response);

        await authenticationEntered.promise;
        const response = await responsePromise;

        expect(response.statusCode).toBe(503);
        expect(response.body).toMatchObject({
            success: false,
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            requestId: 'auth-commit-boundary-test',
        });
        expect(controller).not.toHaveBeenCalled();

        releaseAuthentication.resolve();
        await flushAsyncWork();

        expect(csrf).not.toHaveBeenCalled();
        expect(controller).not.toHaveBeenCalled();
    });

    test('allows an authoritative controller to finish after admission starts the commit boundary', async () => {
        const controllerEntered = createDeferred();
        const releaseController = createDeferred();
        const protect = jest.fn((req, _res, next) => {
            req.user = { _id: 'user-1' };
            next();
        });
        const limiter = jest.fn((_req, _res, next) => next());
        const csrf = jest.fn((_req, _res, next) => next());
        let controllerRequest;
        const controller = jest.fn(async (req, res) => {
            controllerRequest = req;
            controllerEntered.resolve();
            await releaseController.promise;
            res.status(200).json({ success: true, mutation: 'committed' });
        });
        const timeoutMs = 30;
        const app = buildVerifyDeviceHarness({
            protect,
            trustedDeviceVerificationLimiter: limiter,
            csrfTokenValidatorUnlessBearerAuth: csrf,
            verifyDeviceChallenge: controller,
            timeoutMs,
        });

        let responseSettled = false;
        const responsePromise = request(app)
            .post('/api/auth/verify-device')
            .send({ token: 'fixture-token', proof: 'fixture-proof' })
            .then((response) => {
                responseSettled = true;
                return response;
            });

        await controllerEntered.promise;
        await wait(timeoutMs * 3);

        expect(responseSettled).toBe(false);
        expect(controllerRequest.trafficBudgetCommitStarted).toBe(true);
        expect(controllerRequest.trafficBudgetTimedOut).toBe(false);

        releaseController.resolve();
        const response = await responsePromise;

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({ success: true, mutation: 'committed' });
        expect(protect).toHaveBeenCalledTimes(1);
        expect(limiter).toHaveBeenCalledTimes(1);
        expect(csrf).toHaveBeenCalledTimes(1);
        expect(controller).toHaveBeenCalledTimes(1);
    });

    test('does not invoke CSRF or the controller when admission times out before the boundary', async () => {
        const admissionEntered = createDeferred();
        const releaseAdmission = createDeferred();
        const protect = jest.fn((req, _res, next) => {
            req.user = { _id: 'user-1' };
            next();
        });
        const limiter = jest.fn((_req, _res, next) => {
            admissionEntered.resolve();
            releaseAdmission.promise.then(() => next());
        });
        const csrf = jest.fn((_req, _res, next) => next());
        const controller = jest.fn((_req, res) => res.json({ success: true }));
        const app = buildVerifyDeviceHarness({
            protect,
            trustedDeviceVerificationLimiter: limiter,
            csrfTokenValidatorUnlessBearerAuth: csrf,
            verifyDeviceChallenge: controller,
        });

        const responsePromise = request(app)
            .post('/api/auth/verify-device')
            .send({ token: 'fixture-token', proof: 'fixture-proof' })
            .then((response) => response);

        await admissionEntered.promise;
        const response = await responsePromise;

        expect(response.statusCode).toBe(503);
        expect(response.body.code).toBe('TRAFFIC_ROUTE_TIMEOUT');

        releaseAdmission.resolve();
        await flushAsyncWork();

        expect(csrf).not.toHaveBeenCalled();
        expect(controller).not.toHaveBeenCalled();
    });
});
