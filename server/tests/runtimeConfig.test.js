const {
    loadLocalEnvFiles,
    primeAzureKeyVaultEnv,
    __testables: {
        isKeyVaultReferencePlaceholder,
        parseExplicitSecretReference,
        resolveSecretNameForEnv,
        shouldResolveSecretValue,
    },
} = require('../config/runtimeConfig');

describe('runtimeConfig helpers', () => {
    test('detects Azure Key Vault reference placeholders', () => {
        expect(isKeyVaultReferencePlaceholder('@Microsoft.KeyVault(VaultName=test;SecretName=gemini-api-key)')).toBe(true);
        expect(isKeyVaultReferencePlaceholder('kv:gemini-api-key')).toBe(true);
        expect(isKeyVaultReferencePlaceholder('plain-value')).toBe(false);
    });

    test('parses explicit secret references from placeholders', () => {
        expect(parseExplicitSecretReference('kv:gemini-api-key', 'fallback-secret')).toBe('gemini-api-key');
        expect(
            parseExplicitSecretReference('@Microsoft.KeyVault(VaultName=test;SecretName=redis-url)', 'fallback-secret')
        ).toBe('redis-url');
        expect(parseExplicitSecretReference('', 'fallback-secret')).toBe('fallback-secret');
    });

    test('resolves default secret names from env keys', () => {
        expect(resolveSecretNameForEnv('GEMINI_API_KEY', {})).toBe('gemini-api-key');
        expect(resolveSecretNameForEnv('MONGO_URI', { MONGO_URI: 'primary-mongo' })).toBe('primary-mongo');
    });

    test('only resolves unset or explicit placeholder values', () => {
        expect(shouldResolveSecretValue('')).toBe(true);
        expect(shouldResolveSecretValue('kv:gemini-api-key')).toBe(true);
        expect(shouldResolveSecretValue('@Microsoft.KeyVault(VaultName=test;SecretName=gemini-api-key)')).toBe(true);
        expect(shouldResolveSecretValue('already-present-value')).toBe(false);
    });

    test('explicitly disabled key vault bootstrap wins over key vault url presence', async () => {
        const originalEnv = process.env;
        jest.resetModules();
        process.env = {
            ...originalEnv,
            AZURE_KEY_VAULT_ENABLED: 'false',
            AZURE_KEY_VAULT_URL: 'https://example.vault.azure.net',
        };

        const result = await primeAzureKeyVaultEnv({ logger: { info: jest.fn() } });

        expect(result.enabled).toBe(false);
        expect(result.source).toBe('local_env_only');
        process.env = originalEnv;
        loadLocalEnvFiles();
    });
});
