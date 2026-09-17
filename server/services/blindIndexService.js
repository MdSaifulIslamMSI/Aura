const crypto = require('crypto');
const AppError = require('../utils/AppError');

// Deterministic keyed hashes (blind indexes) that preserve EQUALITY search over
// encrypted-at-rest fields. The hash is computed from the exact stored value, so
// `field: { $in: values }` becomes `fieldHash: { $in: values.map(hash) }` with
// identical matching semantics (including historical format quirks), while the
// plaintext itself can be encrypted. Uniqueness indexes move onto the hash with
// unchanged conflict behavior (HMAC is deterministic + collision-resistant).
//
// The secret is a server-side pepper: the index reveals nothing without it.

const getPhoneBlindIndexSecret = () => {
    const secret = String(
        process.env.PHONE_BLIND_INDEX_SECRET
        || process.env.OTP_FLOW_SECRET
        || process.env.JWT_SECRET
        || ''
    ).trim();
    if (secret) return secret;
    if (process.env.NODE_ENV === 'test') return 'aura-test-phone-blind-index-secret';
    throw new AppError('Phone blind index secret is not configured', 500);
};

const getEmailBlindIndexSecret = () => {
    const secret = String(
        process.env.EMAIL_BLIND_INDEX_SECRET
        || process.env.OTP_FLOW_SECRET
        || process.env.JWT_SECRET
        || ''
    ).trim();
    if (secret) return secret;
    if (process.env.NODE_ENV === 'test') return 'aura-test-email-blind-index-secret';
    throw new AppError('Email blind index secret is not configured', 500);
};

const computeBlindIndex = (value, secret) => crypto
    .createHmac('sha256', secret)
    .update(String(value ?? ''))
    .digest('hex');

// The exact stored value: User.phone's schema setter normalizes (trim/strip),
// so hashing the post-setter value keeps hash <-> ciphertext consistent.
const computePhoneBlindIndex = (phone) => (
    phone === undefined || phone === null || phone === ''
        ? null
        : computeBlindIndex(String(phone), getPhoneBlindIndexSecret())
);

const normalizeEmailForIndex = (value) => String(value ?? '').trim().toLowerCase();

const computeEmailBlindIndex = (email) => {
    const normalized = normalizeEmailForIndex(email);
    return normalized ? computeBlindIndex(normalized, getEmailBlindIndexSecret()) : null;
};

module.exports = {
    computePhoneBlindIndex,
    computeEmailBlindIndex,
    normalizeEmailForIndex,
};
