const { getDuoFlags, normalizeDuoApiHost, stripTrailingSlash } = require('../config/duoFlags');
const { normalizeLoginHint } = require('../services/duoOidcService');

describe('Cisco Duo configuration flags', () => {
    test('stays disabled unless explicitly enabled', () => {
        const flags = getDuoFlags({});

        expect(flags).toMatchObject({
            enabled: false,
            failClosed: true,
            configured: false,
        });
    });

    test('supports the Duo Web SDK Universal Prompt contract', () => {
        const flags = getDuoFlags({
            DUO_ENABLED: 'true',
            DUO_CLIENT_ID: 'example-duo-client-id',
            DUO_CLIENT_SECRET: 'example-duo-client-secret',
            DUO_API_HOST: 'https://api-example.duosecurity.com/',
            DUO_REDIRECT_URI: 'https://staging.example.com/api/auth/duo/callback',
        });

        expect(flags).toMatchObject({
            enabled: true,
            failClosed: true,
            mode: 'web-sdk',
            clientId: 'example-duo-client-id',
            clientSecret: 'example-duo-client-secret',
            apiHost: 'api-example.duosecurity.com',
            redirectUri: 'https://staging.example.com/api/auth/duo/callback',
            configured: true,
        });
    });

    test('supports the Generic OIDC relying party contract', () => {
        const flags = getDuoFlags({
            DUO_ENABLED: 'true',
            DUO_CLIENT_ID: 'example-duo-client-id',
            DUO_CLIENT_SECRET: 'example-duo-client-secret',
            DUO_OIDC_ISSUER: 'https://sso-example.sso.duosecurity.com/oidc/example-client-id/',
            DUO_DISCOVERY_URL: 'https://sso-example.sso.duosecurity.com/oidc/example-client-id/.well-known/openid-configuration',
            DUO_REDIRECT_URI: 'https://staging.example.com/api/auth/duo/callback',
        });

        expect(flags).toMatchObject({
            enabled: true,
            failClosed: true,
            mode: 'oidc',
            clientId: 'example-duo-client-id',
            clientSecret: 'example-duo-client-secret',
            oidcIssuer: 'https://sso-example.sso.duosecurity.com/oidc/example-client-id',
            discoveryUrl: 'https://sso-example.sso.duosecurity.com/oidc/example-client-id/.well-known/openid-configuration',
            redirectUri: 'https://staging.example.com/api/auth/duo/callback',
            configured: true,
        });
    });

    test('derives the discovery URL from the OIDC issuer when omitted', () => {
        const flags = getDuoFlags({
            DUO_CLIENT_ID: 'example-duo-client-id',
            DUO_CLIENT_SECRET: 'example-duo-client-secret',
            DUO_OIDC_ISSUER: 'https://sso-example.sso.duosecurity.com/oidc/example-client-id/',
            DUO_REDIRECT_URI: 'https://staging.example.com/api/auth/duo/callback',
        });

        expect(flags.discoveryUrl).toBe('https://sso-example.sso.duosecurity.com/oidc/example-client-id/.well-known/openid-configuration');
        expect(flags.configured).toBe(true);
    });

    test('normalizes Duo API hosts without accepting URL path fragments', () => {
        expect(normalizeDuoApiHost('https://api-12345678.duosecurity.com/')).toBe('api-12345678.duosecurity.com');
        expect(normalizeDuoApiHost('api-12345678.duosecurity.com')).toBe('api-12345678.duosecurity.com');
    });

    test('strips trailing slash from OIDC issuer values', () => {
        expect(stripTrailingSlash('https://sso-example.sso.duosecurity.com/oidc/client/')).toBe('https://sso-example.sso.duosecurity.com/oidc/client');
    });

    test('normalizes safe OIDC login hints without forwarding arbitrary text', () => {
        expect(normalizeLoginHint(' Duo.User@Example.Test ')).toBe('duo.user@example.test');
        expect(normalizeLoginHint('not an email')).toBe('');
        expect(normalizeLoginHint('x'.repeat(255) + '@example.test')).toBe('');
    });
});
