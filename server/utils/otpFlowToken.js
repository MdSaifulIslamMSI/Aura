const crypto = require('crypto');
const AppError = require('./AppError');

const OTP_FLOW_TTL_SECONDS = 5 * 60;

const getSecret = () => {
    const secret = String(process.env.OTP_FLOW_SECRET || '').trim();
    if (secret) return secret;

    throw new AppError('OTP_FLOW_SECRET is required', 500);
};

const encodeBase64Url = (value) => Buffer.from(value, 'utf8').toString('base64url');

const signPayload = (payloadB64) => crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');

const decodePayload = (payloadB64) => {
    try {
        return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        throw new AppError('Login assurance token is invalid', 401);
    }
};

const verifySignature = (payloadB64, signature) => {
    const expectedSignature = signPayload(payloadB64);
    const expected = Buffer.from(expectedSignature, 'utf8');
    const actual = Buffer.from(String(signature || ''), 'utf8');

    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw new AppError('Login assurance token is invalid', 401);
    }
};

const issueOtpFlowToken = ({ userId, purpose, factor = '' }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + OTP_FLOW_TTL_SECONDS;
    const payload = {
        sub: String(userId || ''),
        purpose: String(purpose || ''),
        factor: String(factor || ''),
        iat: nowSec,
        exp: expSec,
    };

    const payloadB64 = encodeBase64Url(JSON.stringify(payload));
    const signature = signPayload(payloadB64);

    return {
        flowToken: `${payloadB64}.${signature}`,
        flowTokenExpiresAt: new Date(expSec * 1000).toISOString(),
    };
};

const verifyOtpFlowToken = ({ token, expectedPurpose = '', expectedSubject = '', expectedFactor = '' }) => {
    const safeToken = String(token || '').trim();
    if (!safeToken || safeToken.length > 4096) {
        throw new AppError('Login assurance token is invalid', 401);
    }

    const [payloadB64 = '', signature = '', extra = ''] = safeToken.split('.');
    if (!payloadB64 || !signature || extra) {
        throw new AppError('Login assurance token is invalid', 401);
    }

    verifySignature(payloadB64, signature);
    const payload = decodePayload(payloadB64);

    const issuedAt = Number(payload?.iat || 0);
    const expiresAt = Number(payload?.exp || 0);
    const nowSec = Math.floor(Date.now() / 1000);

    if (!payload?.sub || !payload?.purpose || !issuedAt || !expiresAt) {
        throw new AppError('Login assurance token is invalid', 401);
    }
    if (expiresAt <= nowSec) {
        throw new AppError('Login assurance token expired. Please verify OTP again.', 401);
    }
    if (expectedPurpose && payload.purpose !== expectedPurpose) {
        throw new AppError('Login assurance token purpose mismatch', 403);
    }
    if (expectedSubject && String(payload.sub) !== String(expectedSubject)) {
        throw new AppError('Login assurance token does not match this account', 403);
    }
    if (expectedFactor && String(payload.factor || '') !== String(expectedFactor)) {
        throw new AppError('Login assurance token factor mismatch', 403);
    }

    return {
        sub: String(payload.sub),
        purpose: String(payload.purpose),
        factor: String(payload.factor || ''),
        iat: issuedAt,
        exp: expiresAt,
    };
};

module.exports = {
    issueOtpFlowToken,
    verifyOtpFlowToken,
    OTP_FLOW_TTL_SECONDS,
};
