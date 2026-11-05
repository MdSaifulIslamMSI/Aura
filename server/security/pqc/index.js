'use strict';

const algorithms = require('./algorithms');
const keyMaterial = require('./keyMaterial');
const keyRegistry = require('./keyRegistry');
const kem = require('./hybridKem');
const signature = require('./hybridSignature');

// Namespaced exports keep the surface explicit: `pqc.kem.sealToken(...)` is
// unambiguous, while `pqc.sign(...)` would invite confusion with every other
// signing helper in the server.
module.exports = {
    algorithms,
    keyMaterial,
    keyRegistry,
    kem,
    signature,

    // Capability and algorithm identifiers are safe to import directly.
    getPqcCapabilities: algorithms.getPqcCapabilities,
    assertPqcKemAvailable: algorithms.assertPqcKemAvailable,
    assertPqcSignatureAvailable: algorithms.assertPqcSignatureAvailable,
    assertSlhDsaAvailable: algorithms.assertSlhDsaAvailable,
    KEM_ALGORITHM: algorithms.KEM_ALGORITHM,
    SIGNATURE_ALGORITHM: algorithms.SIGNATURE_ALGORITHM,
    SLH_DSA_ALGORITHM: algorithms.SLH_DSA_ALGORITHM,
    TLS_HYBRID_GROUP: algorithms.TLS_HYBRID_GROUP,
};
