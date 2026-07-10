const crypto = require('crypto');
const fetch = require('node-fetch');
const {
    STATE_COOKIE_NAME,
    buildAuthorizationUrl,
    consumeState,
    exchangeCodeForAuthContext,
    resetKeycloakOidcTestState,
} = require('../services/auth/keycloakOidcService');

jest.mock('node-fetch');

const issuer = 'https://idp.company.test/realms/aura';
const clientId = 'aura-web';
const discovery = {
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    jwks_uri: `${issuer}/protocol/openid-connect/certs`,
};

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
});
const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'keycloak-service-test-key',
    alg: 'RS256',
    use: 'sig',
};

const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

const signAccessToken = () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = {
        alg: 'RS256',
        kid: jwk.kid,
        typ: 'JWT',
    };
    const payload = {
        iss: issuer,
        aud: clientId,
        sub: 'keycloak-subject-1',
        email: 'enterprise@example.test',
        email_verified: true,
        name: 'Enterprise User',
        iat: nowSeconds,
        exp: nowSeconds + 600,
        amr: ['pwd', 'webauthn'],
    };
    const signingInput = [
        Buffer.from(JSON.stringify(header), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    ].join('.');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
    return `${signingInput}.${signature}`;
};

const configureEnv = () => {
    process.env.AUTH_PROVIDER = 'keycloak';
    process.env.AUTH_ISSUER_URL = issuer;
    process.env.AUTH_CLIENT_ID = clientId;
    process.env.AUTH_CLIENT_TYPE = 'public';
    process.env.AUTH_AUDIENCE = clientId;
    process.env.AUTH_REDIRECT_URI = 'https://app.company.test/auth/enterprise/callback';
    process.env.AUTH_POST_LOGOUT_REDIRECT_URI = 'https://app.company.test/login';
    process.env.AUTH_OIDC_STATE_SECRET = 'keycloak-state-secret-for-tests-only';
};

describe('keycloakOidcService', () => {
    beforeEach(() => {
        jest.resetModules();
        fetch.mockReset();
        resetKeycloakOidcTestState();
        configureEnv();
    });

    afterEach(() => {
        resetKeycloakOidcTestState();
        delete process.env.AUTH_PROVIDER;
        delete process.env.AUTH_ISSUER_URL;
        delete process.env.AUTH_CLIENT_ID;
        delete process.env.AUTH_CLIENT_TYPE;
        delete process.env.AUTH_AUDIENCE;
        delete process.env.AUTH_REDIRECT_URI;
        delete process.env.AUTH_POST_LOGOUT_REDIRECT_URI;
        delete process.env.AUTH_OIDC_STATE_SECRET;
    });

    test('builds a PKCE authorization URL with signed httpOnly state cookie', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(discovery));
        const res = { setHeader: jest.fn() };
        const url = await buildAuthorizationUrl({
            req: { headers: { 'x-forwarded-proto': 'https' } },
            res,
            returnTo: '/admin/dashboard',
            loginHint: 'Admin@Example.Test',
        });

        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe(discovery.authorization_endpoint);
        expect(parsed.searchParams.get('client_id')).toBe(clientId);
        expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
        expect(parsed.searchParams.get('login_hint')).toBe('admin@example.test');
        expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining(`${STATE_COOKIE_NAME}=`));
        expect(res.setHeader.mock.calls[0][1]).toContain('HttpOnly');
        expect(res.setHeader.mock.calls[0][1]).toContain('Secure');
    });

    test('rejects discovery endpoints outside the configured issuer origin', async () => {
        fetch.mockResolvedValueOnce(jsonResponse({
            ...discovery,
            jwks_uri: 'https://attacker.example.test/jwks',
        }));

        await expect(buildAuthorizationUrl({
            req: { headers: {} },
            res: { setHeader: jest.fn() },
            returnTo: '/profile',
        })).rejects.toThrow(/untrusted endpoint/i);
    });

    test('consumes state once and rejects replay', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(discovery));
        const res = { setHeader: jest.fn() };
        const url = await buildAuthorizationUrl({ req: { headers: {} }, res, returnTo: '/profile' });
        const state = new URL(url).searchParams.get('state');
        const cookie = res.setHeader.mock.calls[0][1].split(';')[0];
        const req = { headers: { cookie } };

        expect(consumeState({ req, state })).toEqual(expect.objectContaining({ returnTo: '/profile' }));
        expect(() => consumeState({ req, state })).toThrow(/already used/);
    });

    test('exchanges authorization code and verifies returned access token', async () => {
        const accessToken = signAccessToken();
        fetch
            .mockResolvedValueOnce(jsonResponse(discovery))
            .mockResolvedValueOnce(jsonResponse({ access_token: accessToken, token_type: 'Bearer' }))
            .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }));

        const res = { setHeader: jest.fn() };
        const url = await buildAuthorizationUrl({ req: { headers: {} }, res, returnTo: '/profile' });
        const statePayload = consumeState({
            req: { headers: { cookie: res.setHeader.mock.calls[0][1].split(';')[0] } },
            state: new URL(url).searchParams.get('state'),
        });

        const context = await exchangeCodeForAuthContext({ code: 'auth-code', statePayload });

        expect(context.provider).toBe('keycloak');
        expect(context.authUid).toBe('keycloak:keycloak-subject-1');
        expect(context.identity.email).toBe('enterprise@example.test');
    });
});
