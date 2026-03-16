const crypto = require('crypto');
const { getRedisClient, flags: redisFlags } = require('../config/redis');

const UPLOAD_NONCE_PREFIX = `${redisFlags.redisPrefix}:upload:nonce:`;

const base64UrlEncode = (value) => Buffer.from(value).toString('base64url');
const base64UrlDecode = (value) => Buffer.from(String(value || ''), 'base64url').toString('utf8');

const getSigningSecret = () => {
        const configuredSecret = String(process.env.UPLOAD_SIGNING_SECRET || '').trim();

        if (configuredSecret) {
            return configuredSecret;
        }

        throw new Error('UPLOAD_SIGNING_SECRET is required');
};

const signPayload = (payloadJson) => {
    const secret = getSigningSecret();
    return crypto
        .createHmac('sha256', secret)
        .update(payloadJson)
        .digest('base64url');
};

const getNonceKey = (nonce) => `${UPLOAD_NONCE_PREFIX}${String(nonce || '').trim()}`;

const createUploadToken = ({
    userId,
    purpose,
    fileName,
    mimeType,
    maxBytes,
    ttlSeconds = 600,
}) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + Math.max(60, Number(ttlSeconds) || 600);
    const payload = {
        uid: String(userId),
        purpose: String(purpose),
        fileName: String(fileName || '').slice(0, 220),
        mimeType: String(mimeType || '').slice(0, 120),
        maxBytes: Math.max(0, Number(maxBytes) || 0),
        nonce: crypto.randomBytes(16).toString('hex'),
        iat: nowSec,
        exp,
    };
    const payloadJson = JSON.stringify(payload);
    const encodedPayload = base64UrlEncode(payloadJson);
    const signature = signPayload(payloadJson);
    return {
        token: `${encodedPayload}.${signature}`,
        expiresAt: new Date(exp * 1000).toISOString(),
    };
};

const verifyUploadToken = (token) => {
    const [encodedPayload, signature] = String(token || '').split('.');
    if (!encodedPayload || !signature) {
        throw new Error('Invalid upload token format');
    }

    const payloadJson = base64UrlDecode(encodedPayload);
    const expectedSignature = signPayload(payloadJson);

    const provided = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        throw new Error('Invalid upload token signature');
    }

    let payload;
    try {
        payload = JSON.parse(payloadJson);
    } catch {
        throw new Error('Invalid upload token payload');
    }

    const expMs = Number(payload?.exp || 0) * 1000;
    if (!expMs || Date.now() >= expMs) {
        throw new Error('Upload token expired');
    }

    if (!payload?.nonce) {
        throw new Error('Upload token already used');
    }

    return payload;
};

const consumeUploadTokenNonce = async (payload) => {
    if (!payload?.nonce) {
        throw new Error('Upload token already used');
    }

    const client = getRedisClient();
    if (!client) {
        throw new Error('Upload token verification unavailable');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = Number(payload.exp || 0);
    const ttlSeconds = Math.max(1, expSec - nowSec);
    const wasSet = await client.set(getNonceKey(payload.nonce), '1', {
        NX: true,
        EX: ttlSeconds,
    });

    if (wasSet !== 'OK') {
        throw new Error('Upload token already used');
    }
};

const verifyAndConsumeUploadToken = async (token) => {
    const payload = verifyUploadToken(token);
    await consumeUploadTokenNonce(payload);
    return payload;
};

module.exports = {
    createUploadToken,
    verifyUploadToken,
    consumeUploadTokenNonce,
    verifyAndConsumeUploadToken,
};
