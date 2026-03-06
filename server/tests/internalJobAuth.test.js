describe('internal job auth middleware', () => {
    const originalCronSecret = process.env.CRON_SECRET;

    afterEach(() => {
        process.env.CRON_SECRET = originalCronSecret;
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('allows requests with matching bearer secret', () => {
        process.env.CRON_SECRET = 'super-secret';
        const { requireInternalJobAuth } = require('../middleware/internalJobAuth');

        const req = {
            headers: {
                authorization: 'Bearer super-secret',
                'x-vercel-cron': '*/5 * * * *',
                'user-agent': 'vercel-cron/1.0',
            },
            originalUrl: '/api/internal/cron/payment-outbox',
            requestId: 'req_123',
        };
        const res = {};
        const next = jest.fn();

        requireInternalJobAuth(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.internalJob).toEqual({
            source: '*/5 * * * *',
            userAgent: 'vercel-cron/1.0',
        });
    });

    test('rejects requests without matching bearer secret', () => {
        process.env.CRON_SECRET = 'super-secret';
        const { requireInternalJobAuth } = require('../middleware/internalJobAuth');

        const req = {
            headers: {
                authorization: 'Bearer wrong-secret',
                'user-agent': 'curl/8.0',
            },
            originalUrl: '/api/internal/cron/payment-outbox',
            requestId: 'req_456',
        };
        const res = {};
        const next = jest.fn();

        requireInternalJobAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const error = next.mock.calls[0][0];
        expect(error).toBeTruthy();
        expect(error.statusCode).toBe(401);
    });
});
