const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getRedisClient, flags: redisFlags } = require('../config/redis');

const DESKTOP_OWNER_ACCESS_AUDIENCE = 'aura.desktop.owner.access.v1';
const DESKTOP_OWNER_ACCESS_ASSERTION_TTL_MS = 5 * 60 * 1000;
const DESKTOP_OWNER_ACCESS_MAX_SKEW_MS = 30 * 1000;
const DESKTOP_OWNER_ACCESS_MAX_REPLAY_ENTRIES = 5000;
const DESKTOP_OWNER_ACCESS_NONCE_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
const DESKTOP_OWNER_ACCESS_REQUEST_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_OWNER_ACCESS_KEY_BYTES = 32;

const replayCache = new Map();

class DesktopOwnerAccessError extends Error {
    constructor(message, statusCode = 403, code = 'DESKTOP_OWNER_ACCESS_INVALID') {
        super(message);
        this.name = 'DesktopOwnerAccessError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const readEnv = (env, name) => String(env?.[name] || '').trim();

const decodeBase64Url = (value = '') => {
    const normalized = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized) return Buffer.alloc(0);
    return Buffer.from(`${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`, 'base64');
};

const resolveOwnerAccessKeyFile = (env = process.env) => {
    const configured = readEnv(env, 'AURA_DESKTOP_OWNER_ACCESS_KEY_FILE');
    if (!configured) return '';
    return path.isAbsolute(configured)
        ? configured
        : path.resolve(process.cwd(), configured);
};

const readOwnerAccessKeyMaterial = (env = process.env) => {
    const direct = readEnv(env, 'AURA_DESKTOP_OWNER_ACCESS_KEY');
    if (direct) return Buffer.from(direct, 'utf8');

    const base64 = readEnv(env, 'AURA_DESKTOP_OWNER_ACCESS_KEY_BASE64');
    if (base64) return decodeBase64Url(base64);

    const keyFile = resolveOwnerAccessKeyFile(env);
    if (keyFile && fs.existsSync(keyFile)) {
        return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'utf8');
    }

    return Buffer.alloc(0);
};

const resolveOwnerAccessConfig = (env = process.env) => {
    const ownerUid = readEnv(env, 'AURA_DESKTOP_OWNER_FIREBASE_UID');
    const key = readOwnerAccessKeyMaterial(env);
    if (!ownerUid || key.length < MIN_OWNER_ACCESS_KEY_BYTES) {
        return null;
    }

    return {
        key,
        keyFingerprint: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
        ownerUid,
    };
};

const isDesktopOwnerAccessConfigured = (env = process.env) => {
    if (String(env?.NODE_ENV || '').trim().toLowerCase() === 'production') {
        return false;
    }
    if (!parseBooleanEnv(env?.AURA_DESKTOP_OWNER_ACCESS_ENABLED, false)) {
        return false;
    }
    return Boolean(resolveOwnerAccessConfig(env));
};

const buildDesktopOwnerAccessPayload = ({
    requestId = '',
    issuedAt = '',
    nonce = '',
} = {}) => [
    DESKTOP_OWNER_ACCESS_AUDIENCE,
    String(requestId || '').trim(),
    String(issuedAt || '').trim(),
    String(nonce || '').trim(),
].join('\n');

const createDesktopOwnerAccessSignature = (payload, key) => crypto
    .createHmac('sha256', key)
    .update(payload)
    .digest('base64url');

const safeEquals = (left = '', right = '') => {
    const leftBuffer = Buffer.from(String(left || '').trim());
    const rightBuffer = Buffer.from(String(right || '').trim());
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const pruneReplayCache = (nowMs) => {
    for (const [key, expiresAt] of replayCache.entries()) {
        if (expiresAt <= nowMs || replayCache.size > DESKTOP_OWNER_ACCESS_MAX_REPLAY_ENTRIES) {
            replayCache.delete(key);
        }
    }
};

const isDistributedReplayRequired = (env = process.env) => (
    String(env?.NODE_ENV || '').trim().toLowerCase() === 'production'
    || parseBooleanEnv(env?.REDIS_REQUIRED, false)
    || parseBooleanEnv(env?.DISTRIBUTED_SECURITY_CONTROLS_ENABLED, false)
);

const consumeReplayKey = async ({
    replayKey,
    expiresAtMs,
    nowMs,
    env = process.env,
    redisClient = getRedisClient(),
} = {}) => {
    const replayDigest = crypto.createHash('sha256').update(replayKey).digest('hex');
    const ttlMs = Math.max(Number(expiresAtMs || 0) - Number(nowMs || 0), 1000);

    if (redisClient) {
        try {
            const result = await redisClient.set(
                `${redisFlags.redisPrefix}:desktop-owner-access:replay:${replayDigest}`,
                '1',
                { NX: true, PX: ttlMs }
            );
            if (result !== 'OK' && result !== true) {
                throw new DesktopOwnerAccessError('Desktop owner access assertion was already used.', 409);
            }
            return;
        } catch (error) {
            if (error instanceof DesktopOwnerAccessError) throw error;
            throw new DesktopOwnerAccessError(
                'Desktop owner access replay protection is unavailable.',
                503,
                'DESKTOP_OWNER_ACCESS_REPLAY_UNAVAILABLE'
            );
        }
    }

    if (isDistributedReplayRequired(env)) {
        throw new DesktopOwnerAccessError(
            'Desktop owner access replay protection is unavailable.',
            503,
            'DESKTOP_OWNER_ACCESS_REPLAY_UNAVAILABLE'
        );
    }

    pruneReplayCache(nowMs);
    if (replayCache.has(replayKey)) {
        throw new DesktopOwnerAccessError('Desktop owner access assertion was already used.', 409);
    }
    replayCache.set(replayKey, expiresAtMs);
};

const assertFreshAssertion = ({ issuedAt = '', nowMs }) => {
    const issuedAtMs = Date.parse(String(issuedAt || '').trim());
    if (!Number.isFinite(issuedAtMs)) {
        throw new DesktopOwnerAccessError('Desktop owner access timestamp is invalid.', 400);
    }

    if (issuedAtMs > nowMs + DESKTOP_OWNER_ACCESS_MAX_SKEW_MS) {
        throw new DesktopOwnerAccessError('Desktop owner access timestamp is not yet valid.');
    }

    if (nowMs - issuedAtMs > DESKTOP_OWNER_ACCESS_ASSERTION_TTL_MS) {
        throw new DesktopOwnerAccessError('Desktop owner access assertion expired.');
    }

    return issuedAtMs;
};

const verifyDesktopOwnerAccessAssertion = async ({
    requestId = '',
    issuedAt = '',
    nonce = '',
    signature = '',
} = {}, {
    env = process.env,
    now = () => Date.now(),
    redisClient = getRedisClient(),
} = {}) => {
    if (String(env?.NODE_ENV || '').trim().toLowerCase() === 'production') {
        throw new DesktopOwnerAccessError(
            'Desktop owner access is disabled in production.',
            503,
            'DESKTOP_OWNER_ACCESS_DISABLED_IN_PRODUCTION'
        );
    }
    if (!parseBooleanEnv(env?.AURA_DESKTOP_OWNER_ACCESS_ENABLED, false)) {
        throw new DesktopOwnerAccessError(
            'Desktop owner access is not configured.',
            503,
            'DESKTOP_OWNER_ACCESS_NOT_CONFIGURED'
        );
    }

    const config = resolveOwnerAccessConfig(env);
    if (!config) {
        throw new DesktopOwnerAccessError(
            'Desktop owner access is not configured.',
            503,
            'DESKTOP_OWNER_ACCESS_NOT_CONFIGURED'
        );
    }

    const normalizedRequestId = String(requestId || '').trim();
    const normalizedIssuedAt = String(issuedAt || '').trim();
    const normalizedNonce = String(nonce || '').trim();
    const normalizedSignature = String(signature || '').trim();

    if (!DESKTOP_OWNER_ACCESS_REQUEST_ID_REGEX.test(normalizedRequestId)) {
        throw new DesktopOwnerAccessError('Desktop owner access request is invalid.', 400);
    }
    if (!DESKTOP_OWNER_ACCESS_NONCE_REGEX.test(normalizedNonce)) {
        throw new DesktopOwnerAccessError('Desktop owner access nonce is invalid.', 400);
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(normalizedSignature)) {
        throw new DesktopOwnerAccessError('Desktop owner access signature is invalid.', 400);
    }

    const nowMs = Number(now());
    const issuedAtMs = assertFreshAssertion({
        issuedAt: normalizedIssuedAt,
        nowMs,
    });
    const replayKey = [
        config.keyFingerprint,
        normalizedRequestId,
        normalizedNonce,
        normalizedIssuedAt,
    ].join(':');

    const payload = buildDesktopOwnerAccessPayload({
        requestId: normalizedRequestId,
        issuedAt: normalizedIssuedAt,
        nonce: normalizedNonce,
    });
    const expectedSignature = createDesktopOwnerAccessSignature(payload, config.key);
    if (!safeEquals(expectedSignature, normalizedSignature)) {
        throw new DesktopOwnerAccessError('Desktop owner access signature could not be verified.');
    }

    await consumeReplayKey({
        replayKey,
        expiresAtMs: issuedAtMs + DESKTOP_OWNER_ACCESS_ASSERTION_TTL_MS,
        nowMs,
        env,
        redisClient,
    });

    return {
        keyFingerprint: config.keyFingerprint,
        ownerUid: config.ownerUid,
    };
};

const resetDesktopOwnerAccessReplayCacheForTests = () => {
    replayCache.clear();
};

module.exports = {
    DESKTOP_OWNER_ACCESS_AUDIENCE,
    DESKTOP_OWNER_ACCESS_ASSERTION_TTL_MS,
    DesktopOwnerAccessError,
    buildDesktopOwnerAccessPayload,
    createDesktopOwnerAccessSignature,
    isDesktopOwnerAccessConfigured,
    isDistributedReplayRequired,
    resetDesktopOwnerAccessReplayCacheForTests,
    verifyDesktopOwnerAccessAssertion,
};
