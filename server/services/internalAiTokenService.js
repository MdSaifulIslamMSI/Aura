const crypto = require('crypto');
const AppError = require('../utils/AppError');

const TOKEN_VERSION = 'v1';
const DEFAULT_TTL_SECONDS = 5 * 60;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;

const normalizeText = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const parseBoolean = (value, fallback = false) => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const encodeBase64UrlJson = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const decodeBase64UrlJson = (value) => JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const parseKeyConfigEntry = (entry, generatedVersionPrefix) => {
    const raw = normalizeText(entry);
    if (!raw) return null;

    const separatorIndex = raw.indexOf(':');
    if (separatorIndex > 0) {
        const version = normalizeText(raw.slice(0, separatorIndex));
        const secret = normalizeText(raw.slice(separatorIndex + 1));
        if (!version || !secret) return null;
        return { version, secret };
    }

    return {
        version: `${generatedVersionPrefix}${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8)}`,
        secret: raw,
    };
};

const getActiveKeyVersion = () => normalizeText(process.env.AI_INTERNAL_AUTH_ACTIVE_KID, 'ai-v1') || 'ai-v1';
const getCurrentSigningSecret = () => normalizeText(process.env.AI_INTERNAL_AUTH_SECRET);
const getIssuer = () => normalizeText(process.env.AI_INTERNAL_AUTH_ISSUER, 'aura-internal-ai') || 'aura-internal-ai';
const getDefaultAudience = () => normalizeText(process.env.AI_INTERNAL_AUTH_AUDIENCE, 'aura-api') || 'aura-api';
const getAllowedAudiences = () => {
    const raw = normalizeText(process.env.AI_INTERNAL_AUTH_AUDIENCE, 'aura-api');
    return raw
        .split(',')
        .map((entry) => normalizeText(entry))
        .filter(Boolean);
};
const getDefaultTtlSeconds = () => Math.max(60, parseInteger(process.env.AI_INTERNAL_AUTH_TOKEN_TTL_SECONDS, DEFAULT_TTL_SECONDS));
const getClockSkewSeconds = () => Math.max(0, parseInteger(process.env.AI_INTERNAL_AUTH_CLOCK_SKEW_SECONDS, DEFAULT_CLOCK_SKEW_SECONDS));
const shouldAllowLegacySecret = () => {
    const hasSignedTokenConfig = Boolean(getCurrentSigningSecret());
    return parseBoolean(process.env.AI_INTERNAL_AUTH_ALLOW_LEGACY_SECRET, !hasSignedTokenConfig);
};

const getInternalAiKeyEntries = () => {
    const entries = [];
    const currentSecret = getCurrentSigningSecret();
    if (currentSecret) {
        entries.push({
            version: getActiveKeyVersion(),
            secret: currentSecret,
        });
    }

    const previousRaw = normalizeText(process.env.AI_INTERNAL_AUTH_PREVIOUS_SECRETS);
    if (!previousRaw) {
        return entries;
    }

    const previousEntries = previousRaw
        .split(',')
        .map((entry) => parseKeyConfigEntry(entry, 'legacy-'))
        .filter(Boolean)
        .filter((entry) => entry.secret !== currentSecret);

    return entries.concat(previousEntries);
};

const getInternalAiSecretsByVersion = () => new Map(
    getInternalAiKeyEntries().map((entry) => [entry.version, entry.secret])
);

const hasInternalAiTokenConfig = () => Boolean(getCurrentSigningSecret());

const signTokenInput = (signingInput, secret) => crypto
    .createHmac('sha256', String(secret || ''))
    .update(signingInput)
    .digest('base64url');

const issueInternalAiServiceToken = ({
    subject = '',
    audience = '',
    ttlSeconds = null,
    scope = 'internal:ai',
    additionalClaims = {},
} = {}) => {
    const signingSecret = getCurrentSigningSecret();
    if (!signingSecret) {
        throw new AppError('AI_INTERNAL_AUTH_SECRET is required to issue internal AI service tokens', 500);
    }

    const safeSubject = normalizeText(subject, 'authorized_client') || 'authorized_client';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = nowSeconds + Math.max(60, Number(ttlSeconds) || getDefaultTtlSeconds());
    const header = {
        alg: 'HS256',
        typ: 'JWT',
        kid: getActiveKeyVersion(),
    };
    const payload = {
        iss: getIssuer(),
        sub: safeSubject,
        aud: normalizeText(audience, getDefaultAudience()) || getDefaultAudience(),
        scope: normalizeText(scope, 'internal:ai') || 'internal:ai',
        ver: TOKEN_VERSION,
        iat: nowSeconds,
        exp: expiresAtSeconds,
        jti: crypto.randomBytes(16).toString('hex'),
        ...additionalClaims,
    };

    const encodedHeader = encodeBase64UrlJson(header);
    const encodedPayload = encodeBase64UrlJson(payload);
    const signature = signTokenInput(`${encodedHeader}.${encodedPayload}`, signingSecret);

    return {
        token: `${encodedHeader}.${encodedPayload}.${signature}`,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
        issuer: payload.iss,
        audience: payload.aud,
        subject: payload.sub,
        keyVersion: header.kid,
        version: payload.ver,
    };
};

const validateNumericClaim = (value, label) => {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        throw new AppError(`Internal AI token ${label} is invalid`, 401);
    }
    return Math.trunc(numericValue);
};

const verifyInternalAiServiceToken = (token, options = {}) => {
    const rawToken = normalizeText(token);
    const [encodedHeader, encodedPayload, providedSignature] = rawToken.split('.');

    if (!encodedHeader || !encodedPayload || !providedSignature) {
        throw new AppError('Internal AI token format is invalid', 401);
    }

    let header;
    let payload;
    try {
        header = decodeBase64UrlJson(encodedHeader);
        payload = decodeBase64UrlJson(encodedPayload);
    } catch {
        throw new AppError('Internal AI token payload is malformed', 401);
    }

    if (normalizeText(header?.alg).toUpperCase() !== 'HS256') {
        throw new AppError('Internal AI token algorithm is invalid', 401);
    }
    if (normalizeText(header?.typ).toUpperCase() !== 'JWT') {
        throw new AppError('Internal AI token type is invalid', 401);
    }

    const keyVersion = normalizeText(header?.kid);
    const secretsByVersion = getInternalAiSecretsByVersion();
    const secret = secretsByVersion.get(keyVersion);
    if (!keyVersion || !secret) {
        throw new AppError('Internal AI token key version is invalid', 401);
    }

    const expectedSignature = signTokenInput(`${encodedHeader}.${encodedPayload}`, secret);
    if (!safeEqual(providedSignature, expectedSignature)) {
        throw new AppError('Internal AI token signature is invalid', 401);
    }

    if (normalizeText(payload?.ver) !== TOKEN_VERSION) {
        throw new AppError('Internal AI token version is invalid', 401);
    }

    const expectedIssuer = normalizeText(options.expectedIssuer, getIssuer());
    if (expectedIssuer && normalizeText(payload?.iss) !== expectedIssuer) {
        throw new AppError('Internal AI token issuer is invalid', 401);
    }

    const expectedAudiences = Array.from(new Set([
        ...getAllowedAudiences(),
        ...String(options.expectedAudience || '')
            .split(',')
            .map((entry) => normalizeText(entry))
            .filter(Boolean),
    ]));
    const tokenAudiences = Array.isArray(payload?.aud)
        ? payload.aud.map((entry) => normalizeText(entry)).filter(Boolean)
        : [normalizeText(payload?.aud)].filter(Boolean);

    if (expectedAudiences.length > 0 && !tokenAudiences.some((entry) => expectedAudiences.includes(entry))) {
        throw new AppError('Internal AI token audience is invalid', 401);
    }

    const expectedScope = normalizeText(options.requiredScope, 'internal:ai');
    if (expectedScope && normalizeText(payload?.scope) !== expectedScope) {
        throw new AppError('Internal AI token scope is invalid', 401);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const clockSkewSeconds = getClockSkewSeconds();
    const issuedAtSeconds = validateNumericClaim(payload?.iat, 'issued-at');
    const expiresAtSeconds = validateNumericClaim(payload?.exp, 'expiration');

    if (issuedAtSeconds > nowSeconds + clockSkewSeconds) {
        throw new AppError('Internal AI token is not valid yet', 401);
    }
    if (expiresAtSeconds <= nowSeconds - clockSkewSeconds) {
        throw new AppError('Internal AI token expired', 401);
    }

    const subject = normalizeText(payload?.sub);
    if (!subject) {
        throw new AppError('Internal AI token subject is invalid', 401);
    }

    return {
        claims: payload,
        header,
        keyVersion,
        issuer: normalizeText(payload?.iss),
        audience: tokenAudiences[0] || '',
        source: subject,
        scope: normalizeText(payload?.scope),
        version: normalizeText(payload?.ver),
    };
};

module.exports = {
    TOKEN_VERSION,
    getActiveKeyVersion,
    getAllowedAudiences,
    getDefaultAudience,
    getInternalAiKeyEntries,
    getInternalAiSecretsByVersion,
    getIssuer,
    hasInternalAiTokenConfig,
    issueInternalAiServiceToken,
    shouldAllowLegacySecret,
    verifyInternalAiServiceToken,
};
