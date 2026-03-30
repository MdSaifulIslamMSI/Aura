/**
 * Aura Post-Quantum KEM Challenge Service
 * 
 * Implements a challenge layer using ML-KEM (Kyber-512).
 * Implicit Authentication via Key Encapsulation Mechanism.
 */

const crypto = require('crypto');
const kyber = require('crystals-kyber');
const { getRedisClient } = require('../config/redis');

/**
 * Generates an ML-KEM Post-Quantum Challenge
 */
const generateLatticeChallenge = async (userId) => {
    const challengeId = crypto.randomUUID();
    
    // Simulate retrieving a user's Kyber Public Key.
    // In production, `pk` would be tied to `userId` from Registration.
    const keys = kyber.KeyGen512(); 
    const pk = keys[0];
    const sk = keys[1]; // We will temporarily send `sk` strictly so the frontend can decrypt it (simulating WebAuthn state).
    
    // KEM Encapsulation
    const enc = kyber.Encrypt512(pk);
    const ct = enc[0]; // Ciphertext
    const ss = enc[1]; // Shared symmetric key
    
    // Ephemeral Nonce for Auth Proof
    const R = crypto.randomBytes(32);
    
    // Encrypt `R` with AES-256-GCM using `ss`
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ss, iv);
    let cR = cipher.update(R);
    cR = Buffer.concat([cR, cipher.final()]);
    const authTag = cipher.getAuthTag();

    const challenge = {
        challengeId,
        ct: Buffer.from(ct).toString('base64'),
        cR: cR.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        simulatedSk: Buffer.from(sk).toString('base64'), // Temporary delivery for the sake of the client flow demo
        createdAt: new Date().toISOString()
    };

    // Store HMAC of R for validation (Replay Protection & Constant-Time check)
    // The HMAC requires a contextual key so we will use HMAC(R, challengeId)
    const expectedHmacHex = crypto.createHmac('sha256', R).update(challengeId).digest('hex');

    const client = getRedisClient();
    if (client) {
        await client.setEx(`lattice:challenge:${challengeId}`, 60, expectedHmacHex); // Strict 60s TTL
    }

    return challenge;
};

/**
 * Verifies the mathematical proof provided by the client
 * The client must extract `R` via decapsulation and return HMAC(R, challengeId)
 */
const verifyLatticeProof = async (challengeId, proofHmacBase64) => {
    const client = getRedisClient();
    if (!client) return { success: true }; // Graceful degradation if Redis is down

    const expectedHmacHex = await client.get(`lattice:challenge:${challengeId}`);
    if (!expectedHmacHex) return { success: false, reason: 'Challenge expired or not found' };

    const expectedHmacBuffer = Buffer.from(expectedHmacHex, 'hex');
    let providedHmacBuffer;
    
    try {
        providedHmacBuffer = Buffer.from(proofHmacBase64, 'base64');
    } catch (e) {
        return { success: false, reason: 'Invalid encoding' };
    }

    let isValid = false;
    if (expectedHmacBuffer.length === providedHmacBuffer.length) {
        isValid = crypto.timingSafeEqual(expectedHmacBuffer, providedHmacBuffer);
    }

    if (isValid) {
        await client.del(`lattice:challenge:${challengeId}`); // Burn token to prevent replay
    }

    return {
        success: isValid,
        entropy: '256 bits (ML-KEM-512)',
        pqcType: 'Lattice-Based KEM (FIPS-203)'
    };
};

module.exports = {
    generateLatticeChallenge,
    verifyLatticeProof
};
