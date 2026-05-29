const crypto = require('crypto');
const fetch = require('node-fetch');
const AppError = require('../../utils/AppError');
const {
    resolveAuthEnvironment,
    validateAuthEnvironment,
} = require('../../config/authEnvironment');
const { verifyOidcAccessToken } = require('./oidcTokenVerifier');

const STATE_COOKIE_NAME = 'aura_keycloak_oidc_state';
const STATE_TTL_MS = 5 * 60 * 1000;
const usedStateDigests = new Map();
let cachedDiscovery = null;

const base64urlJson = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const parseBase64urlJson = (value) => JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
const sha256Base64url = (value) => crypto.createHash('sha256').update(value).digest('base64url');
const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value) => normalizeText(value).toLowerCase();

const normalizeLoginHint = (value = '') => {
    const normalized = normalizeEmail(value);
    if (!normalized || normalized.length > 254) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
};

const getStateSecret = (config = resolveAuthEnvironment()) => normalizeText(
    process.env.AUTH_OIDC_STATE_SECRET
    || process.env.AUTH_VAULT_SECRET
    || config.clientSecret
);

const safeTimingEqual = (left = '', right = '') => {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const signStatePayload = (payload, config = resolveAuthEnvironment()) => {
    const secret = getStateSecret(config);
    if (!secret) {
        throw new AppError('Enterprise login state signing is not configured.', 503);
    }
    const encodedPayload = base64urlJson(payload);
    const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
};

const verifyStateToken = (token, config = resolveAuthEnvironment()) => {
    const secret = getStateSecret(config);
    if (!secret) {
        throw new AppError('Enterprise login state signing is not configured.', 503);
    }

    const [encodedPayload = '', signature = ''] = String(token || '').split('.');
    if (!encodedPayload || !signature) {
        throw new AppError('Enterprise login state is invalid or expired.', 401);
    }

    const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
    if (!safeTimingEqual(signature, expectedSignature)) {
        throw new AppError('Enterprise login state is invalid or expired.', 401);
    }

    const payload = parseBase64urlJson(encodedPayload);
    if (Number(payload.exp || 0) <= Date.now()) {
        throw new AppError('Enterprise login state is invalid or expired.', 401);
    }
    return payload;
};

const parseCookies = (cookieHeader = '') => String(cookieHeader || '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex <= 0) return cookies;
        const key = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
        return cookies;
    }, {});

const serializeCookie = (name, value, options = {}) => {
    const parts = [`${name}=${encodeURIComponent(String(value || ''))}`];
    if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(Number(options.maxAge || 0), 0)}`);
    if (options.path) parts.push(`Path=${options.path}`);
    if (options.httpOnly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');
    if (options.sameSite) parts.push(options.sameSite === 'strict' ? 'SameSite=Strict' : 'SameSite=Lax');
    if (options.expires) parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
    return parts.join('; ');
};

const getCookieOptions = (req = {}) => {
    const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
    return {
        httpOnly: true,
        secure: Boolean(isProduction || req.secure || forwardedProto === 'https'),
        sameSite: 'lax',
        path: '/api/auth/enterprise',
        maxAge: Math.floor(STATE_TTL_MS / 1000),
    };
};

const setStateCookie = (res, token, req = {}) => {
    res.setHeader('Set-Cookie', serializeCookie(STATE_COOKIE_NAME, token, getCookieOptions(req)));
};

const clearStateCookie = (res, req = {}) => {
    res.setHeader('Set-Cookie', serializeCookie(STATE_COOKIE_NAME, '', {
        ...getCookieOptions(req),
        maxAge: 0,
        expires: new Date(0).toISOString(),
    }));
};

const assertKeycloakReady = () => {
    const env = process.env;
    const config = resolveAuthEnvironment(env);
    if (config.provider !== 'keycloak') {
        throw new AppError('Enterprise OIDC login is not enabled.', 404);
    }

    const validation = validateAuthEnvironment({
        env,
        runtimeEnv: env.NODE_ENV || 'development',
        allowPlaceholders: String(env.NODE_ENV || '').toLowerCase() !== 'production',
    });
    if (!validation.safe) {
        throw new AppError('Enterprise OIDC login is not configured.', 503);
    }

    if (!getStateSecret(config)) {
        throw new AppError('Enterprise login state signing is not configured.', 503);
    }

    return config;
};

const loadDiscovery = async (config = assertKeycloakReady()) => {
    if (cachedDiscovery?.issuer === config.issuerUrl) {
        return cachedDiscovery;
    }

    const response = await fetch(config.discoveryUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
        throw new AppError('Enterprise OIDC discovery failed.', 503);
    }
    const discovery = await response.json();
    if (normalizeText(discovery.issuer).replace(/\/+$/, '') !== config.issuerUrl) {
        throw new AppError('Enterprise OIDC issuer mismatch.', 503);
    }
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        if (!normalizeText(discovery[key])) {
            throw new AppError('Enterprise OIDC discovery is incomplete.', 503);
        }
    }
    cachedDiscovery = discovery;
    return discovery;
};

const buildAuthorizationUrl = async ({
    req = {},
    res = null,
    returnTo = '/',
    loginHint = '',
} = {}) => {
    const config = assertKeycloakReady();
    const discovery = await loadDiscovery(config);
    const state = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(24).toString('base64url');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const stateToken = signStatePayload({
        state,
        nonce,
        codeVerifier,
        returnTo: normalizeText(returnTo) || '/',
        exp: Date.now() + STATE_TTL_MS,
    }, config);

    if (res) {
        setStateCookie(res, stateToken, req);
    }

    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
    authorizationUrl.searchParams.set('scope', 'openid profile email');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set('code_challenge', sha256Base64url(codeVerifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    const normalizedLoginHint = normalizeLoginHint(loginHint);
    if (normalizedLoginHint) {
        authorizationUrl.searchParams.set('login_hint', normalizedLoginHint);
    }
    return authorizationUrl.toString();
};

const getStateCookieFromRequest = (req = {}) => (
    parseCookies(req.headers?.cookie || req.headers?.Cookie || '')[STATE_COOKIE_NAME] || ''
);

const pruneUsedStates = () => {
    const now = Date.now();
    for (const [digest, expiresAt] of usedStateDigests.entries()) {
        if (Number(expiresAt || 0) <= now) {
            usedStateDigests.delete(digest);
        }
    }
};

const consumeState = ({ req = {}, state = '' } = {}) => {
    const config = assertKeycloakReady();
    const stateToken = getStateCookieFromRequest(req);
    const payload = verifyStateToken(stateToken, config);
    if (!state || state !== payload.state) {
        throw new AppError('Enterprise login state is invalid or expired.', 401);
    }

    pruneUsedStates();
    const digest = crypto.createHash('sha256').update(stateToken).digest('hex');
    if (usedStateDigests.has(digest)) {
        throw new AppError('Enterprise login state was already used.', 409);
    }
    usedStateDigests.set(digest, Date.now() + STATE_TTL_MS);
    return payload;
};

const exchangeCodeForAuthContext = async ({ code = '', statePayload = {} } = {}) => {
    const config = assertKeycloakReady();
    const discovery = await loadDiscovery(config);
    const tokenBody = new URLSearchParams();
    tokenBody.set('grant_type', 'authorization_code');
    tokenBody.set('code', code);
    tokenBody.set('redirect_uri', config.redirectUri);
    tokenBody.set('code_verifier', normalizeText(statePayload.codeVerifier));

    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (config.clientType === 'confidential') {
        headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
    } else {
        tokenBody.set('client_id', config.clientId);
    }

    const response = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers,
        body: tokenBody.toString(),
    });
    if (!response.ok) {
        throw new AppError('Enterprise authorization code exchange failed.', 401);
    }
    const tokenResponse = await response.json();
    const accessToken = normalizeText(tokenResponse.access_token);
    if (!accessToken) {
        throw new AppError('Enterprise access token is missing.', 401);
    }

    return verifyOidcAccessToken({
        token: accessToken,
        config: {
            ...config,
            jwksUrl: discovery.jwks_uri || config.jwksUrl,
        },
    });
};

const resetKeycloakOidcTestState = () => {
    cachedDiscovery = null;
    usedStateDigests.clear();
};

module.exports = {
    STATE_COOKIE_NAME,
    buildAuthorizationUrl,
    clearStateCookie,
    consumeState,
    exchangeCodeForAuthContext,
    normalizeLoginHint,
    resetKeycloakOidcTestState,
    signStatePayload,
    verifyStateToken,
};
