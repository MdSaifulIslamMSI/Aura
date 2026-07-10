const crypto = require('crypto');
const {
    mapOidcClaimsToAuthContext,
    verifyOidcAccessToken,
} = require('../services/auth/oidcTokenVerifier');

const issuer = 'https://idp.company.test/realms/aura';
const audience = 'aura-web';
const clientId = 'aura-web';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
});

const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
};

const config = {
    provider: 'keycloak',
    issuerUrl: issuer,
    audience,
    clientId,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
    allowedAlgorithms: ['RS256'],
    allowedClockSkewSeconds: 30,
};

const signToken = (claims = {}, header = {}) => {
    const nowSeconds = 1_700_000_000;
    const jwtHeader = {
        alg: 'RS256',
        kid: jwk.kid,
        typ: 'JWT',
        ...header,
    };
    const payload = {
        iss: issuer,
        aud: audience,
        sub: 'keycloak-user-1',
        email: 'user@example.test',
        email_verified: true,
        name: 'Keycloak User',
        iat: nowSeconds,
        exp: nowSeconds + 600,
        amr: ['pwd', 'webauthn'],
        realm_access: { roles: ['user', 'admin'] },
        ...claims,
    };
    const signingInput = [
        Buffer.from(JSON.stringify(jwtHeader), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    ].join('.');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
    return `${signingInput}.${signature}`;
};

const algNoneToken = () => {
    const signingInput = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify({
            iss: issuer,
            aud: audience,
            sub: 'keycloak-user-1',
            exp: 1_700_000_600,
        }), 'utf8').toString('base64url'),
    ].join('.');
    return `${signingInput}.c2ln`;
};

describe('oidcTokenVerifier', () => {
    test('validates a signed Keycloak access token and maps internal identity', async () => {
        const context = await verifyOidcAccessToken({
            token: signToken(),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        });

        expect(context.provider).toBe('keycloak');
        expect(context.authUid).toBe('keycloak:keycloak-user-1');
        expect(context.identity.emailVerified).toBe(true);
        expect(context.roles).toEqual(expect.arrayContaining(['user', 'admin']));
        expect(context.authToken.firebase.sign_in_provider).toBe('keycloak');
    });

    test('rejects unsigned alg none tokens', async () => {
        await expect(verifyOidcAccessToken({
            token: algNoneToken(),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/Unsigned tokens are not accepted/);
    });

    test('rejects expired tokens', async () => {
        await expect(verifyOidcAccessToken({
            token: signToken({ exp: 1_699_999_000 }),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/expired/);
    });

    test('rejects malformed NumericDate claims', async () => {
        await expect(verifyOidcAccessToken({
            token: signToken({ exp: 'not-a-number' }),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/expired/);

        await expect(verifyOidcAccessToken({
            token: signToken({ nbf: 'not-a-number' }),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/not active/);

        await expect(verifyOidcAccessToken({
            token: signToken({ iat: 'not-a-number' }),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/issued-at/);
    });

    test('rejects a mismatched authorized party for multi-audience tokens', async () => {
        await expect(verifyOidcAccessToken({
            token: signToken({
                aud: [audience, 'other-api'],
                azp: 'other-client',
            }),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/authorized party/);
    });

    test('rejects wrong issuer and wrong audience', async () => {
        await expect(verifyOidcAccessToken({
            token: signToken({ iss: 'https://evil.example.test/realms/aura' }),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/issuer/);

        await expect(verifyOidcAccessToken({
            token: signToken({ aud: 'other-client' }),
            config,
            jwks: { keys: [jwk] },
            nowSeconds: 1_700_000_100,
        })).rejects.toThrow(/audience/);
    });

    test('does not map external identity by trusting email alone', () => {
        const context = mapOidcClaimsToAuthContext({
            sub: 'stable-subject',
            email: 'User@Example.Test',
            email_verified: true,
        }, config);

        expect(context.authUid).toBe('keycloak:stable-subject');
        expect(context.identity.email).toBe('user@example.test');
    });
});
