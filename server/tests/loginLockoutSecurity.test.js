'use strict';

jest.mock('../config/redis', () => ({
    getRedisClient: () => null,
    flags: { redisPrefix: 'aura_test' },
}));

const {
    parseMode,
    resolveLockMs,
    buildAccountKey,
    recordAuthFailure,
    recordAuthSuccess,
    evaluateAccountLockout,
    LOCKOUT_STEPS,
} = require('../services/loginLockoutService');
const {
    loginLockoutGate,
    authFailureRecorder,
} = require('../middleware/loginLockoutGate');
const { assertProductionTurnstileConfig, getTurnstileFlags } = require('../config/turnstileFlags');
const fs = require('fs');
const path = require('path');

const uniqueIdentity = (tag) => ({
    uid: '',
    email: `lockout-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    phone: '',
    ip: '10.0.0.1',
});

const makeRes = () => {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        finishHandlers: [],
        on(event, handler) {
            if (event === 'finish') this.finishHandlers.push(handler);
            return res;
        },
        set(key, value) {
            this.headers[key] = value;
            return res;
        },
        status(code) {
            this.statusCode = code;
            return res;
        },
        json(payload) {
            this.body = payload;
            return res;
        },
        emitFinish() {
            this.finishHandlers.forEach((handler) => handler());
        },
    };
    return res;
};

const makeReq = (identity) => ({
    method: 'POST',
    ip: identity.ip,
    body: { email: identity.email },
    requestId: 'test-req',
});

describe('loginLockoutService', () => {
    const originalMode = process.env.AUTH_LOCKOUT_MODE;

    afterEach(() => {
        if (originalMode === undefined) delete process.env.AUTH_LOCKOUT_MODE;
        else process.env.AUTH_LOCKOUT_MODE = originalMode;
    });

    it('defaults to off and accepts only known modes', () => {
        delete process.env.AUTH_LOCKOUT_MODE;
        expect(parseMode()).toBe('off');
        process.env.AUTH_LOCKOUT_MODE = 'monitor';
        expect(parseMode()).toBe('monitor');
        process.env.AUTH_LOCKOUT_MODE = 'enforce';
        expect(parseMode()).toBe('enforce');
        process.env.AUTH_LOCKOUT_MODE = 'bogus';
        expect(parseMode()).toBe('off');
    });

    it('builds deterministic keys that differ by identity', () => {
        const a = buildAccountKey({ email: 'a@example.com', ip: '1.1.1.1' });
        const b = buildAccountKey({ email: 'a@example.com', ip: '1.1.1.1' });
        const c = buildAccountKey({ email: 'b@example.com', ip: '1.1.1.1' });
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it('escalates lock duration through the configured steps', () => {
        expect(resolveLockMs(1)).toBe(0);
        expect(resolveLockMs(LOCKOUT_STEPS[0].minFailures)).toBe(5 * 60 * 1000);
        expect(resolveLockMs(LOCKOUT_STEPS[1].minFailures)).toBe(15 * 60 * 1000);
        expect(resolveLockMs(LOCKOUT_STEPS[2].minFailures)).toBe(60 * 60 * 1000);
    });

    it('locks an account after the failure threshold and reports retry time', async () => {
        const identity = uniqueIdentity('lock');
        for (let i = 0; i < LOCKOUT_STEPS[0].minFailures; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await recordAuthFailure({ ...identity, surface: 'otp' });
        }
        const state = await evaluateAccountLockout(identity);
        expect(state.locked).toBe(true);
        expect(state.retryAfterMs).toBeGreaterThan(0);
    });

    it('clears the lock after a successful authentication', async () => {
        const identity = uniqueIdentity('reset');
        for (let i = 0; i < LOCKOUT_STEPS[0].minFailures; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await recordAuthFailure({ ...identity, surface: 'auth' });
        }
        await recordAuthSuccess(identity);
        const state = await evaluateAccountLockout(identity);
        expect(state.locked).toBe(false);
        expect(state.failures).toBe(0);
    });

    it('does not lock below the threshold', async () => {
        const identity = uniqueIdentity('low');
        await recordAuthFailure({ ...identity, surface: 'auth' });
        await recordAuthFailure({ ...identity, surface: 'auth' });
        const state = await evaluateAccountLockout(identity);
        expect(state.locked).toBe(false);
        expect(state.failures).toBe(2);
    });
});

describe('loginLockoutGate', () => {
    const originalMode = process.env.AUTH_LOCKOUT_MODE;

    afterEach(async () => {
        if (originalMode === undefined) delete process.env.AUTH_LOCKOUT_MODE;
        else process.env.AUTH_LOCKOUT_MODE = originalMode;
        await Promise.resolve();
    });

    it('passes every request through when the mode is off', async () => {
        delete process.env.AUTH_LOCKOUT_MODE;
        const identity = uniqueIdentity('off');
        for (let i = 0; i < LOCKOUT_STEPS[0].minFailures + 1; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await recordAuthFailure({ ...identity, surface: 'auth' });
        }
        const req = makeReq(identity);
        const res = makeRes();
        const next = jest.fn();
        await loginLockoutGate({ surface: 'auth' })(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 429 with Retry-After for a locked account in enforce mode', async () => {
        process.env.AUTH_LOCKOUT_MODE = 'enforce';
        const identity = uniqueIdentity('enforce');
        for (let i = 0; i < LOCKOUT_STEPS[0].minFailures; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await recordAuthFailure({ ...identity, surface: 'auth' });
        }
        const req = makeReq(identity);
        const res = makeRes();
        const next = jest.fn();
        await loginLockoutGate({ surface: 'auth' })(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(429);
        expect(res.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
        expect(res.headers['Retry-After']).toBeDefined();
    });

    it('never blocks in monitor mode but records the observation', async () => {
        process.env.AUTH_LOCKOUT_MODE = 'monitor';
        const identity = uniqueIdentity('monitor');
        for (let i = 0; i < LOCKOUT_STEPS[0].minFailures; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await recordAuthFailure({ ...identity, surface: 'auth' });
        }
        const req = makeReq(identity);
        const res = makeRes();
        const next = jest.fn();
        await loginLockoutGate({ surface: 'auth' })(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
    });

    it('counts 401 responses as failures and clears on success', async () => {
        process.env.AUTH_LOCKOUT_MODE = 'monitor';
        const identity = uniqueIdentity('recorder');
        const req = makeReq(identity);

        const failedRes = makeRes();
        failedRes.statusCode = 401;
        await loginLockoutGate({ surface: 'auth' })(req, failedRes, jest.fn());
        failedRes.emitFinish();

        const state = await evaluateAccountLockout(identity);
        expect(state.failures).toBe(1);

        const okRes = makeRes();
        okRes.statusCode = 200;
        await loginLockoutGate({ surface: 'auth' })(req, okRes, jest.fn());
        okRes.emitFinish();

        const cleared = await evaluateAccountLockout(identity);
        expect(cleared.failures).toBe(0);
    });

    it('skips GET requests entirely', async () => {
        process.env.AUTH_LOCKOUT_MODE = 'enforce';
        const identity = uniqueIdentity('get');
        for (let i = 0; i < LOCKOUT_STEPS[0].minFailures; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await recordAuthFailure({ ...identity, surface: 'auth' });
        }
        const req = { ...makeReq(identity), method: 'GET' };
        const res = makeRes();
        const next = jest.fn();
        await loginLockoutGate({ surface: 'auth' })(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});

describe('authFailureRecorder', () => {
    it('records 401 errors and forwards the error untouched', async () => {
        const identity = uniqueIdentity('errrec');
        const req = makeReq(identity);
        const err = Object.assign(new Error('bad proof'), { statusCode: 401 });
        const next = jest.fn();
        authFailureRecorder({ surface: 'otp' })(err, req, {}, next);
        await Promise.resolve();
        await Promise.resolve();
        const state = await evaluateAccountLockout(identity);
        expect(state.failures).toBe(1);
        expect(next).toHaveBeenCalledWith(err);
    });

    it('ignores non-401 errors', async () => {
        const identity = uniqueIdentity('errskip');
        const err = Object.assign(new Error('bad request'), { statusCode: 400 });
        const next = jest.fn();
        authFailureRecorder({ surface: 'otp' })(err, makeReq(identity), {}, next);
        await Promise.resolve();
        const state = await evaluateAccountLockout(identity);
        expect(state.failures).toBe(0);
        expect(next).toHaveBeenCalledWith(err);
    });
});

describe('assertProductionTurnstileConfig', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env.NODE_ENV = originalEnv.NODE_ENV;
        process.env.TURNSTILE_ENABLED = originalEnv.TURNSTILE_ENABLED;
        process.env.TURNSTILE_SECRET_KEY = originalEnv.TURNSTILE_SECRET_KEY;
    });

    it('throws in production when Turnstile is not enabled with a secret', () => {
        process.env.NODE_ENV = 'production';
        process.env.TURNSTILE_ENABLED = 'true';
        process.env.TURNSTILE_SECRET_KEY = '';
        expect(() => assertProductionTurnstileConfig()).toThrow(/TURNSTILE_ENABLED with TURNSTILE_SECRET_KEY is required/);
    });

    it('passes in production when enabled with a secret', () => {
        process.env.NODE_ENV = 'production';
        process.env.TURNSTILE_ENABLED = 'true';
        process.env.TURNSTILE_SECRET_KEY = 'secret';
        expect(() => assertProductionTurnstileConfig()).not.toThrow();
    });

    it('warns instead of throwing outside production', () => {
        process.env.NODE_ENV = 'staging';
        process.env.TURNSTILE_ENABLED = 'false';
        const warnings = [];
        const log = { warn: (message) => warnings.push(message) };
        expect(() => assertProductionTurnstileConfig(process.env, log)).not.toThrow();
        expect(warnings.length).toBe(1);
        expect(getTurnstileFlags(process.env).enabled).toBe(false);
    });
});

describe('phase 5A wiring contracts', () => {
    const serverRoot = path.join(__dirname, '..');

    it('keeps the global JSON body limit tightened with scoped large parsers', () => {
        const indexSource = fs.readFileSync(path.join(serverRoot, 'index.js'), 'utf8');
        expect(indexSource).toMatch(/JSON_BODY_LIMIT = process\.env\.JSON_BODY_LIMIT \|\| '256kb'/);
        expect(indexSource).toMatch(/LARGE_JSON_BODY_LIMIT/);
        expect(indexSource).toContain("'/api/uploads', '/api/listings', '/api/ai'");
    });

    it('mounts the lockout gate and adaptive limiter on auth, otp, and payment routers', () => {
        const authSource = fs.readFileSync(path.join(serverRoot, 'routes', 'authRoutes.js'), 'utf8');
        const otpSource = fs.readFileSync(path.join(serverRoot, 'routes', 'otpRoutes.js'), 'utf8');
        const paymentSource = fs.readFileSync(path.join(serverRoot, 'routes', 'paymentRoutes.js'), 'utf8');
        expect(authSource).toContain("loginLockoutGate({ surface: 'auth' })");
        expect(authSource).toContain("authFailureRecorder({ surface: 'auth' })");
        expect(authSource).toContain("adaptiveRateLimit({ action: 'auth'");
        expect(otpSource).toContain("loginLockoutGate({ surface: 'otp' })");
        expect(otpSource).toContain("authFailureRecorder({ surface: 'otp' })");
        expect(otpSource).toContain("adaptiveRateLimit({ action: 'otp'");
        expect(paymentSource).toContain("adaptiveRateLimit({ action: 'payment'");
    });

    it('requires the turnstile production assert at startup', () => {
        const indexSource = fs.readFileSync(path.join(serverRoot, 'index.js'), 'utf8');
        expect(indexSource).toContain('assertProductionTurnstileConfig()');
    });
});
