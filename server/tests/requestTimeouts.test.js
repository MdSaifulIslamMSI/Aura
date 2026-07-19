const EventEmitter = require('events');

jest.mock('../metrics/trafficResilienceMetrics', () => ({
    recordTrafficBudgetDenied: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
}));

const {
    budgetRequestTimeout,
    startTrafficBudgetCommit,
} = require('../middleware/requestTimeouts');
const { createRequestTimeout } = require('../middleware/requestTimeout');

const buildResponse = () => {
    const res = new EventEmitter();
    res.headersSent = false;
    res.statusCode = 200;
    res.set = jest.fn(() => res);
    res.status = jest.fn((statusCode) => {
        res.statusCode = statusCode;
        return res;
    });
    res.json = jest.fn((body) => {
        res.body = body;
        res.headersSent = true;
        res.emit('finish');
        return res;
    });
    return res;
};

const buildRequest = () => ({
    method: 'POST',
    originalUrl: '/api/auth/mfa/passkey/login/verify',
    path: '/api/auth/mfa/passkey/login/verify',
    requestId: 'request-timeout-test',
    trafficBudget: {
        routeClass: 'AUTH_WEBAUTHN',
        timeoutMs: 25,
    },
});

describe('traffic budget request timeout', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test('marks a request before returning the bounded timeout response', () => {
        const req = buildRequest();
        const res = buildResponse();
        const next = jest.fn();

        budgetRequestTimeout()(req, res, next);
        jest.advanceTimersByTime(25);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.trafficBudgetTimedOut).toBe(true);
        expect(res.statusCode).toBe(503);
        expect(res.body).toMatchObject({
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            requestId: 'request-timeout-test',
        });
    });

    test('clears both response timers immediately before an authoritative mutation', () => {
        const req = buildRequest();
        const res = buildResponse();
        const trafficNext = jest.fn();
        const globalNext = jest.fn();

        budgetRequestTimeout()(req, res, trafficNext);
        createRequestTimeout(50)(req, res, globalNext);
        const started = startTrafficBudgetCommit(req, res);
        jest.advanceTimersByTime(100);

        expect(trafficNext).toHaveBeenCalledTimes(1);
        expect(globalNext).toHaveBeenCalledTimes(1);
        expect(started).toBe(true);
        expect(req.trafficBudgetCommitStarted).toBe(true);
        expect(req.trafficBudgetTimedOut).toBe(false);
        expect(req.requestTimedOut).toBe(false);
        expect(res.json).not.toHaveBeenCalled();
    });

    test('does not start an authoritative mutation after the traffic timeout response won the race', () => {
        const req = buildRequest();
        const res = buildResponse();

        budgetRequestTimeout()(req, res, jest.fn());
        jest.advanceTimersByTime(25);
        const started = startTrafficBudgetCommit(req, res);

        expect(started).toBe(false);
        expect(req.trafficBudgetCommitStarted).not.toBe(true);
    });

    test('does not start an authoritative mutation after the global timeout response won the race', () => {
        const req = buildRequest();
        const res = buildResponse();

        createRequestTimeout(25)(req, res, jest.fn());
        jest.advanceTimersByTime(25);
        const started = startTrafficBudgetCommit(req, res);

        expect(req.requestTimedOut).toBe(true);
        expect(started).toBe(false);
        expect(req.trafficBudgetCommitStarted).not.toBe(true);
        expect(res.body).toMatchObject({ code: 'REQUEST_TIMEOUT' });
    });

    test('allows a completed request body even when Node has released its input stream', () => {
        const req = {
            ...buildRequest(),
            complete: true,
            destroyed: true,
        };
        const res = buildResponse();

        expect(startTrafficBudgetCommit(req, res)).toBe(true);
        expect(req.trafficBudgetCommitStarted).toBe(true);
    });
});
