const crypto = require('crypto');
const AppError = require('./AppError');

const DEFAULT_DIFFICULTY = Number(process.env.OTP_POW_DIFFICULTY || 3);
const CHALLENGE_TTL_MS = 60 * 1000; // 60 seconds

const getServerSecret = () => {
    const secret = String(process.env.OTP_CHALLENGE_SECRET || '').trim();
    if (!secret) {
        throw new AppError('OTP_CHALLENGE_SECRET is required for OTP Proof-of-Work challenges', 500);
    }
    return secret;
};

const timingSafeCompare = (str1, str2) => {
    const h1 = crypto.createHash('sha256').update(String(str1)).digest();
    const h2 = crypto.createHash('sha256').update(String(str2)).digest();
    return crypto.timingSafeEqual(h1, h2);
};

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizePhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

/**
 * Generate a signed PoW challenge token bound to the request context
 */
const generatePowChallenge = (ip, email, phone) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    const difficulty = DEFAULT_DIFFICULTY;

    const payload = {
        ip: String(ip || ''),
        email: normalizeEmail(email),
        phone: normalizePhone(phone),
        salt,
        expiresAt,
        difficulty,
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', getServerSecret())
        .update(payloadB64)
        .digest('base64url');

    return {
        powToken: `${payloadB64}.${signature}`,
        difficulty,
    };
};

/**
 * Verify a client-submitted PoW nonce against the signed token
 */
const verifyPowChallenge = (token, nonce, ip, email, phone) => {
    if (!token || nonce === undefined || nonce === null) return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [payloadB64, signature] = parts;

    // 1. Verify signature timing-safely
    const expectedSig = crypto.createHmac('sha256', getServerSecret())
        .update(payloadB64)
        .digest('base64url');

    if (!timingSafeCompare(signature, expectedSig)) {
        return false;
    }

    // 2. Decode and parse payload
    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        return false;
    }

    // 3. Verify expiry
    if (Date.now() > Number(payload.expiresAt || 0)) {
        return false;
    }

    // 4. Verify binding parameters
    if (payload.ip !== String(ip || '')) {
        return false;
    }
    if (normalizeEmail(payload.email) !== normalizeEmail(email)) {
        return false;
    }
    if (normalizePhone(payload.phone) !== normalizePhone(phone)) {
        return false;
    }

    // 5. Verify SHA-256 puzzle solution
    const difficulty = Number(payload.difficulty || DEFAULT_DIFFICULTY);
    const hash = crypto.createHash('sha256')
        .update(`${token}.${nonce}`)
        .digest('hex');

    return hash.startsWith('0'.repeat(difficulty));
};

module.exports = {
    generatePowChallenge,
    verifyPowChallenge,
};
