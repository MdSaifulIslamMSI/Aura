'use strict';

const crypto = require('crypto');
const {
    SIGNATURE_ALGORITHM,
    SLH_DSA_ALGORITHM,
    assertPqcSignatureAvailable,
    assertSlhDsaAvailable,
} = require('./algorithms');
const {
    loadSigningKeyRecord,
    loadSlhDsaKeyRecord,
    publicSigningKeysFromRecord,
    publicSlhDsaKeyFromRecord,
    fromBase64Url,
} = require('./keyMaterial');

// Hybrid signatures require BOTH Ed25519 and ML-DSA-65 to verify. A classical
// forgery is not enough, and a future quantum break of Ed25519 alone is not
// enough. Signatures are domain-separated by purpose and context so a token
// signed for one subsystem cannot be replayed into another.

const SIGNATURE_VERSION = 1;
const HYBRID_TOKEN_PREFIX = 'pqcsig1';
const SLH_TOKEN_PREFIX = 'slhdsa1';
const DEFAULT_CONTEXT = 'aura:security-event';
const SIGNATURE_DOMAIN = 'aura:pqc:hybrid-signature:v1';
const SLH_DOMAIN = 'aura:pqc:slh-dsa-signature:v1';
const ED25519_SIGNATURE_BYTES = 64;
const ML_DSA_65_SIGNATURE_BYTES = 3309;
const SLH_DSA_SHA2_128S_SIGNATURE_BYTES = 7856;

const lengthPrefix = (buffer) => {
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(buffer.length, 0);
    return Buffer.concat([prefix, buffer]);
};

const toMessageBuffer = (message) => {
    if (Buffer.isBuffer(message)) return message;
    if (message instanceof Uint8Array) return Buffer.from(message);
    if (typeof message === 'string') return Buffer.from(message, 'utf8');
    throw new Error('PQC signature message must be a Buffer, Uint8Array, or string');
};

const normalizeContext = (context) => {
    if (context === undefined || context === null || context === '') return DEFAULT_CONTEXT;
    if (typeof context !== 'string') throw new Error('PQC signature context must be a string');
    return context;
};

const buildSignedMessage = (message, context, domain = SIGNATURE_DOMAIN) => Buffer.concat([
    lengthPrefix(Buffer.from(domain, 'utf8')),
    lengthPrefix(Buffer.from(normalizeContext(context), 'utf8')),
    lengthPrefix(toMessageBuffer(message)),
]);

const encode = (buffer) => Buffer.from(buffer).toString('base64url');

const assertSignatureLength = (signature, expected, label) => {
    if (!Buffer.isBuffer(signature) || signature.length !== expected) {
        throw new Error(`${label} signature must be ${expected} bytes`);
    }
    return signature;
};

const normalizeSigningPrivate = (recordOrLoaded) => {
    if (recordOrLoaded?.privateKeys && recordOrLoaded?.keyId) return recordOrLoaded;
    return loadSigningKeyRecord(recordOrLoaded);
};

const normalizeSigningPublic = (recordOrLoaded) => {
    if (recordOrLoaded?.publicKeys && recordOrLoaded?.keyId) return recordOrLoaded;
    const publicKeys = publicSigningKeysFromRecord(recordOrLoaded);
    return { keyId: publicKeys.keyId, publicKeys };
};

const normalizeSlhPrivate = (recordOrLoaded) => {
    if (recordOrLoaded?.privateKeys && recordOrLoaded?.keyId) return recordOrLoaded;
    return loadSlhDsaKeyRecord(recordOrLoaded);
};

const normalizeSlhPublic = (recordOrLoaded) => {
    if (recordOrLoaded?.publicKeys && recordOrLoaded?.keyId) return recordOrLoaded;
    const publicKeys = publicSlhDsaKeyFromRecord(recordOrLoaded);
    return { keyId: publicKeys.keyId, publicKeys };
};

/**
 * Sign with Ed25519 and ML-DSA-65 over the same domain-separated payload.
 */
const sign = (message, keyRecord, { context } = {}) => {
    assertPqcSignatureAvailable();
    const signingKey = normalizeSigningPrivate(keyRecord);
    const payload = buildSignedMessage(message, context);

    const ed25519 = crypto.sign(null, payload, signingKey.privateKeys.ed25519);
    const mlDsa = crypto.sign(null, payload, signingKey.privateKeys.mlDsa);
    assertSignatureLength(ed25519, ED25519_SIGNATURE_BYTES, 'Ed25519');
    assertSignatureLength(mlDsa, ML_DSA_65_SIGNATURE_BYTES, 'ML-DSA-65');

    return {
        v: SIGNATURE_VERSION,
        alg: SIGNATURE_ALGORITHM,
        keyId: signingKey.keyId,
        ed25519: encode(ed25519),
        mlDsa: encode(mlDsa),
    };
};

const parseSignature = (signatureOrToken) => {
    let signature;
    if (typeof signatureOrToken === 'string') {
        if (!signatureOrToken.startsWith(`${HYBRID_TOKEN_PREFIX}.`)) {
            throw new Error('PQC signature token is not a v1 hybrid signature');
        }
        const parts = signatureOrToken.split('.');
        if (parts.length !== 4) throw new Error('PQC hybrid signature token must have 4 segments');
        signature = {
            v: SIGNATURE_VERSION,
            alg: SIGNATURE_ALGORITHM,
            keyId: parts[1],
            ed25519: parts[2],
            mlDsa: parts[3],
        };
    } else if (signatureOrToken && typeof signatureOrToken === 'object' && !Array.isArray(signatureOrToken)) {
        signature = { ...signatureOrToken };
    } else {
        throw new Error('PQC signature must be a token string or object');
    }

    if (Number(signature.v) !== SIGNATURE_VERSION) {
        throw new Error(`Unsupported PQC signature version: ${signature.v}`);
    }
    if (signature.alg !== SIGNATURE_ALGORITHM) {
        throw new Error(`Unsupported PQC signature algorithm: ${signature.alg}`);
    }
    for (const field of ['keyId', 'ed25519', 'mlDsa']) {
        if (typeof signature[field] !== 'string' || !signature[field]) {
            throw new Error(`PQC signature is missing ${field}`);
        }
    }
    return {
        v: SIGNATURE_VERSION,
        alg: SIGNATURE_ALGORITHM,
        keyId: signature.keyId,
        ed25519: signature.ed25519,
        mlDsa: signature.mlDsa,
    };
};

const serializeSignature = (signature) => {
    const normalized = parseSignature(signature);
    return [
        HYBRID_TOKEN_PREFIX,
        normalized.keyId,
        normalized.ed25519,
        normalized.mlDsa,
    ].join('.');
};

/**
 * Verify both signatures. Returns a structured result instead of a bare
 * boolean so callers can record which half failed without leaking key bytes.
 * A thrown parse/length error is a malformed signature, not a valid one.
 */
const verify = (message, signatureOrToken, publicKeyRecord, { context } = {}) => {
    assertPqcSignatureAvailable();
    const signature = parseSignature(signatureOrToken);
    const verificationKey = normalizeSigningPublic(publicKeyRecord);
    if (signature.keyId !== verificationKey.keyId) {
        return { valid: false, keyId: verificationKey.keyId, ed25519: false, mlDsa: false, reason: 'key-id-mismatch' };
    }

    const payload = buildSignedMessage(message, context);
    const ed25519Signature = fromBase64Url(signature.ed25519, 'ed25519');
    const mlDsaSignature = fromBase64Url(signature.mlDsa, 'mlDsa');
    assertSignatureLength(ed25519Signature, ED25519_SIGNATURE_BYTES, 'Ed25519');
    assertSignatureLength(mlDsaSignature, ML_DSA_65_SIGNATURE_BYTES, 'ML-DSA-65');

    let ed25519 = false;
    let mlDsa = false;
    try {
        ed25519 = crypto.verify(null, payload, verificationKey.publicKeys.ed25519, ed25519Signature);
    } catch {
        ed25519 = false;
    }
    try {
        mlDsa = crypto.verify(null, payload, verificationKey.publicKeys.mlDsa, mlDsaSignature);
    } catch {
        mlDsa = false;
    }

    return {
        valid: ed25519 && mlDsa,
        keyId: verificationKey.keyId,
        ed25519,
        mlDsa,
        reason: ed25519 && mlDsa ? null : 'signature-verification-failed',
    };
};

const verifyOrThrow = (message, signature, publicKeyRecord, options) => {
    const result = verify(message, signature, publicKeyRecord, options);
    if (!result.valid) {
        throw new Error(`Hybrid PQC signature verification failed (${result.reason})`);
    }
    return result;
};

/**
 * SLH-DSA is reserved for long-lived offline checkpoints. It is not a request
 * path primitive: keys and signatures are large and signing is intentionally
 * slow. The hybrid Ed25519+ML-DSA path remains the online default.
 */
const signSlhDsa = (message, keyRecord, { context } = {}) => {
    assertSlhDsaAvailable();
    const signingKey = normalizeSlhPrivate(keyRecord);
    const payload = buildSignedMessage(message, context, SLH_DOMAIN);
    const signature = crypto.sign(null, payload, signingKey.privateKeys.slhDsa);
    assertSignatureLength(signature, SLH_DSA_SHA2_128S_SIGNATURE_BYTES, 'SLH-DSA-SHA2-128s');
    return {
        v: SIGNATURE_VERSION,
        alg: SLH_DSA_ALGORITHM,
        keyId: signingKey.keyId,
        slhDsa: encode(signature),
    };
};

const verifySlhDsa = (message, signatureOrToken, publicKeyRecord, { context } = {}) => {
    assertSlhDsaAvailable();
    let signature;
    if (typeof signatureOrToken === 'string') {
        if (!signatureOrToken.startsWith(`${SLH_TOKEN_PREFIX}.`)) {
            throw new Error('PQC signature token is not a v1 SLH-DSA signature');
        }
        const parts = signatureOrToken.split('.');
        if (parts.length !== 3) throw new Error('SLH-DSA token must have 3 segments');
        signature = {
            v: SIGNATURE_VERSION,
            alg: SLH_DSA_ALGORITHM,
            keyId: parts[1],
            slhDsa: parts[2],
        };
    } else if (signatureOrToken && typeof signatureOrToken === 'object') {
        signature = { ...signatureOrToken };
    } else {
        throw new Error('SLH-DSA signature must be a token string or object');
    }

    if (Number(signature.v) !== SIGNATURE_VERSION || signature.alg !== SLH_DSA_ALGORITHM) {
        throw new Error('Unsupported SLH-DSA signature envelope');
    }
    const verificationKey = normalizeSlhPublic(publicKeyRecord);
    if (signature.keyId !== verificationKey.keyId) {
        return { valid: false, keyId: verificationKey.keyId, reason: 'key-id-mismatch' };
    }
    const raw = fromBase64Url(signature.slhDsa, 'slhDsa');
    assertSignatureLength(raw, SLH_DSA_SHA2_128S_SIGNATURE_BYTES, 'SLH-DSA-SHA2-128s');
    const payload = buildSignedMessage(message, context, SLH_DOMAIN);
    let valid = false;
    try {
        valid = crypto.verify(null, payload, verificationKey.publicKeys.slhDsa, raw);
    } catch {
        valid = false;
    }
    return { valid, keyId: verificationKey.keyId, reason: valid ? null : 'signature-verification-failed' };
};

const serializeSlhDsaSignature = (signature) => [
    SLH_TOKEN_PREFIX,
    signature.keyId,
    signature.slhDsa,
].join('.');

module.exports = {
    SIGNATURE_VERSION,
    HYBRID_TOKEN_PREFIX,
    SLH_TOKEN_PREFIX,
    DEFAULT_CONTEXT,
    SIGNATURE_DOMAIN,
    SLH_DOMAIN,
    ED25519_SIGNATURE_BYTES,
    ML_DSA_65_SIGNATURE_BYTES,
    SLH_DSA_SHA2_128S_SIGNATURE_BYTES,
    sign,
    verify,
    verifyOrThrow,
    parseSignature,
    serializeSignature,
    signSlhDsa,
    verifySlhDsa,
    serializeSlhDsaSignature,
    buildSignedMessage,
};
