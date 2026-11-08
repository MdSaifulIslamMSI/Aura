'use strict';

const crypto = require('crypto');
const {
    KEM_ALGORITHM,
    assertPqcKemAvailable,
} = require('./algorithms');
const {
    loadKemKeyRecord,
    publicKemKeysFromRecord,
    fromBase64Url,
} = require('./keyMaterial');

// Hybrid KEM envelope, application layer.
//
// X25519 and ML-KEM-768 are both required. The two shared secrets are combined
// with HKDF-SHA256; an attacker who breaks only one algorithm still cannot
// derive the AEAD key. The transcript (ephemeral public key, ML-KEM
// ciphertext, recipient public keys) is bound into the KDF salt so a
// component-swapping attack fails even if both individual secrets are valid.
//
// Wire format v1: pqc1.<keyId>.<epk>.<kemCt>.<iv>.<tag>.<ciphertext>
// Every segment is base64url. The token is self-describing; readers reject a
// version or algorithm they do not implement instead of guessing.

const ENVELOPE_VERSION = 1;
const TOKEN_PREFIX = 'pqc1';
const DEFAULT_CONTEXT = 'aura:pqc:field-encryption';
const DATA_KEY_CONTEXT = 'aura:data-key-wrap';
const AEAD_ALGORITHM = 'aes-256-gcm';
const AEAD_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const X25519_PUBLIC_DER_BYTES = 44;
const ML_KEM_768_CIPHERTEXT_BYTES = 1088;
const ML_KEM_SHARED_SECRET_BYTES = 32;
const HKDF_INFO_PREFIX = 'aura:pqc:hybrid-kem:hkdf-sha256:v1';
const TRANSCRIPT_DOMAIN = 'aura:pqc:hybrid-kem:transcript:v1';
const AAD_DOMAIN = 'aura:pqc:hybrid-kem:aad:v1';

const lengthPrefix = (buffer) => {
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(buffer.length, 0);
    return Buffer.concat([prefix, buffer]);
};

const toBuffer = (value, label) => {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') return Buffer.from(value, 'utf8');
    throw new Error(`${label} must be a Buffer, Uint8Array, or string`);
};

const normalizeContext = (context) => {
    if (context === undefined || context === null || context === '') return DEFAULT_CONTEXT;
    if (typeof context !== 'string') throw new Error('PQC KEM context must be a string');
    return context;
};

const encode = (buffer) => Buffer.from(buffer).toString('base64url');

/**
 * The transcript deliberately uses length prefixes rather than a delimiter
 * format. Without them, ("ab", "c") and ("a", "bc") hash to the same input.
 */
const buildTranscript = ({ ephemeralPublicDer, mlKemCiphertext, recipientPublicDers }) => Buffer.concat([
    lengthPrefix(Buffer.from(TRANSCRIPT_DOMAIN, 'utf8')),
    lengthPrefix(Buffer.from(KEM_ALGORITHM, 'utf8')),
    lengthPrefix(ephemeralPublicDer),
    lengthPrefix(mlKemCiphertext),
    ...recipientPublicDers.map(lengthPrefix),
]);

const combineSecrets = ({ x25519Secret, mlKemSecret, transcript, context }) => {
    if (!Buffer.isBuffer(x25519Secret) || x25519Secret.length !== 32) {
        throw new Error('X25519 shared secret must be 32 bytes');
    }
    if (!Buffer.isBuffer(mlKemSecret) || mlKemSecret.length !== ML_KEM_SHARED_SECRET_BYTES) {
        throw new Error('ML-KEM shared secret must be 32 bytes');
    }
    if (x25519Secret.every((byte) => byte === 0) || mlKemSecret.every((byte) => byte === 0)) {
        throw new Error('Hybrid KEM produced an all-zero shared secret');
    }
    const ikm = Buffer.concat([lengthPrefix(x25519Secret), lengthPrefix(mlKemSecret)]);
    const salt = crypto.createHash('sha256').update(transcript).digest();
    const info = Buffer.from(`${HKDF_INFO_PREFIX}:${normalizeContext(context)}`, 'utf8');
    return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, AEAD_KEY_BYTES));
};

const buildAad = ({ keyId, context, aad }) => {
    const header = Buffer.from(`v${ENVELOPE_VERSION}|${KEM_ALGORITHM}|${keyId}`, 'utf8');
    const extra = aad === undefined || aad === null || aad === ''
        ? Buffer.alloc(0)
        : toBuffer(aad, 'PQC KEM additional authenticated data');
    return Buffer.concat([
        lengthPrefix(Buffer.from(AAD_DOMAIN, 'utf8')),
        lengthPrefix(Buffer.from(normalizeContext(context), 'utf8')),
        lengthPrefix(header),
        lengthPrefix(extra),
    ]);
};

const assertEphemeralPublicKey = (der) => {
    if (der.length !== X25519_PUBLIC_DER_BYTES) {
        throw new Error(`PQC KEM ephemeral public key must be ${X25519_PUBLIC_DER_BYTES} DER bytes, got ${der.length}`);
    }
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'x25519') {
        throw new Error(`PQC KEM ephemeral public key is ${key.asymmetricKeyType}, expected x25519`);
    }
    return key;
};

const assertMlKemCiphertext = (ciphertext) => {
    if (ciphertext.length !== ML_KEM_768_CIPHERTEXT_BYTES) {
        throw new Error(
            `ML-KEM-768 ciphertext must be ${ML_KEM_768_CIPHERTEXT_BYTES} bytes, got ${ciphertext.length}`
        );
    }
    return ciphertext;
};

const normalizePublicKeys = (recordOrLoaded) => {
    if (recordOrLoaded?.publicKeys && recordOrLoaded?.keyId) {
        return {
            keyId: recordOrLoaded.keyId,
            publicKeys: recordOrLoaded.publicKeys,
            publicRecord: recordOrLoaded.publicRecord,
        };
    }
    const publicKeys = publicKemKeysFromRecord(recordOrLoaded);
    return {
        keyId: publicKeys.keyId,
        publicKeys,
        publicRecord: recordOrLoaded,
    };
};

const normalizePrivateKeys = (recordOrLoaded) => {
    if (recordOrLoaded?.privateKeys && recordOrLoaded?.keyId) {
        return recordOrLoaded;
    }
    return loadKemKeyRecord(recordOrLoaded);
};

const exportPublicDer = (keyObject, label) => {
    const der = keyObject.export({ format: 'der', type: 'spki' });
    if (!der || !der.length) throw new Error(`PQC KEM ${label} public key export failed`);
    return der;
};

const recipientDersFromPublicKeys = (publicKeys) => [
    exportPublicDer(publicKeys.x25519, 'x25519'),
    exportPublicDer(publicKeys.mlKem, 'ml-kem-768'),
];

/**
 * Encapsulate a fresh hybrid shared secret for the recipient.
 *
 * Returns the secret plus the public encapsulation that must travel with the
 * ciphertext. The ephemeral X25519 private key never leaves this function.
 */
const encapsulate = (publicKeyRecord, { context } = {}) => {
    assertPqcKemAvailable();
    const recipient = normalizePublicKeys(publicKeyRecord);
    const recipientDers = recipientDersFromPublicKeys(recipient.publicKeys);

    const ephemeral = crypto.generateKeyPairSync('x25519');
    const ephemeralPublicDer = exportPublicDer(ephemeral.publicKey, 'ephemeral');
    assertEphemeralPublicKey(ephemeralPublicDer);

    const x25519Secret = crypto.diffieHellman({
        privateKey: ephemeral.privateKey,
        publicKey: recipient.publicKeys.x25519,
    });

    const { sharedKey: mlKemSecret, ciphertext: mlKemCiphertext } = crypto.encapsulate(
        recipient.publicKeys.mlKem
    );
    assertMlKemCiphertext(mlKemCiphertext);

    const transcript = buildTranscript({
        ephemeralPublicDer,
        mlKemCiphertext,
        recipientPublicDers: recipientDers,
    });
    const sharedKey = combineSecrets({
        x25519Secret,
        mlKemSecret: Buffer.from(mlKemSecret),
        transcript,
        context,
    });

    return {
        keyId: recipient.keyId,
        sharedKey,
        encapsulation: {
            v: ENVELOPE_VERSION,
            alg: KEM_ALGORITHM,
            keyId: recipient.keyId,
            epk: encode(ephemeralPublicDer),
            kemCiphertext: encode(mlKemCiphertext),
        },
    };
};

/**
 * Recover the hybrid shared secret. Both components are mandatory; there is
 * intentionally no "ML-KEM only" or "X25519 only" fallback.
 */
const decapsulate = (privateKeyRecord, encapsulation, { context } = {}) => {
    assertPqcKemAvailable();
    if (!encapsulation || typeof encapsulation !== 'object') {
        throw new Error('PQC KEM encapsulation must be an object');
    }
    if (Number(encapsulation.v) !== ENVELOPE_VERSION) {
        throw new Error(`Unsupported PQC KEM encapsulation version: ${encapsulation.v}`);
    }
    if (encapsulation.alg !== KEM_ALGORITHM) {
        throw new Error(`Unsupported PQC KEM algorithm: ${encapsulation.alg}`);
    }

    const recipient = normalizePrivateKeys(privateKeyRecord);
    if (encapsulation.keyId !== recipient.keyId) {
        throw new Error('PQC KEM encapsulation keyId does not match the private key');
    }

    const ephemeralPublicDer = fromBase64Url(encapsulation.epk, 'epk');
    const mlKemCiphertext = fromBase64Url(encapsulation.kemCiphertext, 'kemCiphertext');
    const ephemeralPublicKey = assertEphemeralPublicKey(ephemeralPublicDer);
    assertMlKemCiphertext(mlKemCiphertext);

    const x25519Secret = crypto.diffieHellman({
        privateKey: recipient.privateKeys.x25519,
        publicKey: ephemeralPublicKey,
    });
    const mlKemSecret = crypto.decapsulate(recipient.privateKeys.mlKem, mlKemCiphertext);

    const transcript = buildTranscript({
        ephemeralPublicDer,
        mlKemCiphertext,
        recipientPublicDers: recipientDersFromPublicKeys(recipient.publicKeys),
    });
    const sharedKey = combineSecrets({
        x25519Secret,
        mlKemSecret: Buffer.from(mlKemSecret),
        transcript,
        context,
    });

    return { keyId: recipient.keyId, sharedKey };
};

const assertIvAndTag = (iv, tag) => {
    if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES) {
        throw new Error(`PQC KEM IV must be ${IV_BYTES} bytes`);
    }
    if (!Buffer.isBuffer(tag) || tag.length !== TAG_BYTES) {
        throw new Error(`PQC KEM authentication tag must be ${TAG_BYTES} bytes`);
    }
};

const sealBuffer = (plaintext, { publicKeyRecord, context, aad } = {}) => {
    if (!publicKeyRecord) throw new Error('sealBuffer requires publicKeyRecord');
    const buffer = toBuffer(plaintext, 'PQC sealBuffer plaintext');
    const { keyId, sharedKey, encapsulation } = encapsulate(publicKeyRecord, { context });
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(AEAD_ALGORITHM, sharedKey, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(buildAad({ keyId, context, aad }));
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    assertIvAndTag(iv, tag);
    return {
        v: ENVELOPE_VERSION,
        alg: KEM_ALGORITHM,
        keyId,
        epk: encapsulation.epk,
        kemCiphertext: encapsulation.kemCiphertext,
        iv: encode(iv),
        tag: encode(tag),
        ciphertext: encode(ciphertext),
    };
};

const openBuffer = (envelopeOrToken, { privateKeyRecord, context, aad } = {}) => {
    if (!privateKeyRecord) throw new Error('openBuffer requires privateKeyRecord');
    const envelope = parseEnvelope(envelopeOrToken);
    const iv = fromBase64Url(envelope.iv, 'iv');
    const tag = fromBase64Url(envelope.tag, 'tag');
    assertIvAndTag(iv, tag);
    const ciphertext = fromBase64Url(envelope.ciphertext, 'ciphertext');
    const { keyId, sharedKey } = decapsulate(
        privateKeyRecord,
        {
            v: envelope.v,
            alg: envelope.alg,
            keyId: envelope.keyId,
            epk: envelope.epk,
            kemCiphertext: envelope.kemCiphertext,
        },
        { context }
    );
    const decipher = crypto.createDecipheriv(AEAD_ALGORITHM, sharedKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(buildAad({ keyId, context, aad }));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

const serializeEnvelope = (envelope) => {
    const normalized = parseEnvelope(envelope);
    return [
        TOKEN_PREFIX,
        normalized.keyId,
        normalized.epk,
        normalized.kemCiphertext,
        normalized.iv,
        normalized.tag,
        normalized.ciphertext,
    ].join('.');
};

const parseEnvelope = (envelopeOrToken) => {
    let envelope;
    if (typeof envelopeOrToken === 'string') {
        if (!envelopeOrToken.startsWith(`${TOKEN_PREFIX}.`)) {
            throw new Error('PQC KEM token is not a v1 hybrid envelope');
        }
        const parts = envelopeOrToken.split('.');
        if (parts.length !== 7) throw new Error('PQC KEM token must have 7 segments');
        const [, keyId, epk, kemCiphertext, iv, tag, ciphertext] = parts;
        envelope = {
            v: ENVELOPE_VERSION,
            alg: KEM_ALGORITHM,
            keyId,
            epk,
            kemCiphertext,
            iv,
            tag,
            ciphertext,
        };
    } else if (envelopeOrToken && typeof envelopeOrToken === 'object' && !Array.isArray(envelopeOrToken)) {
        envelope = { ...envelopeOrToken };
    } else {
        throw new Error('PQC KEM envelope must be a token string or object');
    }

    if (Number(envelope.v) !== ENVELOPE_VERSION) {
        throw new Error(`Unsupported PQC KEM envelope version: ${envelope.v}`);
    }
    if (envelope.alg !== KEM_ALGORITHM) {
        throw new Error(`Unsupported PQC KEM envelope algorithm: ${envelope.alg}`);
    }
    for (const field of ['keyId', 'epk', 'kemCiphertext', 'iv', 'tag', 'ciphertext']) {
        if (typeof envelope[field] !== 'string' || !envelope[field]) {
            throw new Error(`PQC KEM envelope is missing ${field}`);
        }
    }
    return {
        v: ENVELOPE_VERSION,
        alg: KEM_ALGORITHM,
        keyId: envelope.keyId,
        epk: envelope.epk,
        kemCiphertext: envelope.kemCiphertext,
        iv: envelope.iv,
        tag: envelope.tag,
        ciphertext: envelope.ciphertext,
    };
};

const sealToken = (plaintext, options) => serializeEnvelope(sealBuffer(plaintext, options));

const openToken = (token, options) => openBuffer(token, options).toString('utf8');

const sealValue = (value, options) => sealToken(JSON.stringify(value), options);

const openValue = (token, options) => JSON.parse(openToken(token, options));

/**
 * Wrap a 32-byte data-encryption key for storage. This is the same hybrid
 * envelope under a separate KDF/AAD context so a wrapped DEK can never be
 * confused with a field ciphertext.
 */
const wrapDataKey = (dataKey, options = {}) => {
    const key = toBuffer(dataKey, 'PQC data key');
    if (key.length !== AEAD_KEY_BYTES) {
        throw new Error(`PQC data key must be ${AEAD_KEY_BYTES} bytes, got ${key.length}`);
    }
    return sealToken(key, { ...options, context: options.context || DATA_KEY_CONTEXT });
};

const unwrapDataKey = (token, options = {}) => {
    const key = openBuffer(token, { ...options, context: options.context || DATA_KEY_CONTEXT });
    if (key.length !== AEAD_KEY_BYTES) {
        throw new Error(`Wrapped PQC data key opened to ${key.length} bytes, expected ${AEAD_KEY_BYTES}`);
    }
    return key;
};

const describeEnvelope = (envelopeOrToken) => {
    const envelope = parseEnvelope(envelopeOrToken);
    return {
        v: envelope.v,
        alg: envelope.alg,
        keyId: envelope.keyId,
        ephemeralPublicKeyBytes: Buffer.from(envelope.epk, 'base64url').length,
        mlKemCiphertextBytes: Buffer.from(envelope.kemCiphertext, 'base64url').length,
        ciphertextBytes: Buffer.from(envelope.ciphertext, 'base64url').length,
    };
};

module.exports = {
    ENVELOPE_VERSION,
    TOKEN_PREFIX,
    DEFAULT_CONTEXT,
    DATA_KEY_CONTEXT,
    AEAD_ALGORITHM,
    AEAD_KEY_BYTES,
    IV_BYTES,
    TAG_BYTES,
    X25519_PUBLIC_DER_BYTES,
    ML_KEM_768_CIPHERTEXT_BYTES,
    encapsulate,
    decapsulate,
    sealBuffer,
    openBuffer,
    sealToken,
    openToken,
    sealValue,
    openValue,
    serializeEnvelope,
    parseEnvelope,
    describeEnvelope,
    wrapDataKey,
    unwrapDataKey,
    buildTranscript,
    buildAad,
};
