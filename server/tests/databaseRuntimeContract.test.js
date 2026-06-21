describe('database runtime production contract', () => {
    const originalEnv = {
        NODE_ENV: process.env.NODE_ENV,
        REDIS_ENABLED: process.env.REDIS_ENABLED,
        REDIS_REQUIRED: process.env.REDIS_REQUIRED,
        REDIS_URL: process.env.REDIS_URL,
        SPLIT_RUNTIME_ENABLED: process.env.SPLIT_RUNTIME_ENABLED,
        DISTRIBUTED_SECURITY_CONTROLS_ENABLED: process.env.DISTRIBUTED_SECURITY_CONTROLS_ENABLED,
    };

    afterEach(() => {
        jest.resetModules();
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    test('requires encrypted MongoDB transport in production', () => {
        const { assertMongoUriContract } = require('../config/db');

        expect(() => assertMongoUriContract({
            NODE_ENV: 'production',
            MONGO_URI: 'mongodb://database.example.invalid:27017/aura',
        })).toThrow(/must use mongodb\+srv or explicitly enable tls=true/i);

        expect(assertMongoUriContract({
            NODE_ENV: 'production',
            MONGO_URI: 'mongodb+srv://database.example.invalid/aura',
        })).toBe('mongodb+srv://database.example.invalid/aura');
    });

    test('uses bounded pools, majority writes, retryable writes, and no implicit production indexing', () => {
        const { buildMongoConnectionOptions } = require('../config/db');
        const options = buildMongoConnectionOptions({ NODE_ENV: 'production' });

        expect(options).toMatchObject({
            maxPoolSize: 10,
            minPoolSize: 0,
            maxConnecting: 2,
            waitQueueTimeoutMS: 10000,
            autoIndex: false,
            retryWrites: true,
            writeConcern: {
                w: 'majority',
                wtimeoutMS: 10000,
            },
        });
    });

    test('requires a writable replica set for split production runtime', () => {
        const { assertMongoDeploymentContract } = require('../config/db');
        const env = { NODE_ENV: 'production', SPLIT_RUNTIME_ENABLED: 'true' };

        expect(() => assertMongoDeploymentContract({
            env,
            health: { replicaSet: false, isWritablePrimary: true },
        })).toThrow(/replica set/i);
        expect(() => assertMongoDeploymentContract({
            env,
            health: { replicaSet: true, isWritablePrimary: false },
        })).toThrow(/writable primary/i);
        expect(() => assertMongoDeploymentContract({
            env,
            health: { replicaSet: true, isWritablePrimary: true },
        })).not.toThrow();
    });

    test('fails closed when required production Redis has no URL', () => {
        process.env.NODE_ENV = 'production';
        process.env.REDIS_ENABLED = 'true';
        process.env.REDIS_REQUIRED = 'true';
        process.env.REDIS_URL = '';

        const { assertProductionRedisConfig } = require('../config/redis');
        expect(() => assertProductionRedisConfig()).toThrow(/REDIS_URL is required/i);
    });
});
