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

    test('accepts production requests with a matching bearer token', () => {
        process.env.NODE_ENV = 'production';
        process.env.METRICS_SECRET = 'metrics-secret';

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {
                authorization: 'Bearer metrics-secret',
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

    test('rejects production requests with a non-bearer authorization header', () => {
        process.env.NODE_ENV = 'production';
        process.env.METRICS_SECRET = 'metrics-secret';

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {
                authorization: 'Basic metrics-secret',
            },
            query: {},
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

    test('allows non-production requests from loopback without a metrics secret', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.METRICS_SECRET;
        delete process.env.CRON_SECRET;

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {},
            query: {},
            socket: { remoteAddress: '::ffff:127.0.0.1' },
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

    test('rejects non-loopback non-production requests without a metrics secret', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.METRICS_SECRET;
        delete process.env.CRON_SECRET;

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: {},
            query: {},
            socket: { remoteAddress: '203.0.113.10' },
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        metricsAuth(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
    });

    test('accepts non-loopback non-production requests with the metrics secret', () => {
        process.env.NODE_ENV = 'development';
        process.env.METRICS_SECRET = 'metrics-secret';

        const { metricsAuth } = require('../middleware/metrics');
        const req = {
            headers: { 'x-metrics-key': 'metrics-secret' },
            query: {},
            socket: { remoteAddress: '203.0.113.10' },
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
