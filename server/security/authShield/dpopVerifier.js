const { verifyDpopProof } = require('../../utils/dpop');

const getProofHeader = (req = {}) => String(
    req.headers?.dpop
    || req.headers?.DPoP
    || req.headers?.['x-aura-request-proof']
    || req.get?.('DPoP')
    || req.get?.('X-Aura-Request-Proof')
    || ''
).trim();

const decodeJwtPayload = (proof = '') => {
    const parts = String(proof || '').split('.');
    if (parts.length !== 3) return null;
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
        return null;
    }
};

const withCanonicalDpopHeader = (req = {}, proofHeader = '') => {
    const existingDpop = req.headers?.dpop || req.headers?.DPoP || req.get?.('DPoP');
    if (existingDpop) return req;

    return {
        ...req,
        headers: {
            ...(req.headers || {}),
            dpop: proofHeader,
        },
        get(name) {
            if (String(name || '').toLowerCase() === 'dpop') return proofHeader;
            return req.get?.(name);
        },
    };
};

const verifyRequestProof = async ({
    req = {},
    session = {},
    sensitivity = 'medium',
    config = {},
} = {}) => {
    const proofHeader = getProofHeader(req);
    const proofPayload = decodeJwtPayload(proofHeader);

    if (!config.dpopEnabled) {
        return {
            ok: true,
            enabled: false,
            shadow: true,
            jti: proofPayload?.jti || '',
            nonce: proofPayload?.nonce || '',
            reasons: proofHeader ? ['dpop_disabled_present'] : ['dpop_disabled_missing_proof'],
        };
    }

    if (!proofHeader) {
        return { ok: false, enabled: true, reasons: ['dpop_proof_missing'] };
    }

    const verification = await verifyDpopProof(
        withCanonicalDpopHeader(req, proofHeader),
        req.authSession?.dpopJwk || null,
    );
    if (!verification.success) {
        return { ok: false, enabled: true, reasons: [verification.reason || 'dpop_proof_invalid'] };
    }

    if (!proofPayload) {
        return { ok: false, enabled: true, reasons: ['dpop_payload_invalid'] };
    }

    if (session.bodyHash && ['high', 'critical'].includes(sensitivity)) {
        if (!proofPayload.body_hash) {
            return { ok: false, enabled: true, reasons: ['dpop_body_hash_missing'] };
        }
        if (String(proofPayload.body_hash) !== String(session.bodyHash)) {
            return { ok: false, enabled: true, reasons: ['dpop_body_hash_mismatch'] };
        }
    }

    return {
        ok: true,
        enabled: true,
        jti: proofPayload.jti || '',
        nonce: proofPayload.nonce || '',
        jwk: verification.jwk || null,
        reasons: [],
    };
};

module.exports = {
    decodeJwtPayload,
    getProofHeader,
    verifyRequestProof,
};
