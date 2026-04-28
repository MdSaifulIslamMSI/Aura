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
        NETLIFY_FRONTEND_URL: '',
        AWS_FRONTEND_URL: '',
        S3_FRONTEND_URL: '',
        ...env,
    };

    const flags = require('../config/corsFlags');
    process.env = previousEnv;
    return flags;
};

describe('corsFlags', () => {
    test('allows all hosted production frontend origins by default', () => {
        const { allowedOrigins, isOriginAllowed } = loadCorsFlags();

        expect(allowedOrigins).toEqual(expect.arrayContaining([
            'https://aurapilot.vercel.app',
            'https://aurapilot.netlify.app',
            'https://dbtrhsolhec1s.cloudfront.net',
            'https://aurapilot.aws.app',
        ]));
        expect(isOriginAllowed('https://aurapilot.vercel.app')).toBe(true);
        expect(isOriginAllowed('https://aurapilot.netlify.app')).toBe(true);
        expect(isOriginAllowed('https://dbtrhsolhec1s.cloudfront.net')).toBe(true);
        expect(isOriginAllowed('https://aurapilot.aws.app')).toBe(true);
    });

    test('still rejects unrelated production origins', () => {
        const { isOriginAllowed } = loadCorsFlags();

        expect(isOriginAllowed('https://example.com')).toBe(false);
    });
});
