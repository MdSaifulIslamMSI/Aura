const crypto = require('crypto');
const AppError = require('./AppError');

const OTP_FLOW_TTL_SECONDS = 5 * 60;
const OTP_FLOW_TOKEN_VERSION = 'v1';
const OTP_FLOW_TOKEN_KEY_CONTEXT = 'aura-otp-flow-token';
const OTP_FLOW_TOKEN_ALGORITHM = 'aes-256-gcm';

const getSecret = () => {
    const secret = String(process.env.OTP_FLOW_SECRET || '').trim();
    if (secret) return secret;

    throw new AppError('OTP_FLOW_SECRET is required', 500);
};

const encodeBase64Url = (value) => Buffer.from(value, 'utf8').toString('base64url');
const normalizeOptionalText = (value, maxLength = 256) => String(value || '').trim().slice(0, maxLength);
const createInvalidTokenError = () => new AppError('Login assurance token is invalid', 401);

const signPayload = (payloadB64) => crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');

const decodePayload = (payloadB64) => {
    try {
        return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        throw createInvalidTokenError();
    }
};

const verifySignature = (payloadB64, signature) => {
    const expectedSignature = signPayload(payloadB64);
    const expected = Buffer.from(expectedSignature, 'utf8');
    const actual = Buffer.from(String(signature || ''), 'utf8');

    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw createInvalidTokenError();
    }
};

const deriveEncryptionKey = () => crypto.createHash('sha256')
    .update(`${getSecret()}:${OTP_FLOW_TOKEN_KEY_CONTEXT}`)
    .digest();

const encryptPayload = (payload) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(OTP_FLOW_TOKEN_ALGORITHM, deriveEncryptionKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
};

const decryptPayload = (encodedPayload) => {
    try {
        const buffer = Buffer.from(String(encodedPayload || ''), 'base64url');
        if (buffer.length <= 28) {
            throw new Error('token too short');
        }

        const iv = buffer.subarray(0, 12);
        const tag = buffer.subarray(12, 28);
        const ciphertext = buffer.subarray(28);
        const decipher = crypto.createDecipheriv(OTP_FLOW_TOKEN_ALGORITHM, deriveEncryptionKey(), iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(plaintext.toString('utf8'));
    } catch {
        throw createInvalidTokenError();
    }
};

const normalizeSignalBond = (signalBond = {}) => {
    const normalized = {};
    const deviceId = normalizeOptionalText(signalBond.deviceId, 256);
    const authUid = normalizeOptionalText(signalBond.authUid, 256);
    const sessionId = normalizeOptionalText(signalBond.sessionId, 256);
    const deviceMethod = normalizeOptionalText(signalBond.deviceMethod, 64).toLowerCase();
    const riskState = normalizeOptionalText(signalBond.riskState, 64).toLowerCase();

    if (deviceId) normalized.deviceId = deviceId;
    if (authUid) normalized.authUid = authUid;
    if (sessionId) normalized.sessionId = sessionId;
    if (deviceMethod) normalized.deviceMethod = deviceMethod;
    if (riskState) normalized.riskState = riskState;

    return normalized;
};

const assertSignalBond = (actualSignalBond = {}, expectedSignalBond = {}) => {
    const actual = normalizeSignalBond(actualSignalBond);
    const expected = normalizeSignalBond(expectedSignalBond);

    for (const [key, value] of Object.entries(expected)) {
        if (!value) continue;
        if (!actual[key]) {
            throw new AppError(
                key === 'deviceId'
                    ? 'Login assurance token device bond mismatch'
                    : key === 'authUid'
                        ? 'Login assurance token identity bond mismatch'
                        : 'Login assurance token signal bond mismatch',
                403
            );
        }
    }

    for (const [key, value] of Object.entries(actual)) {
        if (!value) continue;

        const expectedValue = expected[key];
        if (!expectedValue) {
            throw new AppError(
                key === 'deviceId'
                    ? 'Login assurance token device bond is required'
                    : 'Login assurance token signal bond is required',
                403
            );
        }

        if (expectedValue !== value) {
            throw new AppError(
                key === 'deviceId'
                    ? 'Login assurance token device bond mismatch'
                    : key === 'authUid'
                        ? 'Login assurance token identity bond mismatch'
                        : 'Login assurance token signal bond mismatch',
                403
            );
        }
    }

    return actual;
};

const issueOtpFlowToken = ({ userId, purpose, factor = '', signalBond = {} }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + OTP_FLOW_TTL_SECONDS;
    const normalizedSignalBond = normalizeSignalBond(signalBond);
    const payload = {
        typ: 'otp_flow',
        sub: String(userId || ''),
        purpose: String(purpose || ''),
        factor: String(factor || ''),
        iat: nowSec,
        exp: expSec,
        ...(Object.keys(normalizedSignalBond).length > 0 ? { bond: normalizedSignalBond } : {}),
    };

    return {
        flowToken: `${OTP_FLOW_TOKEN_VERSION}.${encryptPayload(payload)}`,
        flowTokenExpiresAt: new Date(expSec * 1000).toISOString(),
    };
};

const decodeTokenPayload = (safeToken) => {
    const [first = '', second = '', extra = ''] = safeToken.split('.');

    if (!first || !second || extra) {
        throw createInvalidTokenError();
    }

    if (first === OTP_FLOW_TOKEN_VERSION) {
        return decryptPayload(second);
    }

    verifySignature(first, second);
    return decodePayload(first);
};

const verifyOtpFlowToken = ({
    token,
    expectedPurpose = '',
    expectedSubject = '',
    expectedFactor = '',
    expectedSignalBond = {},
}) => {
    const safeToken = String(token || '').trim();
    if (!safeToken || safeToken.length > 4096) {
        throw createInvalidTokenError();
    }

    const payload = decodeTokenPayload(safeToken);

    const issuedAt = Number(payload?.iat || 0);
    const expiresAt = Number(payload?.exp || 0);
    const nowSec = Math.floor(Date.now() / 1000);

    if (payload?.typ && payload.typ !== 'otp_flow') {
        throw createInvalidTokenError();
    }
    if (!payload?.sub || !payload?.purpose || !issuedAt || !expiresAt) {
        throw createInvalidTokenError();
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

    const signalBond = assertSignalBond(payload?.bond || {}, expectedSignalBond);

    return {
        sub: String(payload.sub),
        purpose: String(payload.purpose),
        factor: String(payload.factor || ''),
        iat: issuedAt,
        exp: expiresAt,
        signalBond,
    };
};

module.exports = {
    issueOtpFlowToken,
    verifyOtpFlowToken,
    OTP_FLOW_TTL_SECONDS,
};
