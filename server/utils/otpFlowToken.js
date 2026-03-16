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

const issueOtpFlowToken = ({ userId, purpose }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + OTP_FLOW_TTL_SECONDS;
    const payload = {
        sub: String(userId || ''),
        purpose: String(purpose || ''),
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

module.exports = {
    issueOtpFlowToken,
    OTP_FLOW_TTL_SECONDS,
};
