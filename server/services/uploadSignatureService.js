const crypto = require('crypto');

const usedNonceStore = new Map();

const base64UrlEncode = (value) => Buffer.from(value).toString('base64url');
const base64UrlDecode = (value) => Buffer.from(String(value || ''), 'base64url').toString('utf8');

const getSigningSecret = () => {
        const configuredSecret = String(
            process.env.UPLOAD_SIGNING_SECRET
            || process.env.JWT_SECRET
            || ''
        ).trim();

        if (configuredSecret) {
            return configuredSecret;
        }

        if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
            throw new Error('UPLOAD_SIGNING_SECRET is required in production');
        }

        return 'dev-upload-secret-change-me';
};

const signPayload = (payloadJson) => {
    const secret = getSigningSecret();
    return crypto
        .createHmac('sha256', secret)
        .update(payloadJson)
        .digest('base64url');
};

const cleanupUsedNonceStore = () => {
    const now = Date.now();
    for (const [nonce, expiry] of usedNonceStore.entries()) {
        if (!expiry || expiry <= now) {
            usedNonceStore.delete(nonce);
        }
    }
};

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
    cleanupUsedNonceStore();

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

    if (!payload?.nonce || usedNonceStore.has(payload.nonce)) {
        throw new Error('Upload token already used');
    }

    return payload;
};

const markUploadTokenUsed = (payload) => {
    if (!payload?.nonce) return;
    const expMs = Number(payload.exp || 0) * 1000;
    usedNonceStore.set(payload.nonce, expMs);
    cleanupUsedNonceStore();
};

module.exports = {
    createUploadToken,
    verifyUploadToken,
    markUploadTokenUsed,
};
