const crypto = require('crypto');
const fetch = require('node-fetch');
const AppError = require('../../utils/AppError');
const { resolveAuthEnvironment } = require('../../config/authEnvironment');

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map();

const decodeBase64UrlJson = (value = '') => {
    try {
        return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    } catch {
        throw new AppError('Invalid token format', 401);
    }
};

const decodeJwt = (token = '') => {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) {
        throw new AppError('Invalid token format', 401);
    }
    return {
        header: decodeBase64UrlJson(parts[0]),
        payload: decodeBase64UrlJson(parts[1]),
        signature: Buffer.from(parts[2], 'base64url'),
        signingInput: `${parts[0]}.${parts[1]}`,
    };
};

const fetchJwks = async (jwksUrl = '', fetchJson = null) => {
    const url = String(jwksUrl || '').trim();
    if (!url) {
        throw new AppError('OIDC JWKS URL is not configured', 500);
    }

    const cached = jwksCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.jwks;
    }

    const jwks = fetchJson
        ? await fetchJson(url)
        : await fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
        }).then((response) => {
            if (!response.ok) {
                throw new AppError('Unable to fetch OIDC signing keys', 503);
            }
            return response.json();
        });

    if (!jwks || !Array.isArray(jwks.keys)) {
        throw new AppError('OIDC signing keys are invalid', 503);
    }

    jwksCache.set(url, {
        jwks,
        expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
    });

    return jwks;
};

const findSigningKey = (jwks = {}, kid = '') => {
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    return keys.find((key) => (
        key
        && key.kty === 'RSA'
        && key.use !== 'enc'
        && (!kid || key.kid === kid)
    ));
};

const verifySignature = ({ header, signature, signingInput, jwk }) => {
    if (!jwk) {
        throw new AppError('Token signing key was not found', 401);
    }

    try {
        const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        const verified = crypto.verify(
            'RSA-SHA256',
            Buffer.from(signingInput),
            key,
            signature
        );

        if (!verified) {
            throw new AppError('Invalid token signature', 401);
        }
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('Invalid token signature', 401);
    }

    return header;
};

const tokenAudienceMatches = (tokenAudience, expectedAudience = '') => {
    const expected = String(expectedAudience || '').trim();
    if (!expected) return false;
    const audiences = Array.isArray(tokenAudience)
        ? tokenAudience.map((entry) => String(entry || '').trim())
        : [String(tokenAudience || '').trim()];
    return audiences.includes(expected);
};

const validateClaims = ({ claims, config, nowSeconds }) => {
    const skew = Number(config.allowedClockSkewSeconds || 0);
    const issuer = String(config.issuerUrl || '').trim();
    const audience = String(config.audience || config.clientId || '').trim();

    if (!claims.sub) throw new AppError('Token subject is missing', 401);
    if (issuer && claims.iss !== issuer) throw new AppError('Invalid token issuer', 401);
    if (audience && !tokenAudienceMatches(claims.aud, audience)) throw new AppError('Invalid token audience', 401);
    if (Number(claims.exp || 0) <= nowSeconds - skew) throw new AppError('Token has expired', 401);
    if (claims.nbf !== undefined && Number(claims.nbf) > nowSeconds + skew) throw new AppError('Token is not active yet', 401);
    if (claims.iat !== undefined && Number(claims.iat) > nowSeconds + skew) throw new AppError('Token issued-at is in the future', 401);
};

const extractKeycloakRoles = (claims = {}, clientId = '') => {
    const roles = new Set();
    const append = (value) => {
        const normalized = String(value || '').trim();
        if (normalized) roles.add(normalized);
    };

    (claims.realm_access?.roles || []).forEach(append);
    (claims.resource_access?.[clientId]?.roles || []).forEach(append);
    (claims.groups || []).forEach((group) => append(String(group || '').replace(/^\/+/, '')));
    return Array.from(roles);
};

const mapOidcClaimsToAuthContext = (claims = {}, config = resolveAuthEnvironment()) => {
    const subject = String(claims.sub || '').trim();
    const authUid = `keycloak:${subject}`;
    const email = String(claims.email || '').trim().toLowerCase();
    const name = String(claims.name || claims.preferred_username || email || subject).trim();
    const roles = extractKeycloakRoles(claims, config.clientId);

    return {
        provider: 'keycloak',
        subject,
        authUid,
        roles,
        identity: {
            uid: authUid,
            email,
            name,
            displayName: name,
            phone: String(claims.phone_number || '').trim(),
            phoneNumber: String(claims.phone_number || '').trim(),
            emailVerified: Boolean(claims.email_verified),
            providerIds: ['keycloak'],
        },
        authToken: {
            ...claims,
            uid: authUid,
            email,
            name,
            email_verified: Boolean(claims.email_verified),
            phone_number: String(claims.phone_number || '').trim(),
            roles,
            firebase: {
                sign_in_provider: 'keycloak',
                sign_in_second_factor: Array.isArray(claims.amr)
                    ? claims.amr.find((entry) => ['mfa', 'otp', 'totp', 'webauthn', 'passkey'].includes(String(entry).toLowerCase()))
                    : undefined,
            },
        },
    };
};

const verifyOidcAccessToken = async ({
    token,
    env = process.env,
    config = resolveAuthEnvironment(env),
    jwks = null,
    nowSeconds = Math.floor(Date.now() / 1000),
    fetchJson = null,
} = {}) => {
    const decoded = decodeJwt(token);
    const algorithm = String(decoded.header.alg || '').toUpperCase();
    const allowedAlgorithms = Array.isArray(config.allowedAlgorithms) && config.allowedAlgorithms.length
        ? config.allowedAlgorithms.map((entry) => String(entry).toUpperCase())
        : ['RS256'];

    if (algorithm === 'NONE' || !algorithm) {
        throw new AppError('Unsigned tokens are not accepted', 401);
    }
    if (!allowedAlgorithms.includes(algorithm) || algorithm !== 'RS256') {
        throw new AppError('Unsupported token signing algorithm', 401);
    }

    const signingKeys = jwks || await fetchJwks(config.jwksUrl, fetchJson);
    const signingKey = findSigningKey(signingKeys, decoded.header.kid);
    verifySignature({
        header: decoded.header,
        signature: decoded.signature,
        signingInput: decoded.signingInput,
        jwk: signingKey,
    });

    validateClaims({
        claims: decoded.payload,
        config,
        nowSeconds,
    });

    return mapOidcClaimsToAuthContext(decoded.payload, config);
};

const resetOidcVerifierCache = () => jwksCache.clear();

module.exports = {
    mapOidcClaimsToAuthContext,
    resetOidcVerifierCache,
    verifyOidcAccessToken,
    __private: {
        decodeJwt,
        extractKeycloakRoles,
        findSigningKey,
        tokenAudienceMatches,
        validateClaims,
        verifySignature,
    },
};
