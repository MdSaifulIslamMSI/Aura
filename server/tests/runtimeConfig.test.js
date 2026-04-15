const {
    loadLocalEnvFiles,
    primeAwsParameterStoreEnv,
    __testables: {
        isParameterStoreReferencePlaceholder,
        parseExplicitParameterReference,
        resolveParameterNameForEnv,
        resolveParameterPath,
        shouldResolveSecretValue,
    },
} = require('../config/runtimeConfig');

describe('runtimeConfig helpers', () => {
    test('detects AWS Parameter Store reference placeholders', () => {
        expect(isParameterStoreReferencePlaceholder('ssm:/aura/prod/GEMINI_API_KEY')).toBe(true);
        expect(isParameterStoreReferencePlaceholder('ssm:GEMINI_API_KEY')).toBe(true);
        expect(isParameterStoreReferencePlaceholder('plain-value')).toBe(false);
    });

    test('parses explicit parameter references from placeholders', () => {
        expect(parseExplicitParameterReference('ssm:GEMINI_API_KEY', 'fallback-secret')).toBe('GEMINI_API_KEY');
        expect(parseExplicitParameterReference('ssm:/aura/prod/REDIS_URL', 'fallback-secret')).toBe('/aura/prod/REDIS_URL');
        expect(parseExplicitParameterReference('', 'fallback-secret')).toBe('fallback-secret');
    });

    test('resolves default parameter names and prefixed parameter paths from env keys', () => {
        expect(resolveParameterNameForEnv('GEMINI_API_KEY', {})).toBe('GEMINI_API_KEY');
        expect(resolveParameterNameForEnv('MONGO_URI', { MONGO_URI: 'PRIMARY_MONGO_URI' })).toBe('PRIMARY_MONGO_URI');
        expect(resolveParameterPath('GEMINI_API_KEY', '/aura/prod')).toBe('/aura/prod/GEMINI_API_KEY');
    });

    test('only resolves unset or explicit placeholder values', () => {
        expect(shouldResolveSecretValue('')).toBe(true);
        expect(shouldResolveSecretValue('ssm:GEMINI_API_KEY')).toBe(true);
        expect(shouldResolveSecretValue('already-present-value')).toBe(false);
    });

    test('explicitly disabled parameter store bootstrap wins over configured path prefix', async () => {
        const originalEnv = process.env;
        jest.resetModules();
        process.env = {
            ...originalEnv,
            AWS_PARAMETER_STORE_ENABLED: 'false',
            AWS_REGION: 'ap-south-1',
            AWS_PARAMETER_STORE_PATH_PREFIX: '/aura/prod',
        };

        const result = await primeAwsParameterStoreEnv({ logger: { info: jest.fn() } });

        expect(result.enabled).toBe(false);
        expect(result.source).toBe('local_env_only');
        process.env = originalEnv;
        loadLocalEnvFiles();
    });
});
