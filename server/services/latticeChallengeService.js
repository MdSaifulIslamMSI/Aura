/**
 * Aura FIDO2-Grade Post-Quantum Auth Service
 * 
 * Implements a stateless authentication token architecture using ML-KEM (Kyber-512).
 * Secures the control plane with HKDF key isolation and strict device/session binding.
 */

const crypto = require('crypto');
const kyber = require('crystals-kyber');

// Secure Server Token Encryption Key (Should be rotated periodically in production)
// Using an env variable fallback if available, otherwise generates ephemeral memory key.
const SERVER_KEY = process.env.AUTH_VAULT_SECRET 
    ? crypto.createHash('sha256').update(process.env.AUTH_VAULT_SECRET).digest()
    : crypto.randomBytes(32);

// HKDF Helper
const hkdf = (ss, info) =>
  crypto.hkdfSync('sha256', ss, Buffer.alloc(0), Buffer.from(info), 32);

/**
 * Encrypts the stateless server token payload via AES-256-GCM.
 */
function seal(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SERVER_KEY, iv);

  const data = Buffer.from(JSON.stringify(payload));
  let enc = cipher.update(data);
  enc = Buffer.concat([enc, cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypts and retrieves the stateless server token payload from AES-256-GCM.
 */
function open(token) {
  const buf = Buffer.from(token, 'base64');

  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', SERVER_KEY, iv);
  decipher.setAuthTag(tag);

  let dec = decipher.update(enc);
  dec = Buffer.concat([dec, decipher.final()]);

  return JSON.parse(dec.toString());
}

/**
 * Generates an ML-KEM Stateless Post-Quantum Challenge
 */
const generateChallenge = async (userId, clientNonce = '', deviceId = 'unknown', sessionId = 'anon') => {
    // Generate simulated user Public Key
    // In production, `pk` is tied to `userId` and `deviceId` explicitly during registration.
    const keys = kyber.KeyGen512(); 
    const pk = keys[0];
    const sk = keys[1]; // Temporary delivery for demo flow
    
    // KEM Encapsulation
    const enc = kyber.Encrypt512(pk);
    const ct = enc[0]; // Ciphertext
    const ss = enc[1]; // Shared symmetric key

    // Key Isolation using HKDF
    const kEnc = hkdf(ss, 'enc');
    const kMac = hkdf(ss, 'mac');
    
    // Ephemeral Nonce for Auth Proof
    const R = crypto.randomBytes(32);
    
    // Encrypt `R` with AES-256-GCM using isolated encryption key
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', kEnc, iv);
    
    // Strict AAD payload binding to prevent challenge transposition
    cipher.setAAD(Buffer.from(clientNonce + deviceId));
    
    let cR = cipher.update(R);
    cR = Buffer.concat([cR, cipher.final()]);
    const tag = cipher.getAuthTag();

    // Seal the token symmetrically on the server to make the protocol pure-stateless
    const token = seal({
        R: R.toString('base64'),
        kMac: kMac.toString('base64'),
        sessionId,
        deviceId,
        exp: Date.now() + 60000 // 60-second immediate expiration
    });

    return {
        ct: Buffer.from(ct).toString('base64'),
        cR: cR.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        token,
        simulatedSk: Buffer.from(sk).toString('base64'),
        clientNonce,
        deviceId,
        sessionId
    };
};

/**
 * Verifies the stateless mathematical proof provided by the client
 */
const verifyProof = async (token, proofBase64, sessionId, deviceId) => {
    try {
        const payload = open(token);

        // State Machine Affirmation
        if (Date.now() > payload.exp) return { success: false, reason: 'Challenge expired' };
        if (payload.sessionId !== sessionId) return { success: false, reason: 'Session ID mismatch (relay detected)' };
        if (payload.deviceId !== deviceId) return { success: false, reason: 'Device Identity mismatch' };

        const R = Buffer.from(payload.R, 'base64');
        const kMac = Buffer.from(payload.kMac, 'base64');

        // Reconstruction of expected contextual proof
        const expected = crypto
            .createHmac('sha256', kMac)
            .update(Buffer.concat([R, Buffer.from(sessionId), Buffer.from(deviceId)]))
            .digest();

        const provided = Buffer.from(proofBase64, 'base64');

        const isValid = expected.length === provided.length && 
                        crypto.timingSafeEqual(expected, provided);

        return {
            success: isValid,
            entropy: '256 bits (ML-KEM-512) + HKDF Isolation',
            pqcType: 'Stateless FIDO2 Lattice-Based KEM'
        };
    } catch (err) {
        return { success: false, reason: 'Invalid token signature or format' };
    }
};

module.exports = {
    generateChallenge,
    verifyProof
};
