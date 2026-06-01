const originalEnv = { ...process.env };

const passThrough = (_req, _res, next) => next();

const loadEmailWebhookRoutesWithEnv = (env = {}) => {
    jest.resetModules();
    process.env = {
        ...originalEnv,
        ...env,
    };

    const createDistributedRateLimit = jest.fn(() => passThrough);
    jest.doMock('../middleware/distributedRateLimit', () => ({
        createDistributedRateLimit,
    }));
    jest.doMock('../controllers/emailWebhookController', () => ({
        handleResendWebhook: jest.fn(),
    }));

    require('../routes/emailWebhookRoutes');
    return createDistributedRateLimit;
};

describe('Email webhook rate-limit policy', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../middleware/distributedRateLimit');
        jest.dontMock('../controllers/emailWebhookController');
    });

    test('production Resend webhook limiter fails closed instead of using in-memory fallback', () => {
        const createDistributedRateLimit = loadEmailWebhookRoutesWithEnv({
            NODE_ENV: 'production',
        });

        expect(createDistributedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
            allowInMemoryFallback: false,
            max: 120,
            name: 'email_webhook_resend',
            securityCritical: true,
            windowMs: 60 * 1000,
        }));
    });

    test('non-production Resend webhook limiter preserves local memory fallback', () => {
        const createDistributedRateLimit = loadEmailWebhookRoutesWithEnv({
            NODE_ENV: 'development',
        });

        expect(createDistributedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
            allowInMemoryFallback: true,
            name: 'email_webhook_resend',
            securityCritical: true,
        }));
    });
});
