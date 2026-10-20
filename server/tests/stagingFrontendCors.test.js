const loadCorsFlags = ({ nodeEnv = 'production', env = {} } = {}) => {
    jest.resetModules();
    const previousEnv = process.env;
    process.env = {
        ...previousEnv,
        NODE_ENV: nodeEnv,
        CORS_ORIGIN: '',
        FRONTEND_URL: '',
        APP_PUBLIC_URL: '',
        VERCEL_FRONTEND_URL: '',
        STAGING_FRONTEND_URL: '',
        STAGING_BASE_URL: '',
        VERCEL_STAGING_FRONTEND_URL: '',
        NETLIFY_FRONTEND_URL: '',
        AWS_FRONTEND_URL: '',
        S3_FRONTEND_URL: '',
        APP_ENV: '',
        STAGING_SSM_PREFIX: '',
        ...env,
    };

    const flags = require('../config/corsFlags');
    process.env = previousEnv;
    return flags;
};

describe('staging frontend CORS contract', () => {
    test('staging backend allows only configured staging frontend origins', () => {
        const { isOriginAllowed } = loadCorsFlags({
            env: {
                APP_ENV: 'staging',
                STAGING_SSM_PREFIX: '/aura/staging',
                STAGING_FRONTEND_URL: 'https://aura-staging.vercel.app',
            },
        });

        expect(isOriginAllowed('https://aura-staging.vercel.app')).toBe(true);
        expect(isOriginAllowed('https://aurapilot.vercel.app')).toBe(false);
        expect(isOriginAllowed('https://attacker.example.test')).toBe(false);
    });

    test('production backend keeps production frontend allowlist separate', () => {
        const { isOriginAllowed } = loadCorsFlags({
            env: {
                FRONTEND_URL: 'https://aurapilot.vercel.app',
            },
        });

        expect(isOriginAllowed('https://aurapilot.vercel.app')).toBe(true);
        expect(isOriginAllowed('https://aura-staging.vercel.app')).toBe(false);
    });
});
