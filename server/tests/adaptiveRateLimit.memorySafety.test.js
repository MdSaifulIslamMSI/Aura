jest.mock('../security/securityEventLogger', () => ({
    writeSecurityEvent: jest.fn(),
}));

const loadLimiter = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../middleware/adaptiveRateLimit');
};

const runLimiter = (limiter, req) => new Promise((resolve) => {
    let next;
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => {
            resolve({ next, res, req });
            return res;
        }),
        set: jest.fn(),
    };
    next = jest.fn(() => {
        resolve({ next, res, req });
    });
    limiter(req, res, next);
});

const buildReq = ({ ip = '10.0.0.1', originalUrl = '/api/payments/intent' } = {}) => ({
    ip,
    originalUrl,
    headers: {},
    params: {},
    body: {},
});

describe('adaptive rate limit memory safety', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        const { __resetAdaptiveRateLimit } = loadLimiter();
        __resetAdaptiveRateLimit();
    });

    test('rotating query strings reuse one bucket instead of minting new ones', async () => {
        const { adaptiveRateLimit, __adaptiveRateLimitStats } = loadLimiter();
        const limiter = adaptiveRateLimit({ action: 'payment', max: 1000 });

        const counts = [];
        for (const query of ['?x=1', '?x=2', '?x=3']) {
            const { next, req: counted } = await runLimiter(limiter, buildReq({ originalUrl: `/api/payments/intent${query}` }));
            expect(next).toHaveBeenCalled();
            counts.push(counted.adaptiveRateLimit.count);
        }
        expect(counts).toEqual([1, 2, 3]);
        expect(__adaptiveRateLimitStats().size).toBe(1);
    });

    test('bucket store stays bounded under the configured cap', async () => {
        process.env.SECURITY_ADAPTIVE_RATE_LIMIT_MAX_KEYS = '5';
        const { adaptiveRateLimit, __adaptiveRateLimitStats } = loadLimiter();
        const limiter = adaptiveRateLimit({ action: 'payment', max: 1000 });

        for (let i = 0; i < 50; i += 1) {
            const { next } = await runLimiter(limiter, buildReq({
                ip: `10.0.0.${i % 256}`,
                originalUrl: `/api/payments/intent-${i}`,
            }));
            expect(next).toHaveBeenCalled();
        }

        expect(__adaptiveRateLimitStats().size).toBeLessThanOrEqual(5);
    });

    test('expired buckets are swept to make room for live traffic', async () => {
        process.env.SECURITY_ADAPTIVE_RATE_LIMIT_MAX_KEYS = '5';
        const { adaptiveRateLimit, __adaptiveRateLimitStats } = loadLimiter();
        const limiter = adaptiveRateLimit({ action: 'payment', windowMs: 10, max: 1000 });

        for (let i = 0; i < 5; i += 1) {
            await runLimiter(limiter, buildReq({ ip: `10.0.1.${i}`, originalUrl: '/api/payments/intent' }));
        }
        expect(__adaptiveRateLimitStats().size).toBe(5);

        await new Promise((resolve) => setTimeout(resolve, 25));

        for (let i = 0; i < 5; i += 1) {
            const { next } = await runLimiter(limiter, buildReq({ ip: `10.0.2.${i}`, originalUrl: '/api/payments/intent' }));
            expect(next).toHaveBeenCalled();
        }

        expect(__adaptiveRateLimitStats().size).toBeLessThanOrEqual(5);
    });
});
