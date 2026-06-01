const originalEnv = { ...process.env };

const passThrough = (_req, _res, next) => next();

const loadI18nRoutesWithEnv = (env = {}) => {
    jest.resetModules();
    process.env = {
        ...originalEnv,
        ...env,
    };

    const createDistributedRateLimit = jest.fn(() => passThrough);
    jest.doMock('../middleware/distributedRateLimit', () => ({
        createDistributedRateLimit,
    }));
    jest.doMock('../middleware/authMiddleware', () => ({
        protectOptional: passThrough,
    }));
    jest.doMock('../controllers/i18nController', () => ({
        translateBatch: jest.fn(),
    }));

    require('../routes/i18nRoutes');
    return createDistributedRateLimit;
};

describe('i18n route rate-limit policy', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../middleware/distributedRateLimit');
        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../controllers/i18nController');
    });

    test('production translation limiter fails closed instead of using memory fallback', () => {
        const createDistributedRateLimit = loadI18nRoutesWithEnv({
            NODE_ENV: 'production',
        });

        expect(createDistributedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
            allowInMemoryFallback: false,
            max: 60,
            name: 'i18n_translate',
            securityCritical: true,
            windowMs: 60 * 1000,
        }));
    });

    test('development translation limiter preserves local memory fallback', () => {
        const createDistributedRateLimit = loadI18nRoutesWithEnv({
            NODE_ENV: 'development',
        });

        expect(createDistributedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
            allowInMemoryFallback: true,
            max: 120,
            name: 'i18n_translate',
            securityCritical: true,
        }));
    });
});
