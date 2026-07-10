const crypto = require('crypto');
const { getRedisClient, flags: redisFlags } = require('../config/redis');
const logger = require('./logger');

const seenJtis = new Map();

const normalizeJti = (value) => {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    return normalized.length >= 1 && normalized.length <= 256 ? normalized : '';
};

const buildJtiReplayKey = (jti) => crypto
    .createHash('sha256')
    .update(jti)
    .digest('hex');

// Periodically clean expired JTIs from memory
setInterval(() => {
    const now = Date.now();
    for (const [jti, expiresAt] of seenJtis.entries()) {
        if (expiresAt <= now) {
            seenJtis.delete(jti);
        }
    }
}, 60 * 1000).unref();

const jwkMatches = (jwk1, jwk2) => {
    if (!jwk1 || !jwk2) return false;
    if (typeof jwk2 === 'string') {
        try {
            jwk2 = JSON.parse(jwk2);
        } catch {
            return false;
        }
    }
    if (jwk1.kty !== jwk2.kty) return false;
    if (jwk1.kty === 'EC') {
        return jwk1.crv === jwk2.crv && jwk1.x === jwk2.x && jwk1.y === jwk2.y;
    }
    if (jwk1.kty === 'RSA') {
        return jwk1.n === jwk2.n && jwk1.e === jwk2.e;
    }
    return false;
};

const getCachedRequestVerification = (req, dpopHeader, expectedJwk) => {
    const cached = req?._dpopVerification;
    if (!cached || cached.dpopHeader !== dpopHeader || !cached.jwk) {
        return null;
    }

    if (expectedJwk && !jwkMatches(cached.jwk, expectedJwk)) {
        return { success: false, reason: 'DPoP key binding mismatch' };
    }

    return {
        success: true,
        jwk: cached.jwk,
    };
};

const cacheRequestVerification = (req, dpopHeader, jwk) => {
    if (!req || !dpopHeader || !jwk) return;
    req._dpopVerification = {
        dpopHeader,
        jwk,
    };
};

const verifyDpopProof = async (req, expectedJwk) => {
    const dpopHeader = req.headers?.dpop || req.headers?.DPoP || req.get?.('DPoP');
    if (!dpopHeader) {
        return { success: false, reason: 'DPoP header is required' };
    }

    const cachedVerification = getCachedRequestVerification(req, dpopHeader, expectedJwk);
    if (cachedVerification) {
        return cachedVerification;
    }

    const parts = dpopHeader.split('.');
    if (parts.length !== 3) {
        return { success: false, reason: 'Invalid DPoP token format' };
    }

    let header, payload;
    try {
        header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (err) {
        return { success: false, reason: 'Failed to decode DPoP headers or payload' };
    }

    // 1. Validate header claims
    if (header.typ !== 'dpop+jwt') {
        return { success: false, reason: 'Invalid typ claim in DPoP header' };
    }
    if (header.alg !== 'ES256') {
        return { success: false, reason: 'Unsupported alg in DPoP header, only ES256 is supported' };
    }
    if (!header.jwk || typeof header.jwk !== 'object') {
        return { success: false, reason: 'Missing jwk claim in DPoP header' };
    }

    // 2. Validate expected JWK matches
    if (expectedJwk && !jwkMatches(header.jwk, expectedJwk)) {
        return { success: false, reason: 'DPoP key binding mismatch' };
    }

    // 3. Verify signature
    try {
        const publicKey = crypto.createPublicKey({ key: header.jwk, format: 'jwk' });
        const signingInput = `${parts[0]}.${parts[1]}`;
        const signature = Buffer.from(parts[2], 'base64url');

        const isVerified = crypto.verify(
            'sha256',
            Buffer.from(signingInput),
            {
                key: publicKey,
                dsaEncoding: 'ieee-p1363' // JWT uses IEEE-P1363 signature encoding for ECDSA (64 bytes raw)
            },
            signature
        );

        if (!isVerified) {
            return { success: false, reason: 'Invalid DPoP signature' };
        }
    } catch (err) {
        return { success: false, reason: `DPoP signature verification error: ${err.message}` };
    }

    // 4. Validate HTM (HTTP Method)
    if (String(payload.htm || '').toLowerCase() !== req.method.toLowerCase()) {
        return { success: false, reason: `HTM mismatch: expected ${req.method}, got ${payload.htm}` };
    }

    // 5. Validate HTU (HTTP URI)
    if (!payload.htu) {
        return { success: false, reason: 'Missing htu claim in DPoP payload' };
    }
    try {
        // Parse htu as URL (if full) or path
        const dpopUrl = new URL(payload.htu, 'http://localhost');
        const dpopPath = dpopUrl.pathname;
        const reqPath = req.originalUrl ? req.originalUrl.split('?')[0] : (req.baseUrl ? (req.baseUrl + req.path) : req.path);
        if (dpopPath !== reqPath) {
            return { success: false, reason: `HTU pathname mismatch: expected ${reqPath}, got ${dpopPath}` };
        }
    } catch (err) {
        return { success: false, reason: 'Invalid htu format' };
    }

    // 6. Validate IAT (Issued At)
    const now = Math.floor(Date.now() / 1000);
    const iat = Number(payload.iat);
    if (Number.isNaN(iat)) {
        return { success: false, reason: 'Invalid iat claim' };
    }
    const age = Math.abs(now - iat);
    if (age > 60) {
        return { success: false, reason: 'DPoP proof expired' };
    }

    // 7. Validate JTI (prevent replay attacks)
    const jti = normalizeJti(payload.jti);
    if (!jti) {
        return {
            success: false,
            reason: payload.jti === undefined || payload.jti === null || payload.jti === ''
                ? 'Missing jti claim'
                : 'Invalid jti claim',
        };
    }
    const client = getRedisClient();
    if (client) {
        try {
            const jtiKey = `${redisFlags.redisPrefix}:dpop:jti:${buildJtiReplayKey(jti)}`;
            const ok = await client.set(jtiKey, '1', { NX: true, EX: 60 });
            if (!ok) {
                return { success: false, reason: 'DPoP jti replay detected' };
            }
        } catch (err) {
            logger.warn('dpop.jti_redis_check_failed', { error: err.message });
            return { success: false, reason: 'DPoP replay protection unavailable' };
        }
    } else {
        if (seenJtis.has(jti)) {
            return { success: false, reason: 'DPoP jti replay detected' };
        }
        seenJtis.set(jti, Date.now() + 60000);
    }

    cacheRequestVerification(req, dpopHeader, header.jwk);
    return { success: true, jwk: header.jwk, jti };
};

module.exports = {
    verifyDpopProof,
    jwkMatches
};
