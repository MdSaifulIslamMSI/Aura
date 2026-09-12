const {
    isOnePasswordReference,
    parseOnePasswordReference,
    resolveOnePasswordConfig,
    primeOnePasswordEnv,
} = require('../config/onePasswordProvider');

const silentLogger = { info: jest.fn(), warn: jest.fn() };

const buildFetcher = () => {
    const calls = [];
    const fetcher = jest.fn(async (url) => {
        calls.push(String(url));
        if (String(url).endsWith('/v1/vaults')) {
            return { ok: true, json: async () => [{ id: 'vault-1', name: 'prod-aura' }] };
        }
        if (String(url).endsWith('/v1/vaults/vault-1/items')) {
            return { ok: true, json: async () => [{ id: 'item-1', title: 'jwt' }] };
        }
        if (String(url).endsWith('/v1/vaults/vault-1/items/item-1')) {
            return {
                ok: true,
                json: async () => ({ fields: [{ id: 'password', label: 'password', value: 'super-secret' }] }),
            };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    });
    return { fetcher, calls };
};

describe('onePasswordProvider', () => {
    test('detects op:// references case-insensitively', () => {
        expect(isOnePasswordReference('op://vault/item/field')).toBe(true);
        expect(isOnePasswordReference('OP://vault/item/field')).toBe(true);
        expect(isOnePasswordReference('ssm:/aura/prod/X')).toBe(false);
        expect(isOnePasswordReference('plain')).toBe(false);
    });

    test('parses vault/item/field and vault/item/section/field', () => {
        expect(parseOnePasswordReference('op://prod-aura/jwt/password')).toEqual({
            vault: 'prod-aura', item: 'jwt', section: '', field: 'password',
        });
        expect(parseOnePasswordReference('op://prod-aura/db/prod/password')).toEqual({
            vault: 'prod-aura', item: 'db', section: 'prod', field: 'password',
        });
        expect(() => parseOnePasswordReference('op://only-two')).toThrow('onepassword_reference_invalid');
        expect(() => parseOnePasswordReference('op://a/b/c/d/e')).toThrow('onepassword_reference_invalid');
    });

    test('stays disabled with no references and no explicit flag', async () => {
        const result = await primeOnePasswordEnv({
            env: { JWT_SECRET: 'already-set' },
            secretKeys: ['JWT_SECRET'],
            logger: silentLogger,
        });
        expect(result.enabled).toBe(false);
        expect(result.source).toBe('onepassword_disabled');
    });

    test('fail-closes when op:// present but Connect config missing', async () => {
        await expect(primeOnePasswordEnv({
            env: { JWT_SECRET: 'op://prod-aura/jwt/password' },
            secretKeys: ['JWT_SECRET'],
            logger: silentLogger,
        })).rejects.toThrow('onepassword_config_missing');
    });

    test('resolves op:// values via Connect without leaking secrets', async () => {
        const { fetcher } = buildFetcher();
        const env = {
            OP_CONNECT_HOST: 'http://connect.local:8080',
            OP_CONNECT_TOKEN: 'token',
            ONEPASSWORD_ENABLED: 'true',
            JWT_SECRET: 'op://prod-aura/jwt/password',
        };
        const result = await primeOnePasswordEnv({ env, secretKeys: ['JWT_SECRET'], logger: silentLogger, fetcher });
        expect(result.enabled).toBe(true);
        expect(result.source).toBe('onepassword_connect');
        expect(env.JWT_SECRET).toBe('super-secret');
        expect(fetcher).toHaveBeenCalled();
        const authHeader = fetcher.mock.calls[0][1].headers.Authorization;
        expect(authHeader).toBe('Bearer token');
    });

    test('error paths never echo token or secret values', async () => {
        const { fetcher } = buildFetcher();
        const env = {
            OP_CONNECT_HOST: 'http://connect.local:8080',
            OP_CONNECT_TOKEN: 'token',
            ONEPASSWORD_ENABLED: 'true',
            JWT_SECRET: 'op://prod-aura/missing-item/password',
        };
        // items list only contains 'jwt', so this must fail closed with a redacted error
        await expect(primeOnePasswordEnv({ env, secretKeys: ['JWT_SECRET'], logger: silentLogger, fetcher }))
            .rejects.toThrow(/onepassword_resolve_failed:JWT_SECRET/);
        try {
            await primeOnePasswordEnv({ env, secretKeys: ['JWT_SECRET'], logger: silentLogger, fetcher });
        } catch (error) {
            expect(String(error.message)).not.toContain('token');
            expect(String(error.message)).not.toContain('super-secret');
        }
    });

    test('enforces the vault allowlist', async () => {
        const { fetcher } = buildFetcher();
        const env = {
            OP_CONNECT_HOST: 'http://connect.local:8080',
            OP_CONNECT_TOKEN: 't',
            ONEPASSWORD_ENABLED: 'true',
            OP_CONNECT_VAULT_ALLOWLIST: 'other-vault',
            JWT_SECRET: 'op://prod-aura/jwt/password',
        };
        await expect(primeOnePasswordEnv({ env, secretKeys: ['JWT_SECRET'], logger: silentLogger, fetcher }))
            .rejects.toThrow(/onepassword_vault_not_allowed/);
        expect(fetcher).not.toHaveBeenCalled();
    });

    test('supports OP_CONNECT_ITEM_MAP for env keys without op:// values', async () => {
        const { fetcher } = buildFetcher();
        const env = {
            OP_CONNECT_HOST: 'http://connect.local:8080',
            OP_CONNECT_TOKEN: 't',
            ONEPASSWORD_ENABLED: 'true',
            OP_CONNECT_ITEM_MAP: JSON.stringify({ JWT_SECRET: 'op://prod-aura/jwt/password' }),
            JWT_SECRET: '',
        };
        const result = await primeOnePasswordEnv({ env, secretKeys: ['JWT_SECRET'], logger: silentLogger, fetcher });
        expect(result.loadedKeys).toEqual(['JWT_SECRET']);
        expect(env.JWT_SECRET).toBe('super-secret');
    });

    test('rejects a malformed OP_CONNECT_ITEM_MAP without applying partial state', async () => {
        const { fetcher } = buildFetcher();
        await expect(primeOnePasswordEnv({
            env: { OP_CONNECT_ITEM_MAP: '{broken', ONEPASSWORD_ENABLED: 'true' },
            secretKeys: ['JWT_SECRET'],
            logger: silentLogger,
            fetcher,
        })).rejects.toThrow('onepassword_item_map_invalid');
    });

    test('resolveOnePasswordConfig clamps timeout and reads provider flag', () => {
        const config = resolveOnePasswordConfig({
            OP_CONNECT_HOST: 'http://x:8080/',
            OP_CONNECT_TOKEN: 't',
            OP_CONNECT_TIMEOUT_MS: '999999',
            RUNTIME_SECRETS_PROVIDER: 'aws-ssm+onepassword',
        });
        expect(config.host).toBe('http://x:8080');
        expect(config.timeoutMs).toBe(30000);
        expect(config.explicitlyEnabled).toBe(true);
    });
});
