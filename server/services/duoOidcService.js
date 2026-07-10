const crypto = require('crypto');
const fetch = require('node-fetch');
const AppError = require('../utils/AppError');
const { getDuoFlags } = require('../config/duoFlags');
const { withTimeout } = require('../utils/timeout');

const STATE_COOKIE_NAME = 'aura_duo_oidc_state';
const STATE_TTL_MS = 5 * 60 * 1000;
const OIDC_HTTP_TIMEOUT_MS = 10 * 1000;
const usedStateDigests = new Map();
let cachedDiscovery = null;
let cachedDiscoveryUrl = '';

const base64urlJson = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const parseBase64urlJson = (value) => JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
const sha256Base64url = (value) => crypto.createHash('sha256').update(value).digest('base64url');

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value) => normalizeText(value).toLowerCase();

const fetchOidc = (url, options, label) => withTimeout(
    ({ signal }) => fetch(url, { ...options, signal }),
    {
        label,
        timeoutMs: OIDC_HTTP_TIMEOUT_MS,
        code: 'DUO_OIDC_TIMEOUT',
        statusCode: 503,
    }
);

const assertTrustedHttpsEndpoint = (value, expectedOrigin = '') => {
    try {
        const endpoint = new URL(normalizeText(value));
        if (
            endpoint.protocol !== 'https:'
            || endpoint.username
            || endpoint.password
            || (expectedOrigin && endpoint.origin !== expectedOrigin)
        ) {
            throw new Error('untrusted endpoint');
        }
        return endpoint;
    } catch {
        throw new AppError('Duo OIDC discovery contains an untrusted endpoint.', 503);
    }
};

const getStateSecret = (flags) => normalizeText(process.env.DUO_OIDC_STATE_SECRET) || flags.clientSecret;

const signStatePayload = (payload, flags = getDuoFlags()) => {
    const encodedPayload = base64urlJson(payload);
    const signature = crypto
        .createHmac('sha256', getStateSecret(flags))
        .update(encodedPayload)
        .digest('base64url');
    return `${encodedPayload}.${signature}`;
};

const safeTimingEqual = (left = '', right = '') => {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyStateToken = (token, flags = getDuoFlags()) => {
    const [encodedPayload = '', signature = ''] = String(token || '').split('.');
    if (!encodedPayload || !signature) {
        throw new AppError('Duo login state is invalid or expired.', 401);
    }

    const expectedSignature = crypto
        .createHmac('sha256', getStateSecret(flags))
        .update(encodedPayload)
        .digest('base64url');
    if (!safeTimingEqual(signature, expectedSignature)) {
        throw new AppError('Duo login state is invalid or expired.', 401);
    }

    const payload = parseBase64urlJson(encodedPayload);
    if (Number(payload.exp || 0) <= Date.now()) {
        throw new AppError('Duo login state is invalid or expired.', 401);
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
        path: '/api/auth/duo',
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

const assertDuoReady = (flags = getDuoFlags()) => {
    if (!flags.enabled) {
        throw new AppError('Duo login is not enabled.', 404);
    }
    if (flags.mode !== 'oidc' || !flags.configured) {
        throw new AppError('Duo OIDC login is not configured.', flags.failClosed ? 503 : 404);
    }
    return flags;
};

const loadDiscovery = async (flags = getDuoFlags()) => {
    assertDuoReady(flags);
    if (cachedDiscovery?.issuer === flags.oidcIssuer && cachedDiscoveryUrl === flags.discoveryUrl) {
        return cachedDiscovery;
    }

    const issuerOrigin = assertTrustedHttpsEndpoint(flags.oidcIssuer).origin;
    assertTrustedHttpsEndpoint(flags.discoveryUrl, issuerOrigin);
    const response = await fetchOidc(flags.discoveryUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    }, 'Duo OIDC discovery');
    if (!response.ok) {
        throw new AppError('Duo OIDC discovery failed.', 503);
    }
    const discovery = await response.json();
    if (normalizeText(discovery.issuer).replace(/\/+$/, '') !== flags.oidcIssuer) {
        throw new AppError('Duo OIDC issuer mismatch.', 503);
    }
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        if (!normalizeText(discovery[key])) {
            throw new AppError('Duo OIDC discovery is incomplete.', 503);
        }
        assertTrustedHttpsEndpoint(discovery[key], issuerOrigin);
    }
    cachedDiscovery = discovery;
    cachedDiscoveryUrl = flags.discoveryUrl;
    return discovery;
};

const buildAuthorizationUrl = async ({
    req = {},
    res = null,
    returnTo = '',
    stateContext = {},
} = {}) => {
    const flags = assertDuoReady();
    const discovery = await loadDiscovery(flags);
    const state = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(24).toString('base64url');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const stateContextPayload = stateContext
        && typeof stateContext === 'object'
        && !Array.isArray(stateContext)
        ? stateContext
        : {};
    const stateToken = signStatePayload({
        ...stateContextPayload,
        state,
        nonce,
        codeVerifier,
        returnTo: normalizeText(returnTo) || '/',
        exp: Date.now() + STATE_TTL_MS,
    }, flags);

    if (res) {
        setStateCookie(res, stateToken, req);
    }

    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', flags.clientId);
    authorizationUrl.searchParams.set('redirect_uri', flags.redirectUri);
    authorizationUrl.searchParams.set('scope', 'openid profile email');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set('code_challenge', sha256Base64url(codeVerifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
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
    const flags = assertDuoReady();
    const stateToken = getStateCookieFromRequest(req);
    const payload = verifyStateToken(stateToken, flags);
    if (!state || state !== payload.state) {
        throw new AppError('Duo login state is invalid or expired.', 401);
    }

    pruneUsedStates();
    const digest = crypto.createHash('sha256').update(stateToken).digest('hex');
    if (usedStateDigests.has(digest)) {
        throw new AppError('Duo login state was already used.', 409);
    }
    usedStateDigests.set(digest, Date.now() + STATE_TTL_MS);
    return payload;
};

const decodeJwtPart = (token, index) => {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
        throw new AppError('Duo identity token is malformed.', 401);
    }
    return parseBase64urlJson(parts[index]);
};

const getJwtSigningInput = (token) => {
    const parts = String(token || '').split('.');
    return `${parts[0]}.${parts[1]}`;
};

const getJwtSignature = (token) => Buffer.from(String(token || '').split('.')[2] || '', 'base64url');

const verifyJwtSignature = ({ token = '', header = {}, jwks = {} } = {}) => {
    if (String(header.alg || '').toLowerCase() === 'none') {
        throw new AppError('Duo identity token uses an unsafe algorithm.', 401);
    }
    if (header.alg !== 'RS256') {
        throw new AppError('Duo identity token algorithm is not allowed.', 401);
    }

    const key = Array.isArray(jwks.keys)
        ? jwks.keys.find((candidate) => candidate.kid === header.kid)
        : null;
    if (!key) {
        throw new AppError('Duo identity token signing key was not found.', 401);
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(getJwtSigningInput(token));
    verifier.end();
    const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
    if (!verifier.verify(publicKey, getJwtSignature(token))) {
        throw new AppError('Duo identity token signature is invalid.', 401);
    }
};

const fetchJwks = async (jwksUri) => {
    const response = await fetchOidc(jwksUri, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    }, 'Duo OIDC signing keys');
    if (!response.ok) {
        throw new AppError('Duo JWKS fetch failed.', 503);
    }
    return response.json();
};

const verifyIdToken = async ({ idToken = '', nonce = '', discovery = null, flags = getDuoFlags() } = {}) => {
    const header = decodeJwtPart(idToken, 0);
    const claims = decodeJwtPart(idToken, 1);
    if (String(header.alg || '').toLowerCase() === 'none') {
        throw new AppError('Duo identity token uses an unsafe algorithm.', 401);
    }
    if (header.alg !== 'RS256') {
        throw new AppError('Duo identity token algorithm is not allowed.', 401);
    }
    const jwks = await fetchJwks(discovery.jwks_uri);
    verifyJwtSignature({ token: idToken, header, jwks });

    const issuer = normalizeText(claims.iss).replace(/\/+$/, '');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = Number(claims.exp);
    const issuedAt = Number(claims.iat);
    const notBefore = claims.nbf === undefined ? null : Number(claims.nbf);
    const authorizedParty = normalizeText(claims.azp);

    if (issuer !== flags.oidcIssuer) {
        throw new AppError('Duo identity token issuer is invalid.', 401);
    }
    if (!audiences.includes(flags.clientId)) {
        throw new AppError('Duo identity token audience is invalid.', 401);
    }
    if ((audiences.length > 1 || authorizedParty) && authorizedParty !== flags.clientId) {
        throw new AppError('Duo identity token authorized party is invalid.', 401);
    }
    if (normalizeText(claims.nonce) !== nonce) {
        throw new AppError('Duo identity token nonce is invalid.', 401);
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
        throw new AppError('Duo identity token is expired.', 401);
    }
    if (!Number.isFinite(issuedAt) || issuedAt <= 0 || issuedAt > nowSeconds + 60) {
        throw new AppError('Duo identity token issue time is invalid.', 401);
    }
    if (notBefore !== null && (!Number.isFinite(notBefore) || notBefore > nowSeconds + 60)) {
        throw new AppError('Duo identity token is not active yet.', 401);
    }
    if (!normalizeText(claims.sub)) {
        throw new AppError('Duo identity token subject is missing.', 401);
    }
    if (!normalizeEmail(claims.email)) {
        throw new AppError('Duo identity token email is missing.', 422);
    }

    return claims;
};

const exchangeCodeForClaims = async ({ code = '', statePayload = {} } = {}) => {
    const flags = assertDuoReady();
    const discovery = await loadDiscovery(flags);
    const tokenBody = new URLSearchParams();
    tokenBody.set('grant_type', 'authorization_code');
    tokenBody.set('code', code);
    tokenBody.set('redirect_uri', flags.redirectUri);
    if (normalizeText(statePayload.codeVerifier)) {
        tokenBody.set('code_verifier', statePayload.codeVerifier);
    }

    const response = await fetchOidc(discovery.token_endpoint, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${flags.clientId}:${flags.clientSecret}`).toString('base64')}`,
        },
        body: tokenBody.toString(),
    }, 'Duo authorization code exchange');
    if (!response.ok) {
        throw new AppError('Duo authorization code exchange failed.', 401);
    }
    const tokenResponse = await response.json();
    if (!normalizeText(tokenResponse.id_token)) {
        throw new AppError('Duo identity token is missing.', 401);
    }

    return verifyIdToken({
        idToken: tokenResponse.id_token,
        nonce: statePayload.nonce,
        discovery,
        flags,
    });
};

const resetDuoOidcTestState = () => {
    cachedDiscovery = null;
    cachedDiscoveryUrl = '';
    usedStateDigests.clear();
};

module.exports = {
    STATE_COOKIE_NAME,
    buildAuthorizationUrl,
    clearStateCookie,
    consumeState,
    exchangeCodeForClaims,
    resetDuoOidcTestState,
    signStatePayload,
    verifyIdToken,
    verifyStateToken,
};
