const {
    buildKeycloakJwksUrl,
    normalizeProvider,
    resolveAuthEnvironment,
    validateAuthEnvironment,
} = require('../config/authEnvironment');

describe('authEnvironment', () => {
    test('defaults to rollback-safe legacy provider', () => {
        const result = validateAuthEnvironment({ env: {}, runtimeEnv: 'development' });

        expect(result.safe).toBe(true);
        expect(result.provider).toBe('legacy');
        expect(resolveAuthEnvironment({}).provider).toBe('legacy');
    });

    test('normalizes enterprise OIDC aliases to keycloak', () => {
        expect(normalizeProvider('enterprise_oidc')).toBe('keycloak');
        expect(normalizeProvider('firebase')).toBe('legacy');
    });

    test('fails closed when production keycloak env is incomplete', () => {
        const result = validateAuthEnvironment({
            env: {
                NODE_ENV: 'production',
                AUTH_PROVIDER: 'keycloak',
                AUTH_ISSUER_URL: 'https://sso.example.com/realms/aura',
            },
            runtimeEnv: 'production',
        });

        expect(result.safe).toBe(false);
        expect(result.failures).toEqual(expect.arrayContaining([
            'AUTH_CLIENT_ID is required when AUTH_PROVIDER=keycloak',
            'AUTH_AUDIENCE is required when AUTH_PROVIDER=keycloak',
        ]));
    });

    test('allows placeholders only for non-production example validation', () => {
        const env = {
            AUTH_PROVIDER: 'keycloak',
            AUTH_ISSUER_URL: 'https://keycloak.example.test/realms/aura',
            AUTH_CLIENT_ID: 'aura-web',
            AUTH_CLIENT_TYPE: 'public',
            AUTH_OIDC_STATE_SECRET: 'development-state-secret-placeholder',
            AUTH_AUDIENCE: 'aura-web',
            AUTH_REDIRECT_URI: 'https://app.example.test/auth/callback',
            AUTH_POST_LOGOUT_REDIRECT_URI: 'https://app.example.test/login',
        };

        const dev = validateAuthEnvironment({ env, runtimeEnv: 'development', allowPlaceholders: true });
        const prod = validateAuthEnvironment({ env, runtimeEnv: 'production', allowPlaceholders: false });

        expect(dev.safe).toBe(true);
        expect(dev.warnings.length).toBeGreaterThan(0);
        expect(prod.safe).toBe(false);
        expect(prod.failures.join('\n')).toMatch(/must be replaced/);
    });

    test('builds a production-safe keycloak config with derived JWKS', () => {
        const env = {
            NODE_ENV: 'production',
            AUTH_PROVIDER: 'keycloak',
            AUTH_ISSUER_URL: 'https://idp.company.test/realms/aura',
            AUTH_CLIENT_ID: 'aura-web',
            AUTH_CLIENT_TYPE: 'public',
            AUTH_OIDC_STATE_SECRET: 'prod-state-secret-with-more-than-32-characters',
            AUTH_AUDIENCE: 'aura-web',
            AUTH_REDIRECT_URI: 'https://app.company.test/auth/callback',
            AUTH_POST_LOGOUT_REDIRECT_URI: 'https://app.company.test/login',
            AUTH_REQUIRE_MFA_FOR_ADMIN: 'true',
            MFA_ENABLED: 'true',
            MFA_PASSKEY_ENABLED: 'true',
        };

        const result = validateAuthEnvironment({ env, runtimeEnv: 'production' });

        expect(result.safe).toBe(true);
        expect(result.config.jwksUrl).toBe(buildKeycloakJwksUrl(env.AUTH_ISSUER_URL));
        expect(result.config.allowedClockSkewSeconds).toBe(60);
    });

    test('rejects plain-http Keycloak endpoints in production', () => {
        const result = validateAuthEnvironment({
            env: {
                NODE_ENV: 'production',
                AUTH_PROVIDER: 'keycloak',
                AUTH_ISSUER_URL: 'http://idp.company.test/realms/aura',
                AUTH_CLIENT_ID: 'aura-web',
                AUTH_CLIENT_TYPE: 'public',
                AUTH_OIDC_STATE_SECRET: 'prod-state-secret-with-more-than-32-characters',
                AUTH_AUDIENCE: 'aura-web',
                AUTH_REDIRECT_URI: 'http://app.company.test/auth/callback',
                AUTH_POST_LOGOUT_REDIRECT_URI: 'http://app.company.test/login',
            },
            runtimeEnv: 'production',
        });

        expect(result.safe).toBe(false);
        expect(result.failures.join('\n')).toMatch(/must use https in production/);
    });

    test('fails TOTP MFA validation without a strong encryption key', () => {
        const result = validateAuthEnvironment({
            env: {
                MFA_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'true',
                MFA_SECRET_ENCRYPTION_KEY: 'change-me',
            },
            runtimeEnv: 'production',
        });

        expect(result.safe).toBe(false);
        expect(result.failures.join('\n')).toMatch(/MFA_SECRET_ENCRYPTION_KEY/);
    });

    test('exposes rollback-safe MFA defaults', () => {
        const result = resolveAuthEnvironment({});

        expect(result.mfa).toMatchObject({
            enabled: false,
            totpEnabled: false,
            passkeyEnabled: false,
            recoveryCodesEnabled: true,
            requiredForAdmins: false,
            requiredForSellers: false,
        });
    });

    test('fails closed when production requires admin passkeys but passkey MFA is disabled', () => {
        const result = validateAuthEnvironment({
            env: {
                NODE_ENV: 'production',
                ADMIN_REQUIRE_PASSKEY: 'true',
                MFA_ENABLED: 'false',
                MFA_PASSKEY_ENABLED: 'false',
            },
            runtimeEnv: 'production',
        });

        expect(result.safe).toBe(false);
        expect(result.failures).toEqual(expect.arrayContaining([
            'MFA_ENABLED must be true when production admin passkeys are required',
            'MFA_PASSKEY_ENABLED must be true when production admin passkeys are required',
        ]));
    });

    test('accepts passkey-only MFA for the production admin passkey contract', () => {
        const result = validateAuthEnvironment({
            env: {
                NODE_ENV: 'production',
                ADMIN_REQUIRE_PASSKEY: 'true',
                MFA_ENABLED: 'true',
                MFA_PASSKEY_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'false',
            },
            runtimeEnv: 'production',
        });

        expect(result.safe).toBe(true);
    });
});
