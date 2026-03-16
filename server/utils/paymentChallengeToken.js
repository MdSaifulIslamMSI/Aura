const crypto = require('crypto');
const AppError = require('./AppError');

const CHALLENGE_TTL_SECONDS = 10 * 60;

const getSecret = () => {
    const secret = String(process.env.OTP_CHALLENGE_SECRET || process.env.JWT_SECRET || '').trim();
    if (secret) return secret;

    if (process.env.NODE_ENV === 'production') {
        throw new AppError('OTP_CHALLENGE_SECRET is required in production', 500);
    }
    return 'dev-payment-challenge-secret';
};

const encodeBase64Url = (value) => Buffer.from(value, 'utf8').toString('base64url');
const decodeBase64Url = (value) => Buffer.from(value, 'base64url').toString('utf8');

const signPayload = (payloadB64) => {
    const secret = getSecret();
    return crypto
        .createHmac('sha256', secret)
        .update(payloadB64)
        .digest('base64url');
};

const issuePaymentChallengeToken = ({ userId, phone, intentId = '' }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + CHALLENGE_TTL_SECONDS;
    const payload = {
        sub: String(userId || ''),
        phone: String(phone || ''),
        intentId: String(intentId || ''),
        purpose: 'payment-challenge',
        iat: nowSec,
        exp: expSec,
    };

    const payloadB64 = encodeBase64Url(JSON.stringify(payload));
    const signature = signPayload(payloadB64);

    return {
        challengeToken: `${payloadB64}.${signature}`,
        challengeExpiresAt: new Date(expSec * 1000).toISOString(),
    };
};

const verifyPaymentChallengeToken = (token) => {
    const raw = String(token || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new AppError('Invalid challenge token', 400);
    }

    const [payloadB64, signature] = parts;
    const expected = signPayload(payloadB64);
    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
        signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
        throw new AppError('Invalid challenge token signature', 400);
    }

    let payload;
    try {
        payload = JSON.parse(decodeBase64Url(payloadB64));
    } catch {
        throw new AppError('Malformed challenge token payload', 400);
    }

    if (payload.purpose !== 'payment-challenge') {
        throw new AppError('Invalid challenge token purpose', 400);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec) {
        throw new AppError('Challenge token expired. Please verify OTP again.', 410);
    }

    return payload;
};

module.exports = {
    issuePaymentChallengeToken,
    verifyPaymentChallengeToken,
    CHALLENGE_TTL_SECONDS,
};
