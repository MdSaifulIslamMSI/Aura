const crypto = require('crypto');
const cbor = require('cbor');
const { flags: trustedDeviceFlags } = require('../config/authTrustedDeviceFlags');

const PASSKEY_METHOD = 'webauthn';
const DEFAULT_RP_NAME = 'Aura Trusted Device';
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeUserVerification = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (['required', 'preferred', 'discouraged'].includes(normalized)) {
        return normalized;
    }
    return 'required';
};

const toArray = (input) => {
    if (!input) return Buffer.alloc(0);
    return Buffer.isBuffer(input) ? input : Buffer.from(input);
};

const toBase64Url = (input) => toArray(input).toString('base64url');
const toBase64 = (input) => toArray(input).toString('base64');
const fromBase64Url = (value) => Buffer.from(String(value || ''), 'base64url');

const sha256 = (input) => crypto.createHash('sha256').update(input).digest();

const getRequestOrigin = (req = {}) => {
    const explicitOrigin = normalizeText(req.headers?.origin || '');
    if (explicitOrigin) return explicitOrigin;

    const referer = normalizeText(req.headers?.referer || '');
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch {
            // Fall through to host-based origin.
        }
    }

    const host = normalizeText(req.get?.('host') || req.headers?.host || '');
    if (!host) {
        return normalizeText(trustedDeviceFlags.authWebAuthnOrigin || '') || 'https://localhost';
    }

    const forwardedProto = normalizeText(req.headers?.['x-forwarded-proto'] || '');
    const protocol = forwardedProto.split(',')[0].trim() || req.protocol || 'https';
    return `${protocol}://${host}`;
};

const resolveWebAuthnRequestContext = (req = {}) => {
    const requestOrigin = getRequestOrigin(req);
    if (!requestOrigin) {
        throw new Error('Unable to resolve WebAuthn origin for trusted device verification');
    }

    const rpId = normalizeText(trustedDeviceFlags.authWebAuthnRpId)
        || new URL(requestOrigin).hostname;

    return {
        origin: requestOrigin,
        rpId,
        rpName: normalizeText(trustedDeviceFlags.authWebAuthnRpName) || DEFAULT_RP_NAME,
        userVerification: normalizeUserVerification(trustedDeviceFlags.authWebAuthnUserVerification),
        timeoutMs: Math.max(Number(trustedDeviceFlags.authWebAuthnTimeoutMs || 60_000), 15_000),
    };
};

const normalizeTransport = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (['ble', 'hybrid', 'internal', 'nfc', 'usb'].includes(normalized)) {
        return normalized;
    }
    return '';
};

const normalizeTransports = (values = []) => (
    Array.isArray(values)
        ? values.map((value) => normalizeTransport(value)).filter(Boolean)
        : []
);

const createUserIdHandle = (userId) => Buffer.from(String(userId || ''), 'utf8');

const buildRegistrationOptions = ({
    challenge = '',
    context = {},
    user = {},
}) => ({
    challenge,
    rp: {
        id: context.rpId,
        name: context.rpName || DEFAULT_RP_NAME,
    },
    user: {
        id: toBase64Url(createUserIdHandle(user._id || user.id || '')),
        name: String(user.email || '').trim().toLowerCase(),
        displayName: String(user.name || user.email || 'Aura User').trim().slice(0, 64) || 'Aura User',
    },
    timeout: context.timeoutMs,
    attestation: 'none',
    authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: context.userVerification,
    },
    pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
    ],
});

const buildAssertionOptions = ({
    challenge = '',
    context = {},
    credentialIdBase64Url = '',
    transports = [],
}) => ({
    challenge,
    rpId: context.rpId,
    timeout: context.timeoutMs,
    userVerification: context.userVerification,
    allowCredentials: credentialIdBase64Url
        ? [{
            id: credentialIdBase64Url,
            type: 'public-key',
            transports: normalizeTransports(transports),
        }]
        : [],
});

const parseClientData = (clientDataJSONBase64Url = '') => {
    const raw = fromBase64Url(clientDataJSONBase64Url);
    const parsed = JSON.parse(raw.toString('utf8'));
    return { raw, parsed };
};

const ensureExpectedClientData = ({
    clientDataJSONBase64Url = '',
    expectedType = '',
    expectedChallenge = '',
    expectedOrigin = '',
}) => {
    const { raw, parsed } = parseClientData(clientDataJSONBase64Url);
    if (String(parsed?.type || '') !== expectedType) {
        throw new Error(`WebAuthn client data type mismatch: expected ${expectedType}`);
    }
    if (String(parsed?.challenge || '') !== String(expectedChallenge || '')) {
        throw new Error('WebAuthn challenge mismatch');
    }
    if (String(parsed?.origin || '') !== String(expectedOrigin || '')) {
        throw new Error('WebAuthn origin mismatch');
    }
    return { raw, parsed };
};

const parseAuthenticatorData = (rawAuthenticatorData) => {
    const buffer = toArray(rawAuthenticatorData);
    if (buffer.length < 37) {
        throw new Error('WebAuthn authenticator data is malformed');
    }

    const flags = buffer[32];
    const signCount = buffer.readUInt32BE(33);
    const parsed = {
        raw: buffer,
        rpIdHash: buffer.subarray(0, 32),
        flags,
        signCount,
        userPresent: Boolean(flags & FLAG_USER_PRESENT),
        userVerified: Boolean(flags & FLAG_USER_VERIFIED),
        attestedCredentialData: Boolean(flags & FLAG_ATTESTED_CREDENTIAL_DATA),
    };

    if (!parsed.attestedCredentialData) {
        return parsed;
    }

    let offset = 37;
    parsed.aaguid = toBase64Url(buffer.subarray(offset, offset + 16));
    offset += 16;

    const credentialIdLength = buffer.readUInt16BE(offset);
    offset += 2;

    parsed.credentialId = buffer.subarray(offset, offset + credentialIdLength);
    offset += credentialIdLength;
    parsed.credentialPublicKeyBytes = buffer.subarray(offset);
    return parsed;
};

const getCoseValue = (coseMap, key) => {
    if (!coseMap) return undefined;
    if (typeof coseMap.get === 'function') return coseMap.get(key);
    return coseMap[key];
};

const coseToJwk = (cosePublicKey) => {
    const keyType = getCoseValue(cosePublicKey, 1);
    const algorithm = Number(getCoseValue(cosePublicKey, 3) || 0);

    if (keyType === 2) {
        const curve = getCoseValue(cosePublicKey, -1);
        const x = getCoseValue(cosePublicKey, -2);
        const y = getCoseValue(cosePublicKey, -3);
        if (!x || !y || curve !== 1) {
            throw new Error('Unsupported WebAuthn EC credential');
        }
        return {
            jwk: {
                kty: 'EC',
                crv: 'P-256',
                x: toBase64Url(x),
                y: toBase64Url(y),
                ext: true,
            },
            algorithmLabel: algorithm === -7 ? 'WEBAUTHN-ES256' : 'WEBAUTHN-EC',
        };
    }

    if (keyType === 3) {
        const n = getCoseValue(cosePublicKey, -1);
        const e = getCoseValue(cosePublicKey, -2);
        if (!n || !e) {
            throw new Error('Unsupported WebAuthn RSA credential');
        }
        return {
            jwk: {
                kty: 'RSA',
                n: toBase64Url(n),
                e: toBase64Url(e),
                ext: true,
            },
            algorithmLabel: algorithm === -257 ? 'WEBAUTHN-RS256' : 'WEBAUTHN-RSA',
        };
    }

    throw new Error('Unsupported WebAuthn credential type');
};

const toPublicKeySpkiBase64 = (cosePublicKeyBytes) => {
    const decoded = cbor.decodeFirstSync(toArray(cosePublicKeyBytes));
    const { jwk, algorithmLabel } = coseToJwk(decoded);
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return {
        publicKeySpkiBase64: toBase64(publicKey.export({ format: 'der', type: 'spki' })),
        algorithmLabel,
    };
};

const ensureAuthenticatorBinding = ({
    authenticatorData = {},
    expectedRpId = '',
    userVerification = 'required',
}) => {
    const expectedRpIdHash = sha256(Buffer.from(String(expectedRpId || ''), 'utf8'));
    if (!authenticatorData.rpIdHash.equals(expectedRpIdHash)) {
        throw new Error('WebAuthn relying party binding mismatch');
    }
    if (!authenticatorData.userPresent) {
        throw new Error('WebAuthn user presence is required');
    }
    if (normalizeUserVerification(userVerification) === 'required' && !authenticatorData.userVerified) {
        throw new Error('WebAuthn user verification is required');
    }
};

const verifyWebAuthnRegistration = ({
    credential = {},
    expectedChallenge = '',
    expectedOrigin = '',
    expectedRpId = '',
    userVerification = 'required',
}) => {
    const response = credential?.response || {};
    if (!response.attestationObjectBase64Url || !response.clientDataJSONBase64Url) {
        throw new Error('WebAuthn registration payload is incomplete');
    }

    ensureExpectedClientData({
        clientDataJSONBase64Url: response.clientDataJSONBase64Url,
        expectedType: 'webauthn.create',
        expectedChallenge,
        expectedOrigin,
    });

    const attestationObject = cbor.decodeFirstSync(fromBase64Url(response.attestationObjectBase64Url));
    const authenticatorData = parseAuthenticatorData(attestationObject?.authData);
    if (!authenticatorData.attestedCredentialData || !authenticatorData.credentialId || !authenticatorData.credentialPublicKeyBytes) {
        throw new Error('WebAuthn registration data is incomplete');
    }

    ensureAuthenticatorBinding({
        authenticatorData,
        expectedRpId,
        userVerification,
    });

    const { publicKeySpkiBase64, algorithmLabel } = toPublicKeySpkiBase64(authenticatorData.credentialPublicKeyBytes);

    return {
        method: PASSKEY_METHOD,
        algorithm: algorithmLabel,
        publicKeySpkiBase64,
        credentialIdBase64Url: toBase64Url(authenticatorData.credentialId),
        counter: Number(authenticatorData.signCount || 0),
        transports: normalizeTransports(response.transports),
        authenticatorAttachment: normalizeText(credential?.authenticatorAttachment || ''),
        userVerification: normalizeUserVerification(userVerification),
        aaguid: normalizeText(authenticatorData.aaguid || ''),
    };
};

const verifyWebAuthnAssertion = ({
    credential = {},
    expectedChallenge = '',
    expectedOrigin = '',
    expectedRpId = '',
    userVerification = 'required',
    storedPublicKeySpkiBase64 = '',
    storedCredentialIdBase64Url = '',
    storedCounter = 0,
}) => {
    const response = credential?.response || {};
    if (!response.authenticatorDataBase64Url || !response.clientDataJSONBase64Url || !response.signatureBase64Url) {
        throw new Error('WebAuthn assertion payload is incomplete');
    }

    const { raw: clientDataRaw } = ensureExpectedClientData({
        clientDataJSONBase64Url: response.clientDataJSONBase64Url,
        expectedType: 'webauthn.get',
        expectedChallenge,
        expectedOrigin,
    });

    const rawIdBase64Url = normalizeText(credential?.rawIdBase64Url || credential?.id || '');
    if (!rawIdBase64Url || rawIdBase64Url !== String(storedCredentialIdBase64Url || '')) {
        throw new Error('WebAuthn credential mismatch');
    }

    const authenticatorData = parseAuthenticatorData(fromBase64Url(response.authenticatorDataBase64Url));
    ensureAuthenticatorBinding({
        authenticatorData,
        expectedRpId,
        userVerification,
    });

    const verificationData = Buffer.concat([
        authenticatorData.raw,
        sha256(clientDataRaw),
    ]);
    const signature = fromBase64Url(response.signatureBase64Url);
    const publicKey = crypto.createPublicKey({
        key: Buffer.from(String(storedPublicKeySpkiBase64 || ''), 'base64'),
        format: 'der',
        type: 'spki',
    });

    const verified = crypto.verify('sha256', verificationData, publicKey, signature);
    if (!verified) {
        throw new Error('WebAuthn assertion signature invalid');
    }

    const nextCounter = Number(authenticatorData.signCount || 0);
    const previousCounter = Number(storedCounter || 0);
    if (previousCounter > 0 && nextCounter > 0 && nextCounter <= previousCounter) {
        throw new Error('WebAuthn signature counter regression detected');
    }

    return {
        counter: nextCounter > 0 ? nextCounter : previousCounter,
        userVerification: normalizeUserVerification(userVerification),
    };
};

module.exports = {
    PASSKEY_METHOD,
    normalizeUserVerification,
    normalizeTransports,
    resolveWebAuthnRequestContext,
    buildRegistrationOptions,
    buildAssertionOptions,
    verifyWebAuthnRegistration,
    verifyWebAuthnAssertion,
};
