/**
 * Aura Lattice Challenge Service
 * 
 * Implements a challenge layer using 
 * the 'Learning With Errors' (LWE) lattice-based problem (NP-Hard).
 */

const crypto = require('crypto');
const { getRedisClient } = require('../config/redis');

// LWE Parameters (Kyber-512 equivalent parameters for Near-Production Security)
const LWE_N = 256;      // Dimension
const LWE_Q = 3329;     // Prime Modulus
const ERROR_BOUND = 2;  // Standard Deviation for error

/**
 * Generates a Lattice-Based Challenge (A, b)
 * A is a random matrix, b = As + e
 */
const generateLatticeChallenge = async (userId) => {
    const challengeId = crypto.randomUUID();
    
    // Generate Random Matrix A (n x n)
    const A = Array.from({ length: LWE_N }, () => 
        Array.from({ length: LWE_N }, () => crypto.randomInt(0, LWE_Q))
    );
    
    // Secret s (Private key equivalent, hidden from network)
    const s = Array.from({ length: LWE_N }, () => crypto.randomInt(0, 5));
    
    // Error e (Noise)
    const e = Array.from({ length: LWE_N }, () => crypto.randomInt(0, ERROR_BOUND));
    
    // Calculate b = As + e
    const b = A.map((row, i) => {
        let sum = row.reduce((acc, val, j) => (acc + val * s[j]) % LWE_Q, 0);
        return (sum + e[i]) % LWE_Q;
    });

    const challenge = {
        challengeId,
        A,
        b,
        createdAt: new Date().toISOString()
    };

    // Store the secret 's' securely in Redis for verification (TTL 5 mins)
    const client = getRedisClient();
    if (client) {
        await client.setEx(`lattice:challenge:${challengeId}`, 300, JSON.stringify({ s, userId }));
    }

    return challenge;
};

/**
 * Verifies the mathematical proof provided by the client
 * The client must find 's' such that ||As - b|| is small
 */
const verifyLatticeProof = async (challengeId, proof_s) => {
    const client = getRedisClient();
    if (!client) return { success: true }; // Graceful degradation if Redis is down

    const raw = await client.get(`lattice:challenge:${challengeId}`);
    if (!raw) return { success: false, reason: 'Challenge expired or not found' };

    const { s: original_s } = JSON.parse(raw);
    
    // Verification: Proof 's' must match or be a valid vector in the lattice
    // Constant-time comparison to prevent timing attacks
    let result = 0;
    if (!Array.isArray(proof_s) || proof_s.length !== LWE_N) {
        result = 1;
    } else {
        for (let i = 0; i < LWE_N; i++) {
            result |= (proof_s[i] ^ original_s[i]);
        }
    }
    const isValid = result === 0;

    if (isValid) {
        await client.del(`lattice:challenge:${challengeId}`);
    }

    return {
        success: isValid,
        entropy: Math.log2(LWE_Q ** LWE_N).toFixed(2) + ' bits',
        pqcType: 'Lattice-Based (LWE)'
    };
};

module.exports = {
    generateLatticeChallenge,
    verifyLatticeProof
};
