const crypto = require('crypto');

// HKDF-SHA256 (RFC 5869) subkey derivation.
//
// Every place this app turns a shared secret into an encryption or MAC key runs
// it through HKDF with a purpose-specific `context` instead of feeding the raw
// secret straight into SHA-256 or scrypt. Two reasons:
//
//   1. HKDF is the correct KDF for high-entropy input. A bare
//      `sha256(secret)` is a single compression round with no domain
//      separation and no extract step, so identical secrets fed to different
//      features yield identical keys.
//   2. The per-purpose `context` buys real domain separation. Two features that
//      happen to be configured with the same backing secret can never derive
//      the same subkey, so a compromise of one purpose does not immediately
//      compromise the other.
//
// FREEZING RULE: a `context` string is part of the on-disk format. Once a
// purpose ships with a context it is frozen forever. To change the derivation
// you add a NEW context and a NEW ciphertext format version, then keep the old
// context alive as a read-only legacy path — never edit an existing context.

const SUBKEY_BYTES = 32; // AES-256-GCM key length and HMAC-SHA256 key length
const HKDF_SALT = 'aura.kdf.v1';

const normalizeSecret = (secret) => (
    Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret ?? ''), 'utf8')
);

/**
 * Derive a purpose-bound subkey from a shared secret.
 *
 * @param {object} options
 * @param {string|Buffer} options.secret  High-entropy input keying material.
 * @param {string} options.context        Frozen per-purpose domain separator.
 * @param {number} [options.bytes]        Output length, 16..1024. Default 32.
 * @returns {Buffer}
 */
const deriveSubkey = ({ secret, context, bytes = SUBKEY_BYTES }) => {
    const normalizedContext = String(context || '').trim();
    if (!normalizedContext) {
        throw new Error('deriveSubkey requires a non-empty context');
    }

    const keyLength = Number(bytes);
    if (!Number.isInteger(keyLength) || keyLength < 16 || keyLength > 1024) {
        throw new Error('deriveSubkey bytes must be an integer between 16 and 1024');
    }

    return Buffer.from(crypto.hkdfSync(
        'sha256',
        normalizeSecret(secret),
        Buffer.from(HKDF_SALT, 'utf8'),
        Buffer.from(normalizedContext, 'utf8'),
        keyLength
    ));
};

// NOTE ON RETURN TYPE: these helpers return raw key BYTES (a Buffer), not a
// `crypto.Hmac` / `Cipher` object. Pass the result as the `key` argument:
//   crypto.createHmac('sha256', deriveHmacKey({...})).update(data)
//   crypto.createCipheriv('aes-256-gcm', deriveAes256GcmKey({...}), iv)
// Calling `.update()` directly on the return value throws.

/** Derive a 32-byte AES-256-GCM key for a named purpose. */
const deriveAes256GcmKey = ({ secret, context }) => (
    deriveSubkey({ secret, context, bytes: 32 })
);

/** Derive a 32-byte HMAC-SHA256 key for a named purpose. */
const deriveHmacKey = ({ secret, context }) => (
    deriveSubkey({ secret, context, bytes: 32 })
);

/**
 * Compare two hex digests in constant time.
 *
 * Centralised because `crypto.timingSafeEqual` throws on unequal lengths, and
 * every caller here wants "false" rather than a 500 in that case. Callers must
 * still normalise to a fixed-width encoding before comparing.
 */
const safeCompareHex = (left, right) => {
    const leftBuffer = Buffer.from(String(left ?? ''), 'hex');
    const rightBuffer = Buffer.from(String(right ?? ''), 'hex');
    if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

/** Constant-time compare for arbitrary base64url/utf8 token material. */
const safeCompareBase64Url = (left, right) => {
    const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
    const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
    if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isProduction = () => String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

module.exports = {
    HKDF_SALT,
    SUBKEY_BYTES,
    deriveSubkey,
    deriveAes256GcmKey,
    deriveHmacKey,
    safeCompareHex,
    safeCompareBase64Url,
    isProduction,
};
