'use strict';

const crypto = require('crypto');
const tls = require('tls');

// Canonical algorithm identifiers for the application-layer PQC layer.
//
// These names are part of the on-disk/key-material contract. Changing one is a
// format migration, not a rename: key records and envelope headers carry the
// algorithm string so a future rotation can keep old ciphertext readable.
const KEM_ALGORITHM = 'X25519+ML-KEM-768';
const KEM_NODE_NAME = 'ml-kem-768';
const KEM_NIST_STANDARD = 'FIPS 203';
const KEM_NIST_LEVEL = 3;

const SIGNATURE_ALGORITHM = 'Ed25519+ML-DSA-65';
const SIGNATURE_NODE_NAME = 'ml-dsa-65';
const SIGNATURE_NIST_STANDARD = 'FIPS 204';
const SIGNATURE_NIST_LEVEL = 3;

const SLH_DSA_ALGORITHM = 'SLH-DSA-SHA2-128s';
const SLH_DSA_NODE_NAME = 'slh-dsa-sha2-128s';
const SLH_DSA_NIST_STANDARD = 'FIPS 205';
const SLH_DSA_NIST_LEVEL = 1;

// TLS 1.3 hybrid group standardized by IETF/OpenSSL. Node exposes it through
// OpenSSL 3.5; `tls.createSecureContext` is the authoritative local probe.
const TLS_HYBRID_GROUP = 'X25519MLKEM768';

let capabilityCache = null;

const nodeVersionTuple = () => String(process.versions.node || '')
    .split('.')
    .map((part) => Number(part) || 0);

const canGenerateKeyPair = (type) => {
    try {
        const pair = crypto.generateKeyPairSync(type);
        return Boolean(pair && pair.publicKey && pair.privateKey);
    } catch {
        return false;
    }
};

const canUseTlsHybridGroup = () => {
    try {
        tls.createSecureContext({ ecdhCurve: TLS_HYBRID_GROUP });
        return true;
    } catch {
        return false;
    }
};

/**
 * Detect native PQC support without loading any key material.
 *
 * FIPS 203/204/205 are supplied by OpenSSL 3.5, which Node 24.7+ bundles.
 * Older Node 24 patch releases may report a Node 24 version but lack the
 * algorithms; capability checks must therefore probe the actual API rather
 * than infer support from the major version.
 */
const getPqcCapabilities = ({ refresh = false } = {}) => {
    if (capabilityCache && !refresh) return capabilityCache;

    const [major, minor, patch] = nodeVersionTuple();
    const hasKemApi = typeof crypto.encapsulate === 'function'
        && typeof crypto.decapsulate === 'function';
    const mlKem = hasKemApi && canGenerateKeyPair(KEM_NODE_NAME);
    const mlDsa = canGenerateKeyPair(SIGNATURE_NODE_NAME);
    const slhDsa = canGenerateKeyPair(SLH_DSA_NODE_NAME);
    const tlsHybridGroup = canUseTlsHybridGroup();

    const reasons = [];
    if (!hasKemApi) reasons.push('node:crypto does not expose encapsulate/decapsulate');
    if (!mlKem) reasons.push(`${KEM_NODE_NAME} key generation is unavailable`);
    if (!mlDsa) reasons.push(`${SIGNATURE_NODE_NAME} key generation is unavailable`);
    if (!slhDsa) reasons.push(`${SLH_DSA_NODE_NAME} key generation is unavailable`);
    if (!tlsHybridGroup) reasons.push(`TLS group ${TLS_HYBRID_GROUP} is unavailable in the local OpenSSL`);

    capabilityCache = {
        nodeVersion: process.versions.node || 'unknown',
        nodeVersionTuple: { major, minor, patch },
        opensslVersion: process.versions.openssl || 'unknown',
        hasKemApi,
        algorithms: {
            mlKem: { available: mlKem, nodeName: KEM_NODE_NAME, algorithm: KEM_ALGORITHM, standard: KEM_NIST_STANDARD, nistLevel: KEM_NIST_LEVEL },
            mlDsa: { available: mlDsa, nodeName: SIGNATURE_NODE_NAME, algorithm: SIGNATURE_ALGORITHM, standard: SIGNATURE_NIST_STANDARD, nistLevel: SIGNATURE_NIST_LEVEL },
            slhDsa: { available: slhDsa, nodeName: SLH_DSA_NODE_NAME, algorithm: SLH_DSA_ALGORITHM, standard: SLH_DSA_NIST_STANDARD, nistLevel: SLH_DSA_NIST_LEVEL },
        },
        tls: {
            hybridGroup: TLS_HYBRID_GROUP,
            available: tlsHybridGroup,
        },
        available: mlKem && mlDsa,
        fullyAvailable: mlKem && mlDsa && slhDsa && tlsHybridGroup,
        reasons,
    };
    return capabilityCache;
};

const assertPqcKemAvailable = () => {
    const capabilities = getPqcCapabilities();
    if (!capabilities.algorithms.mlKem.available) {
        throw new Error(
            `Post-quantum KEM is unavailable: ${capabilities.reasons.join('; ')}. `
            + 'Run on Node.js 24.7+ with OpenSSL 3.5+; do not downgrade to a classical-only envelope.'
        );
    }
    return capabilities;
};

const assertPqcSignatureAvailable = () => {
    const capabilities = getPqcCapabilities();
    if (!capabilities.algorithms.mlDsa.available) {
        throw new Error(
            `Post-quantum signatures are unavailable: ${capabilities.reasons.join('; ')}. `
            + 'Run on Node.js 24.7+ with OpenSSL 3.5+.'
        );
    }
    return capabilities;
};

const assertSlhDsaAvailable = () => {
    const capabilities = getPqcCapabilities();
    if (!capabilities.algorithms.slhDsa.available) {
        throw new Error(
            `SLH-DSA is unavailable: ${capabilities.reasons.join('; ')}. `
            + 'Run on Node.js 24.7+ with OpenSSL 3.5+.'
        );
    }
    return capabilities;
};

module.exports = {
    KEM_ALGORITHM,
    KEM_NODE_NAME,
    KEM_NIST_STANDARD,
    KEM_NIST_LEVEL,
    SIGNATURE_ALGORITHM,
    SIGNATURE_NODE_NAME,
    SIGNATURE_NIST_STANDARD,
    SIGNATURE_NIST_LEVEL,
    SLH_DSA_ALGORITHM,
    SLH_DSA_NODE_NAME,
    SLH_DSA_NIST_STANDARD,
    SLH_DSA_NIST_LEVEL,
    TLS_HYBRID_GROUP,
    getPqcCapabilities,
    assertPqcKemAvailable,
    assertPqcSignatureAvailable,
    assertSlhDsaAvailable,
};
