'use strict';

const crypto = require('crypto');
const {
    KEM_ALGORITHM,
    KEM_NODE_NAME,
    SIGNATURE_ALGORITHM,
    SIGNATURE_NODE_NAME,
    SLH_DSA_ALGORITHM,
    SLH_DSA_NODE_NAME,
    assertPqcKemAvailable,
    assertPqcSignatureAvailable,
    assertSlhDsaAvailable,
} = require('./algorithms');

const KEY_RECORD_VERSION = 1;
const KEY_ID_PREFIX = 'pqc-';
const KEY_ID_HEX_LENGTH = 32; // 128 bits of collision resistance.

const toBase64Url = (value) => Buffer.from(value).toString('base64url');

const fromBase64Url = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`PQC key material is missing ${label}`);
    }
    let decoded;
    try {
        decoded = Buffer.from(value, 'base64url');
    } catch {
        throw new Error(`PQC key material ${label} is not valid base64url`);
    }
    if (!decoded.length) throw new Error(`PQC key material ${label} is empty`);
    return decoded;
};

const exportPrivate = (keyObject) => keyObject.export({ format: 'der', type: 'pkcs8' });

const exportPublic = (keyObject) => keyObject.export({ format: 'der', type: 'spki' });

const importPrivate = (der) => crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });

const importPublic = (der) => crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });

const lengthPrefix = (buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(buffer.length, 0);
    return Buffer.concat([length, buffer]);
};

/**
 * Key IDs are the SHA-256 fingerprint of the public key bundle, truncated to
 * 128 bits. They are derived, never assigned: a record whose stored keyId does
 * not match its public keys is corrupt and must not be used.
 */
const deriveKeyId = (publicKeyDers) => {
    if (!Array.isArray(publicKeyDers) || publicKeyDers.length === 0) {
        throw new Error('deriveKeyId requires at least one public key');
    }
    const digest = crypto.createHash('sha256')
        .update(Buffer.concat(publicKeyDers.map(lengthPrefix)))
        .digest('hex');
    return `${KEY_ID_PREFIX}${digest.slice(0, KEY_ID_HEX_LENGTH)}`;
};

const normalizeKeyPair = ({ privateKey, publicKey }, label, nodeName) => {
    const privateDer = fromBase64Url(privateKey, `${label}.privateKey`);
    const privateKeyObject = importPrivate(privateDer);
    if (privateKeyObject.asymmetricKeyType !== nodeName) {
        throw new Error(`PQC key material ${label}.privateKey is ${privateKeyObject.asymmetricKeyType}, expected ${nodeName}`);
    }

    // Deriving the public key from the private key is what makes a swapped or
    // truncated key record fail closed instead of silently encrypting to the
    // wrong recipient.
    const derivedPublicKey = crypto.createPublicKey(privateKeyObject);
    const derivedPublicDer = exportPublic(derivedPublicKey);

    if (publicKey !== undefined) {
        const suppliedPublicDer = fromBase64Url(publicKey, `${label}.publicKey`);
        const suppliedPublicKey = importPublic(suppliedPublicDer);
        if (suppliedPublicKey.asymmetricKeyType !== nodeName) {
            throw new Error(`PQC key material ${label}.publicKey is ${suppliedPublicKey.asymmetricKeyType}, expected ${nodeName}`);
        }
        if (!suppliedPublicDer.equals(derivedPublicDer)) {
            throw new Error(`PQC key material ${label}.publicKey does not match its private key`);
        }
    }

    return {
        privateKeyObject,
        publicKeyObject: derivedPublicKey,
        privateKey: toBase64Url(privateDer),
        publicKey: toBase64Url(derivedPublicDer),
    };
};

const validateHeader = (record, expectedType, expectedAlgorithm) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('PQC key record must be a JSON object');
    }
    if (Number(record.version) !== KEY_RECORD_VERSION) {
        throw new Error(`PQC key record version ${record.version} is not supported`);
    }
    if (record.type !== expectedType) {
        throw new Error(`PQC key record type must be ${expectedType}`);
    }
    if (record.algorithm !== expectedAlgorithm) {
        throw new Error(`PQC key record algorithm must be ${expectedAlgorithm}`);
    }
};

const buildPublicRecord = ({ type, algorithm, keyId, createdAt, keys }) => ({
    version: KEY_RECORD_VERSION,
    type,
    algorithm,
    keyId,
    createdAt: createdAt || new Date().toISOString(),
    ...keys,
});

/**
 * Generate a fresh hybrid KEM key pair.
 *
 * The return value contains private key material. It is intended for the
 * key-generation CLI or a secret manager, never for a log line.
 */
const generateHybridKemKey = ({ createdAt } = {}) => {
    assertPqcKemAvailable();
    const x25519 = crypto.generateKeyPairSync('x25519');
    const mlKem = crypto.generateKeyPairSync(KEM_NODE_NAME);

    const x25519Record = {
        privateKey: toBase64Url(exportPrivate(x25519.privateKey)),
        publicKey: toBase64Url(exportPublic(x25519.publicKey)),
    };
    const mlKemRecord = {
        privateKey: toBase64Url(exportPrivate(mlKem.privateKey)),
        publicKey: toBase64Url(exportPublic(mlKem.publicKey)),
    };
    const keyId = deriveKeyId([
        fromBase64Url(x25519Record.publicKey, 'x25519.publicKey'),
        fromBase64Url(mlKemRecord.publicKey, 'mlKem.publicKey'),
    ]);

    return buildPublicRecord({
        type: 'hybrid-kem',
        algorithm: KEM_ALGORITHM,
        keyId,
        createdAt,
        keys: { x25519: x25519Record, mlKem: mlKemRecord },
    });
};

const generateHybridSigningKey = ({ createdAt } = {}) => {
    assertPqcSignatureAvailable();
    const ed25519 = crypto.generateKeyPairSync('ed25519');
    const mlDsa = crypto.generateKeyPairSync(SIGNATURE_NODE_NAME);

    const ed25519Record = {
        privateKey: toBase64Url(exportPrivate(ed25519.privateKey)),
        publicKey: toBase64Url(exportPublic(ed25519.publicKey)),
    };
    const mlDsaRecord = {
        privateKey: toBase64Url(exportPrivate(mlDsa.privateKey)),
        publicKey: toBase64Url(exportPublic(mlDsa.publicKey)),
    };
    const keyId = deriveKeyId([
        fromBase64Url(ed25519Record.publicKey, 'ed25519.publicKey'),
        fromBase64Url(mlDsaRecord.publicKey, 'mlDsa.publicKey'),
    ]);

    return buildPublicRecord({
        type: 'hybrid-signature',
        algorithm: SIGNATURE_ALGORITHM,
        keyId,
        createdAt,
        keys: { ed25519: ed25519Record, mlDsa: mlDsaRecord },
    });
};

/**
 * Generate a conservative hash-based signature key for long-lived offline
 * anchors (for example, periodically published ledger checkpoints). SLH-DSA
 * is intentionally not used on request paths: signatures are large and slow.
 */
const generateSlhDsaKey = ({ createdAt } = {}) => {
    assertSlhDsaAvailable();
    const keyPair = crypto.generateKeyPairSync(SLH_DSA_NODE_NAME);
    const record = {
        privateKey: toBase64Url(exportPrivate(keyPair.privateKey)),
        publicKey: toBase64Url(exportPublic(keyPair.publicKey)),
    };
    const keyId = deriveKeyId([fromBase64Url(record.publicKey, 'slhDsa.publicKey')]);
    return buildPublicRecord({
        type: 'slh-dsa',
        algorithm: SLH_DSA_ALGORITHM,
        keyId,
        createdAt,
        keys: { slhDsa: record },
    });
};

const loadKemKeyRecord = (record) => {
    validateHeader(record, 'hybrid-kem', KEM_ALGORITHM);
    const x25519 = normalizeKeyPair(record.x25519 || {}, 'x25519', 'x25519');
    const mlKem = normalizeKeyPair(record.mlKem || {}, 'mlKem', KEM_NODE_NAME);
    const keyId = deriveKeyId([
        fromBase64Url(x25519.publicKey, 'x25519.publicKey'),
        fromBase64Url(mlKem.publicKey, 'mlKem.publicKey'),
    ]);
    if (record.keyId && record.keyId !== keyId) {
        throw new Error('PQC KEM key record keyId does not match its public keys');
    }

    return {
        record: {
            version: KEY_RECORD_VERSION,
            type: 'hybrid-kem',
            algorithm: KEM_ALGORITHM,
            keyId,
            createdAt: record.createdAt || null,
            x25519: { privateKey: x25519.privateKey, publicKey: x25519.publicKey },
            mlKem: { privateKey: mlKem.privateKey, publicKey: mlKem.publicKey },
        },
        keyId,
        privateKeys: { x25519: x25519.privateKeyObject, mlKem: mlKem.privateKeyObject },
        publicKeys: { x25519: x25519.publicKeyObject, mlKem: mlKem.publicKeyObject },
        publicRecord: {
            version: KEY_RECORD_VERSION,
            type: 'hybrid-kem',
            algorithm: KEM_ALGORITHM,
            keyId,
            createdAt: record.createdAt || null,
            x25519: { publicKey: x25519.publicKey },
            mlKem: { publicKey: mlKem.publicKey },
        },
    };
};

const loadSigningKeyRecord = (record) => {
    validateHeader(record, 'hybrid-signature', SIGNATURE_ALGORITHM);
    const ed25519 = normalizeKeyPair(record.ed25519 || {}, 'ed25519', 'ed25519');
    const mlDsa = normalizeKeyPair(record.mlDsa || {}, 'mlDsa', SIGNATURE_NODE_NAME);
    const keyId = deriveKeyId([
        fromBase64Url(ed25519.publicKey, 'ed25519.publicKey'),
        fromBase64Url(mlDsa.publicKey, 'mlDsa.publicKey'),
    ]);
    if (record.keyId && record.keyId !== keyId) {
        throw new Error('PQC signing key record keyId does not match its public keys');
    }

    return {
        record: {
            version: KEY_RECORD_VERSION,
            type: 'hybrid-signature',
            algorithm: SIGNATURE_ALGORITHM,
            keyId,
            createdAt: record.createdAt || null,
            ed25519: { privateKey: ed25519.privateKey, publicKey: ed25519.publicKey },
            mlDsa: { privateKey: mlDsa.privateKey, publicKey: mlDsa.publicKey },
        },
        keyId,
        privateKeys: { ed25519: ed25519.privateKeyObject, mlDsa: mlDsa.privateKeyObject },
        publicKeys: { ed25519: ed25519.publicKeyObject, mlDsa: mlDsa.publicKeyObject },
        publicRecord: {
            version: KEY_RECORD_VERSION,
            type: 'hybrid-signature',
            algorithm: SIGNATURE_ALGORITHM,
            keyId,
            createdAt: record.createdAt || null,
            ed25519: { publicKey: ed25519.publicKey },
            mlDsa: { publicKey: mlDsa.publicKey },
        },
    };
};

const loadSlhDsaKeyRecord = (record) => {
    validateHeader(record, 'slh-dsa', SLH_DSA_ALGORITHM);
    const slhDsa = normalizeKeyPair(record.slhDsa || {}, 'slhDsa', SLH_DSA_NODE_NAME);
    const keyId = deriveKeyId([fromBase64Url(slhDsa.publicKey, 'slhDsa.publicKey')]);
    if (record.keyId && record.keyId !== keyId) {
        throw new Error('PQC SLH-DSA key record keyId does not match its public key');
    }

    return {
        record: {
            version: KEY_RECORD_VERSION,
            type: 'slh-dsa',
            algorithm: SLH_DSA_ALGORITHM,
            keyId,
            createdAt: record.createdAt || null,
            slhDsa: { privateKey: slhDsa.privateKey, publicKey: slhDsa.publicKey },
        },
        keyId,
        privateKeys: { slhDsa: slhDsa.privateKeyObject },
        publicKeys: { slhDsa: slhDsa.publicKeyObject },
        publicRecord: {
            version: KEY_RECORD_VERSION,
            type: 'slh-dsa',
            algorithm: SLH_DSA_ALGORITHM,
            keyId,
            createdAt: record.createdAt || null,
            slhDsa: { publicKey: slhDsa.publicKey },
        },
    };
};

const publicKemKeysFromRecord = (record) => {
    validateHeader(record, 'hybrid-kem', KEM_ALGORITHM);
    const x25519Der = fromBase64Url(record.x25519?.publicKey, 'x25519.publicKey');
    const mlKemDer = fromBase64Url(record.mlKem?.publicKey, 'mlKem.publicKey');
    const keyId = deriveKeyId([x25519Der, mlKemDer]);
    if (record.keyId && record.keyId !== keyId) {
        throw new Error('PQC KEM public key record keyId does not match its public keys');
    }
    return {
        keyId,
        x25519: importPublic(x25519Der),
        mlKem: importPublic(mlKemDer),
    };
};

const publicSigningKeysFromRecord = (record) => {
    validateHeader(record, 'hybrid-signature', SIGNATURE_ALGORITHM);
    const ed25519Der = fromBase64Url(record.ed25519?.publicKey, 'ed25519.publicKey');
    const mlDsaDer = fromBase64Url(record.mlDsa?.publicKey, 'mlDsa.publicKey');
    const keyId = deriveKeyId([ed25519Der, mlDsaDer]);
    if (record.keyId && record.keyId !== keyId) {
        throw new Error('PQC signing public key record keyId does not match its public keys');
    }
    return {
        keyId,
        ed25519: importPublic(ed25519Der),
        mlDsa: importPublic(mlDsaDer),
    };
};

const publicSlhDsaKeyFromRecord = (record) => {
    validateHeader(record, 'slh-dsa', SLH_DSA_ALGORITHM);
    const der = fromBase64Url(record.slhDsa?.publicKey, 'slhDsa.publicKey');
    const keyId = deriveKeyId([der]);
    if (record.keyId && record.keyId !== keyId) {
        throw new Error('PQC SLH-DSA public key record keyId does not match its public key');
    }
    return { keyId, slhDsa: importPublic(der) };
};

const toPublicRecord = (record) => {
    if (!record || typeof record !== 'object') throw new Error('PQC key record must be an object');
    if (record.type === 'hybrid-kem') return loadKemKeyRecord(record).publicRecord;
    if (record.type === 'hybrid-signature') return loadSigningKeyRecord(record).publicRecord;
    if (record.type === 'slh-dsa') return loadSlhDsaKeyRecord(record).publicRecord;
    throw new Error(`Unknown PQC key record type: ${record.type}`);
};

module.exports = {
    KEY_RECORD_VERSION,
    KEY_ID_PREFIX,
    toBase64Url,
    fromBase64Url,
    deriveKeyId,
    generateHybridKemKey,
    generateHybridSigningKey,
    generateSlhDsaKey,
    loadKemKeyRecord,
    loadSigningKeyRecord,
    loadSlhDsaKeyRecord,
    publicKemKeysFromRecord,
    publicSigningKeysFromRecord,
    publicSlhDsaKeyFromRecord,
    toPublicRecord,
};
