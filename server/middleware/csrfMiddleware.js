const crypto = require('crypto');
const logger = require('../utils/logger');
const { getRedisClient, flags: redisFlags } = require('../config/redis');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');

/**
 * CSRF Protection Middleware
 *
 * Simple token-based CSRF protection without external dependencies.
 * - Generates CSRF tokens and stores in Redis for multi-instance consistency
 * - Validates tokens on state-changing operations (POST, PUT, DELETE)
 * - Compatible with SameSite=Strict cookies
 */

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_FORMAT = /^[a-f0-9]{64}$/;
const CSRF_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const CSRF_TOKEN_PREFIX = `${redisFlags.redisPrefix}:csrf:token:`;
const CSRF_STRICT_CLIENT_SIGNALS = ['1', 'true', 'yes', 'on']
    .includes(String(process.env.CSRF_STRICT_CLIENT_SIGNALS || '').trim().toLowerCase());
const buildTokenKey = (token) => `${CSRF_TOKEN_PREFIX}${token}`;

const normalizePrincipalId = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value?.toHexString === 'function') return String(value.toHexString()).trim();
    if (typeof value?.toString === 'function') {
        const normalized = String(value.toString()).trim();
        if (normalized && normalized !== '[object Object]') {
            return normalized;
        }
    }
    return '';
};

const getStrictOrigin = (req) => {
    const explicitOrigin = req.headers?.origin;
    if (explicitOrigin) return explicitOrigin;

    const referer = req.headers?.referer;
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch (_) {
            return null;
        }
    }

    const host = req.headers?.host;
    if (!host) return null;
    const protocol = req.protocol || 'https';
    return `${protocol}://${host}`;
};

const hasBearerAuthorization = (req) => String(req?.headers?.authorization || '').startsWith('Bearer ');

const getRequestContext = (req) => ({
    uid: req.user?.id || req.user?._id || req.authUid || 'anonymous',
    // Firebase bearer-authenticated bootstrap requests can rotate the browser
    // session between CSRF issuance and the follow-up write, so binding those
    // tokens to a sessionId causes false-invalid CSRF failures during OAuth sync.
    sessionId: hasBearerAuthorization(req)
        ? null
        : (req.authSession?.sessionId || req.sessionID || req.headers?.['x-session-id'] || null),
    deviceFingerprint: req.headers?.['x-device-fingerprint'] || null,
    strictOrigin: getStrictOrigin(req),
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
});

const normalizeUserAgent = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const generateCsrfToken = () => {
    const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
    return token;
};

const storeCsrfToken = async (token, metadata = {}) => {
    const createdAt = Date.now();
    const expiresAt = createdAt + CSRF_TOKEN_TTL_MS;

    const record = {
        createdAt,
        expiresAt,
        metadata: {
            ...metadata,
            uid: normalizePrincipalId(metadata.uid) || 'anonymous',
        },
    };

    const client = getRedisClient();
    if (!client) {
        logger.warn('csrf.redis_unavailable_store', { uid: record.metadata.uid });
        return token;
    }

    await client.setEx(buildTokenKey(token), Math.ceil(CSRF_TOKEN_TTL_MS / 1000), JSON.stringify(record));

    return token;
};

const verifyCsrfToken = async (token, requestContext = {}) => {
    if (!token || typeof token !== 'string' || !CSRF_TOKEN_FORMAT.test(token)) {
        return false;
    }

    const client = getRedisClient();
    if (!client) {
        logger.warn('csrf.redis_unavailable_verify');
        return false;
    }

    const context = requestContext || {};
    const currentUid = normalizePrincipalId(context.uid) || 'anonymous';
    const result = await client.eval(
        `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, stored = pcall(cjson.decode, raw)
if not decoded or type(stored) ~= 'table' then
  redis.call('DEL', KEYS[1])
  return 'invalid_record'
end
if tonumber(stored['expiresAt'] or '0') <= tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1])
  return 'expired'
end
local metadata = stored['metadata'] or {}
local function text(value)
  if value == nil or value == cjson.null then return '' end
  return tostring(value)
end
local expectedUid = text(metadata['uid'])
if expectedUid == '' then expectedUid = 'anonymous' end
if expectedUid ~= ARGV[2] then return 'principal_mismatch' end
local strictOrigin = text(metadata['strictOrigin'])
if strictOrigin ~= '' and strictOrigin ~= ARGV[3] then return 'origin_mismatch' end
local sessionId = text(metadata['sessionId'])
if sessionId ~= '' and sessionId ~= ARGV[4] then return 'session_mismatch' end
local fingerprint = text(metadata['deviceFingerprint'])
if fingerprint ~= '' and fingerprint ~= ARGV[5] then return 'device_mismatch' end
local storedIp = text(metadata['ip'])
local storedUserAgent = text(metadata['userAgent'])
local ipMismatch = storedIp ~= '' and ARGV[6] ~= '' and storedIp ~= ARGV[6]
local userAgentMismatch = storedUserAgent ~= '' and ARGV[7] ~= '' and storedUserAgent ~= ARGV[7]
if ARGV[8] == '1' and (ipMismatch or userAgentMismatch) then
  return 'client_signal_mismatch'
end
redis.call('DEL', KEYS[1])
if ipMismatch and userAgentMismatch then return 'ok:ip,user_agent' end
if ipMismatch then return 'ok:ip' end
if userAgentMismatch then return 'ok:user_agent' end
return 'ok'
`,
        {
            keys: [buildTokenKey(token)],
            arguments: [
                String(Date.now()),
                currentUid,
                String(context.strictOrigin || ''),
                String(context.sessionId || ''),
                String(context.deviceFingerprint || ''),
                String(context.ip || ''),
                normalizeUserAgent(context.userAgent),
                CSRF_STRICT_CLIENT_SIGNALS ? '1' : '0',
            ],
        }
    );

    if (result === 'principal_mismatch') {
        logger.warn('csrf.principal_mismatch', {
            requestUid: currentUid,
            ip: context.ip || null,
            timestamp: new Date().toISOString(),
        });
        return false;
    }
    if (result === 'client_signal_mismatch') {
        logger.warn('csrf.client_signal_mismatch_rejected', {
            strictMode: true,
            requestIp: context.ip || '',
            requestUserAgent: normalizeUserAgent(context.userAgent),
        });
        return false;
    }
    if (String(result || '').startsWith('ok:')) {
        const signalPayload = {
            strictMode: false,
            ipMismatch: String(result).includes('ip'),
            userAgentMismatch: String(result).includes('user_agent'),
            requestIp: context.ip || '',
            requestUserAgent: normalizeUserAgent(context.userAgent),
        };
        logger.warn('csrf.client_signal_mismatch_detected', signalPayload);
    }
    return String(result || '').startsWith('ok');
};

/**
 * Middleware to generate and attach CSRF token to requests (e.g., GET endpoints)
 */
const csrfTokenGenerator = async (req, res, next) => {
    const token = generateCsrfToken();
    const context = getRequestContext(req);
    await storeCsrfToken(token, context);
    // Attach token to response headers and request object
    res.setHeader('X-CSRF-Token', token);
    req.csrfToken = token;

    logger.debug('csrf.token_generated', {
        uid: context.uid,
        ip: context.ip,
        path: req.path,
        timestamp: new Date().toISOString(),
    });

    next();
};

/**
 * Middleware to validate CSRF token on state-changing operations
 */
const csrfTokenValidator = async (req, res, next) => {
    // CSRF validation only needed for state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const rawToken = req.headers?.['x-csrf-token'];
    if (rawToken !== undefined && rawToken !== null && typeof rawToken !== 'string') {
        logger.warn('csrf.token_type_rejected', {
            method: req.method,
            path: req.path,
            uid: req.authUid || req.user?.id || 'anonymous',
            transport: 'header',
        });
        recordAuthSecurityEvent({
            event: 'csrf_rejected',
            outcome: 'blocked',
            reason: 'invalid_type',
            surface: 'csrf',
            req,
            meta: { statusCode: 403 },
        });
        return next({
            statusCode: 403,
            message: 'CSRF token must be a string',
            code: 'CSRF_TOKEN_INVALID_TYPE',
        });
    }

    const token = rawToken || '';

    if (!token) {
        logger.warn('csrf.token_missing', {
            method: req.method,
            path: req.path,
            ip: req.ip,
            uid: req.authUid || 'anonymous',
            timestamp: new Date().toISOString(),
        });
        recordAuthSecurityEvent({
            event: 'csrf_rejected',
            outcome: 'blocked',
            reason: 'token_missing',
            surface: 'csrf',
            req,
            meta: { statusCode: 403 },
        });
        return next({
            statusCode: 403,
            message: 'CSRF token is missing',
            code: 'CSRF_TOKEN_MISSING',
        });
    }

    const context = getRequestContext(req);
    if (!await verifyCsrfToken(token, context)) {
        logger.warn('csrf.token_invalid', {
            method: req.method,
            path: req.path,
            ip: req.ip,
            uid: context.uid,
            tokenLength: String(token).length,
            timestamp: new Date().toISOString(),
        });
        recordAuthSecurityEvent({
            event: 'csrf_rejected',
            outcome: 'blocked',
            reason: 'token_invalid',
            surface: 'csrf',
            req,
            meta: { statusCode: 403 },
        });
        return next({
            statusCode: 403,
            message: 'CSRF token is invalid or expired',
            code: 'CSRF_TOKEN_INVALID',
        });
    }

    // Token validated successfully
    logger.debug('csrf.token_valid', {
        method: req.method,
        path: req.path,
        uid: req.authUid || 'anonymous',
        timestamp: new Date().toISOString(),
    });

    req.csrfValidated = true;
    next();
};

const csrfTokenValidatorUnlessBearerAuth = async (req, res, next) => {
    const hasBearerAuth = String(req?.headers?.authorization || '').startsWith('Bearer ');
    if (hasBearerAuth) {
        return next();
    }
    return csrfTokenValidator(req, res, next);
};

/**
 * Middleware to apply CSRF protection to specific routes
 * Returns both generator and validator for flexibility
 */
const csrf = (options = {}) => {
    const requireToken = options.requireToken !== false;

    return [
        csrfTokenGenerator,
        ...(requireToken ? [csrfTokenValidator] : []),
    ];
};

module.exports = {
    csrf,
    csrfTokenGenerator,
    csrfTokenValidator,
    csrfTokenValidatorUnlessBearerAuth,
    generateCsrfToken,
    storeCsrfToken,
    verifyCsrfToken,
    __resetCsrfTokenStore: () => {
        // In-memory store was removed in favor of Redis.
    },
};
