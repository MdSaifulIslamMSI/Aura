const crypto = require('crypto');
const request = require('supertest');
const fetch = require('node-fetch');
const app = require('../index');
const User = require('../models/User');
const {
    STATE_COOKIE_NAME,
    resetDuoOidcTestState,
    verifyIdToken,
} = require('../services/duoOidcService');

jest.mock('node-fetch');

const issuer = 'https://sso-example.sso.duosecurity.com/oidc/example-client-id';
const clientId = 'example-duo-client-id';
const clientSecret = 'example-duo-client-secret-that-is-only-for-tests';
const redirectUri = 'https://api.example.test/api/auth/duo/callback';
const discovery = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
};

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
});
const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'duo-test-key',
    alg: 'RS256',
    use: 'sig',
};

const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

const signIdToken = (claims = {}, header = {}) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const protectedHeader = {
        alg: 'RS256',
        kid: jwk.kid,
        typ: 'JWT',
        ...header,
    };
    const payload = {
        iss: issuer,
        aud: clientId,
        sub: 'duo-user-123',
        email: 'duo.user@example.test',
        name: 'Duo User',
        email_verified: true,
        iat: nowSeconds,
        auth_time: nowSeconds,
        exp: nowSeconds + 3600,
        ...claims,
    };
    const signingInput = [
        Buffer.from(JSON.stringify(protectedHeader), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    ].join('.');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
    return `${signingInput}.${signature}`;
};

const buildAlgNoneToken = () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify({
            iss: issuer,
            aud: clientId,
            sub: 'duo-user-123',
            email: 'duo.user@example.test',
            nonce: 'nonce',
            iat: nowSeconds,
            exp: nowSeconds + 3600,
        }), 'utf8').toString('base64url'),
        '',
    ].join('.');
};

const getCookieValue = (setCookieHeaders = [], name) => {
    const header = setCookieHeaders.find((entry) => String(entry || '').startsWith(`${name}=`));
    if (!header) return '';
    return String(header).split(';')[0];
};

const configureDuoEnv = () => {
    process.env.DUO_ENABLED = 'true';
    process.env.DUO_CLIENT_ID = clientId;
    process.env.DUO_CLIENT_SECRET = clientSecret;
    process.env.DUO_OIDC_ISSUER = issuer;
    process.env.DUO_DISCOVERY_URL = `${issuer}/.well-known/openid-configuration`;
    process.env.DUO_REDIRECT_URI = redirectUri;
    process.env.DUO_FAIL_CLOSED = 'true';
    process.env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK = 'true';
};

describe('Duo OIDC security flow', () => {
    beforeEach(() => {
        configureDuoEnv();
        resetDuoOidcTestState();
        fetch.mockReset();
    });

    afterEach(() => {
        resetDuoOidcTestState();
        delete process.env.DUO_ENABLED;
        delete process.env.DUO_CLIENT_ID;
        delete process.env.DUO_CLIENT_SECRET;
        delete process.env.DUO_OIDC_ISSUER;
        delete process.env.DUO_DISCOVERY_URL;
        delete process.env.DUO_REDIRECT_URI;
        delete process.env.DUO_FAIL_CLOSED;
    });

    test('starts Duo login with signed state cookie and OIDC nonce', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(discovery));

        const res = await request(app).get('/api/auth/duo/start?returnTo=/profile');

        expect(res.status).toBe(302);
        const location = new URL(res.headers.location);
        expect(location.origin + location.pathname).toBe(discovery.authorization_endpoint);
        expect(location.searchParams.get('client_id')).toBe(clientId);
        expect(location.searchParams.get('redirect_uri')).toBe(redirectUri);
        expect(location.searchParams.get('scope')).toBe('openid profile email');
        expect(location.searchParams.get('state')).toEqual(expect.any(String));
        expect(location.searchParams.get('nonce')).toEqual(expect.any(String));
        expect(location.searchParams.get('code_challenge')).toEqual(expect.any(String));
        expect(location.searchParams.get('code_challenge_method')).toBe('S256');
        expect(getCookieValue(res.headers['set-cookie'], STATE_COOKIE_NAME)).toContain(`${STATE_COOKIE_NAME}=`);
    });

    test('callback creates a normal server session without granting admin fields', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(discovery));
        const start = await request(app).get('/api/auth/duo/start?returnTo=/profile');
        const authorizationUrl = new URL(start.headers.location);
        const state = authorizationUrl.searchParams.get('state');
        const nonce = authorizationUrl.searchParams.get('nonce');
        const stateCookie = getCookieValue(start.headers['set-cookie'], STATE_COOKIE_NAME);
        const idToken = signIdToken({ nonce });

        fetch
            .mockResolvedValueOnce(jsonResponse({ id_token: idToken, token_type: 'Bearer' }))
            .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }));

        const beforeCount = await User.countDocuments();
        const callback = await request(app)
            .get(`/api/auth/duo/callback?code=valid-code&state=${encodeURIComponent(state)}`)
            .set('Cookie', stateCookie);
        const afterUser = await User.findOne({ email: 'duo.user@example.test' }).lean();

        expect(callback.status).toBe(302);
        expect(String(fetch.mock.calls[1][1].body)).toContain('code_verifier=');
        expect(callback.headers.location).toBe('/profile?duo=success');
        expect(getCookieValue(callback.headers['set-cookie'], 'aura_sid')).toContain('aura_sid=');
        expect(await User.countDocuments()).toBe(beforeCount + 1);
        expect(afterUser).toMatchObject({
            email: 'duo.user@example.test',
            authUid: 'duo:duo-user-123',
            isAdmin: false,
            adminRoles: [],
            isVerified: true,
        });
    });

    test('rejects missing state before any database mutation', async () => {
        const beforeCount = await User.countDocuments();

        const res = await request(app).get('/api/auth/duo/callback?code=valid-code');

        expect(res.status).toBe(422);
        expect(await User.countDocuments()).toBe(beforeCount);
        expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects tampered state before exchanging the authorization code', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(discovery));
        const start = await request(app).get('/api/auth/duo/start?returnTo=/profile');
        const authorizationUrl = new URL(start.headers.location);
        const stateCookie = getCookieValue(start.headers['set-cookie'], STATE_COOKIE_NAME);
        const beforeCount = await User.countDocuments();
        fetch.mockClear();

        const res = await request(app)
            .get(`/api/auth/duo/callback?code=valid-code&state=${encodeURIComponent(`${authorizationUrl.searchParams.get('state')}x`)}`)
            .set('Cookie', stateCookie);

        expect(res.status).toBe(401);
        expect(await User.countDocuments()).toBe(beforeCount);
        expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects replayed state and leaves the original account unchanged', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(discovery));
        const start = await request(app).get('/api/auth/duo/start?returnTo=/profile');
        const authorizationUrl = new URL(start.headers.location);
        const state = authorizationUrl.searchParams.get('state');
        const nonce = authorizationUrl.searchParams.get('nonce');
        const stateCookie = getCookieValue(start.headers['set-cookie'], STATE_COOKIE_NAME);

        fetch
            .mockResolvedValueOnce(jsonResponse({ id_token: signIdToken({ nonce }), token_type: 'Bearer' }))
            .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }));

        await request(app)
            .get(`/api/auth/duo/callback?code=valid-code&state=${encodeURIComponent(state)}`)
            .set('Cookie', stateCookie)
            .expect(302);
        const afterFirstSuccessCount = await User.countDocuments();
        fetch.mockClear();

        const replay = await request(app)
            .get(`/api/auth/duo/callback?code=valid-code&state=${encodeURIComponent(state)}`)
            .set('Cookie', stateCookie);

        expect(replay.status).toBe(409);
        expect(await User.countDocuments()).toBe(afterFirstSuccessCount);
        expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects alg=none identity tokens', async () => {
        await expect(verifyIdToken({
            idToken: buildAlgNoneToken(),
            nonce: 'nonce',
            discovery,
        })).rejects.toMatchObject({ statusCode: 401 });
    });
});
