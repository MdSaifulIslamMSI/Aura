const {
    __testables: {
        evaluateStagingSmokeSafety,
        looksProductionLike,
    },
} = require('../scripts/assert_staging_smoke_safety');

describe('staging smoke safety preflight', () => {
    test('allows default public smoke only for local read-only target', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_FLOW_MODE: 'public',
                SMOKE_BASE_URL: 'http://127.0.0.1:5000',
            },
        });

        expect(result.ok).toBe(true);
        expect(result.mutating).toBe(false);
    });

    test('blocks mutating customer smoke without explicit staging isolation', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_FLOW_MODE: 'customer',
                SMOKE_BASE_URL: 'https://api.staging.example.test',
            },
        });

        expect(result.ok).toBe(false);
        expect(result.failures.join('\n')).toMatch(/SMOKE_TARGET_ENV=staging/);
        expect(result.failures.join('\n')).toMatch(/SMOKE_STAGING_ISOLATED=true/);
    });

    test('blocks staging smoke when SMOKE_BASE_URL is missing', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_TARGET_ENV: 'staging',
                STAGING_API_BASE_URL: 'https://api.staging.example.test',
                STAGING_SSM_PREFIX: '/aura/staging',
            },
        });

        expect(result.ok).toBe(false);
        expect(result.failures.join('\n')).toMatch(/SMOKE_BASE_URL is required/);
    });

    test('blocks account bootstrap without explicit staging isolation', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'bootstrap',
            env: {
                SMOKE_TARGET_ENV: 'staging',
                MONGO_URI: 'mongodb+srv://cluster.staging.example.test/aura_staging',
                FIREBASE_PROJECT_ID: 'aura-staging',
            },
        });

        expect(result.ok).toBe(false);
        expect(result.failures.join('\n')).toMatch(/SMOKE_STAGING_ISOLATED=true/);
    });

    test('blocks known production-like targets even with staging intent', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_TARGET_ENV: 'staging',
                SMOKE_STAGING_ISOLATED: 'true',
                SMOKE_FLOW_MODE: 'customer',
                SMOKE_BASE_URL: 'https://aurapilot.vercel.app',
                STAGING_API_BASE_URL: 'https://api.staging.example.test',
                STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
                STAGING_SSM_PREFIX: '/aura/staging',
                MONGO_URI: 'mongodb+srv://cluster.staging.example.test/aura_staging',
                FIREBASE_PROJECT_ID: 'aura-staging',
                STRIPE_SECRET_KEY: 'sk_test_123',
                RAZORPAY_KEY_ID: 'rzp_test_123',
            },
        });

        expect(result.ok).toBe(false);
        expect(result.failures.join('\n')).toMatch(/known production/);
    });

    test('blocks staging smoke when SSM prefix points to production', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_TARGET_ENV: 'staging',
                SMOKE_BASE_URL: 'https://api.staging.example.test',
                STAGING_API_BASE_URL: 'https://api.staging.example.test',
                STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
                STAGING_SSM_PREFIX: '/aura/prod',
            },
        });

        expect(result.ok).toBe(false);
        expect(result.failures.join('\n')).toMatch(/STAGING_SSM_PREFIX must be \/aura\/staging/);
    });

    test('blocks Vercel preview URLs while backend routes proxy to production', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_TARGET_ENV: 'staging',
                SMOKE_BASE_URL: 'https://aura-cart-fix-preview-example-mdsaifulislammsis-projects.vercel.app',
                STAGING_API_BASE_URL: 'https://api.staging.example.test',
                STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
                STAGING_SSM_PREFIX: '/aura/staging',
            },
        });

        expect(result.ok).toBe(false);
        expect(result.failures.join('\n')).toMatch(/Vercel Preview URL cannot be used as backend staging/);
    });

    test('allows mutating smoke when all visible signals are staging-only', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_TARGET_ENV: 'staging',
                SMOKE_STAGING_ISOLATED: 'true',
                SMOKE_FLOW_MODE: 'full',
                SMOKE_BASE_URL: 'https://api.staging.example.test',
                STAGING_API_BASE_URL: 'https://api.staging.example.test',
                STAGING_HEALTH_URL: 'https://api.staging.example.test/health',
                STAGING_SSM_PREFIX: '/aura/staging',
                MONGO_URI: 'mongodb+srv://cluster.staging.example.test/aura_staging',
                REDIS_URL: 'rediss://redis.staging.example.test:6380',
                FIREBASE_PROJECT_ID: 'aura-staging',
                STRIPE_SECRET_KEY: 'sk_test_123',
                STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
                RAZORPAY_KEY_ID: 'rzp_test_123',
            },
        });

        expect(result.ok).toBe(true);
        expect(result.mutating).toBe(true);
    });

    test('blocks production smoke unless explicitly allowed', () => {
        const result = evaluateStagingSmokeSafety({
            purpose: 'smoke',
            env: {
                SMOKE_TARGET_ENV: 'production',
                SMOKE_BASE_URL: 'https://dbtrhsolhec1s.cloudfront.net',
            },
        });

        expect(result.ok).toBe(false);
        expect(result.failures.join('\n')).toMatch(/ALLOW_PRODUCTION_SMOKE=true/);
    });

    test('recognizes live payment keys as production-like', () => {
        expect(looksProductionLike('sk_live_secret')).toBe(true);
        expect(looksProductionLike('rzp_live_secret')).toBe(true);
        expect(looksProductionLike('rzp_test_secret')).toBe(false);
    });
});
