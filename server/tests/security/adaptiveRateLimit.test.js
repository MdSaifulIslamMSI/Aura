const {
    __resetAdaptiveRateLimit,
    adaptiveRateLimit,
} = require('../../middleware/adaptiveRateLimit');

const buildRes = () => ({
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
        this.headers[name] = value;
        return this;
    },
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    },
});

describe('adaptiveRateLimit', () => {
    beforeEach(() => {
        __resetAdaptiveRateLimit();
    });

    test('throttles repeated per-account attempts', () => {
        const limiter = adaptiveRateLimit({
            action: 'auth.login',
            max: 2,
            keyGenerator: () => 'account:user@example.test',
        });
        const req = { ip: '127.0.0.1', headers: {}, user: null };
        const next = jest.fn();

        limiter(req, buildRes(), next);
        limiter(req, buildRes(), next);
        const res = buildRes();
        limiter(req, res, next);

        expect(next).toHaveBeenCalledTimes(2);
        expect(res.statusCode).toBe(429);
        expect(res.body.code).toBe('REQUEST_THROTTLED');
    });

    test('escalates distributed attempts to challenge', () => {
        const limiter = adaptiveRateLimit({
            action: 'auth.mfa.challenge',
            max: 1,
            keyGenerator: () => 'mfa-target:user-1',
        });
        const req = { ip: '127.0.0.1', headers: {}, user: { _id: 'user-1' } };
        const next = jest.fn();

        limiter(req, buildRes(), next);
        limiter(req, buildRes(), next);
        const res = buildRes();
        limiter(req, res, next);

        expect(res.statusCode).toBe(403);
        expect(res.body.step_up_required).toBe(true);
    });
});
