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

const buildHarness = ({
    controllerOverrides = {},
    limiterOverrides = {},
    scannerLimiter: scannerLimiterOverride,
    timeoutMs = 30,
    turnstileOverrides = {},
} = {}) => {
    let app;
    let router;
    const distributedLimiters = new Map();
    const turnstileGuards = new Map();
    const passThrough = () => jest.fn((_req, _res, next) => next());
    const defaultController = () => jest.fn((_req, res) => res.status(204).end());
    const controllers = {
        checkUserExists: controllerOverrides.checkUserExists || defaultController(),
        getOtpChallenge: controllerOverrides.getOtpChallenge || defaultController(),
        resetPasswordWithOtp: controllerOverrides.resetPasswordWithOtp || defaultController(),
        sendOtp: controllerOverrides.sendOtp || defaultController(),
        verifyOtp: controllerOverrides.verifyOtp || defaultController(),
    };
    const scannerLimiter = scannerLimiterOverride || passThrough();

    jest.doMock('../controllers/otpController', () => controllers);
    jest.doMock('../middleware/distributedRateLimit', () => ({
        createDistributedRateLimit: jest.fn(({ name }) => {
            const limiter = limiterOverrides[name] || passThrough();
            distributedLimiters.set(name, limiter);
            return limiter;
        }),
    }));
    jest.doMock('../middleware/turnstileMiddleware', () => ({
        requireTurnstile: jest.fn(({ routeName }) => {
            const guard = turnstileOverrides[routeName] || passThrough();
            turnstileGuards.set(routeName, guard);
            return guard;
        }),
    }));
    jest.doMock('express-rate-limit', () => ({
        rateLimit: jest.fn(() => scannerLimiter),
    }));
    jest.doMock('../metrics/trafficResilienceMetrics', () => ({
        recordTrafficBudgetDenied: jest.fn(),
    }));
    jest.doMock('../utils/logger', () => ({ warn: jest.fn() }));

    jest.isolateModules(() => {
        router = require('../routes/otpRoutes');
        const { budgetRequestTimeout } = require('../middleware/requestTimeouts');

        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.requestId = 'otp-commit-boundary-test';
            req.trafficBudget = {
                routeClass: 'AUTH_LOGIN',
                timeoutMs,
            };
            next();
        });
        app.use(budgetRequestTimeout());
        app.use('/api/auth/otp', router);
    });

    return {
        app,
        controllers,
        distributedLimiters,
        router,
        scannerLimiter,
        turnstileGuards,
    };
};

const getRouteHandles = (router, path) => {
    const routeLayer = router.stack.find((layer) => (
        layer.route?.path === path
        && layer.route?.methods?.post
    ));
    expect(routeLayer).toBeTruthy();
    return routeLayer.route.stack.map((layer) => layer.handle);
};

const expectBoundaryAfter = (handles, prerequisites, controller) => {
    const boundaryIndex = handles.findIndex((handle) => handle.name === 'beginAtomicOtpResponse');
    expect(boundaryIndex).toBeGreaterThanOrEqual(0);
    prerequisites.forEach((middleware) => {
        expect(handles.indexOf(middleware)).toBeGreaterThanOrEqual(0);
        expect(handles.indexOf(middleware)).toBeLessThan(boundaryIndex);
    });
    expect(handles.indexOf(controller)).toBeGreaterThan(boundaryIndex);
};

describe('OTP route traffic-budget commit boundary', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('places each mutation boundary after Turnstile and all relevant admission limiters', () => {
        const {
            controllers,
            distributedLimiters,
            router,
            scannerLimiter,
            turnstileGuards,
        } = buildHarness();

        expectBoundaryAfter(
            getRouteHandles(router, '/send'),
            [
                turnstileGuards.get('otp_send'),
                distributedLimiters.get('otp_send'),
            ],
            controllers.sendOtp
        );
        expectBoundaryAfter(
            getRouteHandles(router, '/verify'),
            [
                turnstileGuards.get('otp_verify'),
                distributedLimiters.get('otp_verify'),
            ],
            controllers.verifyOtp
        );
        expectBoundaryAfter(
            getRouteHandles(router, '/reset-password'),
            [
                scannerLimiter,
                turnstileGuards.get('otp_reset_password'),
                distributedLimiters.get('otp_reset_password_ip_abuse'),
                distributedLimiters.get('otp_reset_password'),
            ],
            controllers.resetPasswordWithOtp
        );
    });

    test('returns 503 and never reaches the send controller when admission exceeds the budget', async () => {
        const admissionEntered = createDeferred();
        const releaseAdmission = createDeferred();
        const delayedLimiter = jest.fn((_req, _res, next) => {
            admissionEntered.resolve();
            releaseAdmission.promise.then(() => next());
        });
        const sendOtp = jest.fn((_req, res) => res.json({ success: true }));
        const { app } = buildHarness({
            controllerOverrides: { sendOtp },
            limiterOverrides: { otp_send: delayedLimiter },
        });

        const responsePromise = request(app)
            .post('/api/auth/otp/send')
            .send({ email: 'otp-timeout@example.test', purpose: 'login' })
            .then((response) => response);

        await admissionEntered.promise;
        const response = await responsePromise;

        expect(response.statusCode).toBe(503);
        expect(response.body).toMatchObject({
            success: false,
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            requestId: 'otp-commit-boundary-test',
        });

        releaseAdmission.resolve();
        await flushAsyncWork();

        expect(sendOtp).not.toHaveBeenCalled();
    });

    test('lets an admitted OTP mutation finish after the budget duration without a late 503', async () => {
        const controllerEntered = createDeferred();
        const releaseController = createDeferred();
        let controllerRequest;
        const verifyOtp = jest.fn(async (req, res) => {
            controllerRequest = req;
            controllerEntered.resolve();
            await releaseController.promise;
            res.status(200).json({ success: true, mutation: 'committed' });
        });
        const timeoutMs = 30;
        const { app } = buildHarness({
            controllerOverrides: { verifyOtp },
            timeoutMs,
        });

        let responseSettled = false;
        const responsePromise = request(app)
            .post('/api/auth/otp/verify')
            .send({
                email: 'otp-timeout@example.test',
                otp: '123456',
                purpose: 'login',
            })
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
        expect(verifyOtp).toHaveBeenCalledTimes(1);
    });
});
