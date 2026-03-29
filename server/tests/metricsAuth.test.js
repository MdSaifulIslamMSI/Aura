describe('metrics auth middleware', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalMetricsSecret = process.env.METRICS_SECRET;
    const originalCronSecret = process.env.CRON_SECRET;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.METRICS_SECRET = originalMetricsSecret;
        process.env.CRON_SECRET = originalCronSecret;
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('fails closed in production when the metrics secret is missing', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.METRICS_SECRET;
        delete process.env.CRON_SECRET;

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {},
            query: {},
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        metricsAuth(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Metrics authentication is not configured',
        });
    });

    test('rejects production requests that only provide the secret in the query string', () => {
        process.env.NODE_ENV = 'production';
        process.env.METRICS_SECRET = 'metrics-secret';

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {},
            query: {
                token: 'metrics-secret',
            },
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        metricsAuth(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Unauthorized',
        });
    });

    test('accepts production requests with a matching header secret', () => {
        process.env.NODE_ENV = 'production';
        process.env.METRICS_SECRET = 'metrics-secret';

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {
                'x-metrics-key': 'metrics-secret',
            },
            query: {},
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        metricsAuth(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('allows non-production requests without a metrics secret', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.METRICS_SECRET;
        delete process.env.CRON_SECRET;

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {},
            query: {},
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        metricsAuth(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });
});
