const crypto = require('crypto');
const cbor = require('cbor');
const { flags: trustedDeviceFlags } = require('../config/authTrustedDeviceFlags');

const PASSKEY_METHOD = 'webauthn';
const DEFAULT_RP_NAME = 'Aura Trusted Device';
const CLIENT_ORIGIN_HEADER = 'x-aura-client-origin';
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKUP_STATE = 0x10;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;
const FLAG_EXTENSION_DATA = 0x80;
const MAX_CLIENT_DATA_BYTES = 16 * 1024;
const MAX_ATTESTATION_OBJECT_BYTES = 128 * 1024;
const MAX_AUTHENTICATOR_DATA_BYTES = 16 * 1024;
const MAX_CREDENTIAL_ID_BYTES = 1024;
const MAX_CREDENTIAL_PUBLIC_KEY_BYTES = 8 * 1024;
const MAX_SIGNATURE_BYTES = 2 * 1024;
const MAX_USER_HANDLE_BYTES = 64;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeHost = (value = '') => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';

    try {
        const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
        return normalizeText(url.hostname).toLowerCase();
    } catch {
        return normalized
            .replace(/^https?:\/\//i, '')
            .replace(/\/.*$/, '')
            .replace(/:\d+$/, '')
            .trim();
    }
};

const isIpv4Host = (host = '') => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);

const isIpv6Host = (host = '') => {
    const normalized = String(host || '').trim();
    return Boolean(
        normalized
        && !normalized.includes('.')
        && (normalized.includes(':') || normalized.startsWith('[') || normalized.endsWith(']'))
    );
};

const isIpLiteralHost = (host = '') => isIpv4Host(host) || isIpv6Host(host);

const isRegistrableHost = (host = '') => {
    const normalized = normalizeHost(host);
    if (!normalized || normalized === 'localhost' || isIpLiteralHost(normalized)) {
        return false;
    }

    const labels = normalized.split('.').filter(Boolean);
    if (labels.length < 2) return false;

    return labels.every((label) => /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'))
        && /[a-z]/i.test(labels[labels.length - 1] || '');
};

const isRpIdCompatibleWithHost = ({ host = '', rpId = '' } = {}) => {
    const normalizedHost = normalizeHost(host);
    const normalizedRpId = normalizeHost(rpId);
    if (!normalizedHost || !normalizedRpId) return false;
    return normalizedHost === normalizedRpId || normalizedHost.endsWith(`.${normalizedRpId}`);
};

const normalizeUserVerification = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (['required', 'preferred', 'discouraged'].includes(normalized)) {
        return normalized;
    }
    return 'required';
};

const normalizeAuthenticatorAttachment = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (['platform', 'cross-platform'].includes(normalized)) {
        return normalized;
    }
    return 'platform';
};

const toArray = (input) => {
    if (!input) return Buffer.alloc(0);
    return Buffer.isBuffer(input) ? input : Buffer.from(input);
};

const toBase64Url = (input) => toArray(input).toString('base64url');
const toBase64 = (input) => toArray(input).toString('base64');

const decodeBase64Url = (value, {
    field = 'WebAuthn value',
    minBytes = 1,
    maxBytes = MAX_ATTESTATION_OBJECT_BYTES,
    allowEmpty = false,
} = {}) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        if (allowEmpty) return Buffer.alloc(0);
        throw new Error(`${field} is missing`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
        throw new Error(`${field} is not valid base64url`);
    }

    const maximumEncodedLength = Math.ceil((Math.max(maxBytes, 0) * 4) / 3) + 2;
    if (normalized.length > maximumEncodedLength) {
        throw new Error(`${field} is too large`);
    }

    const decoded = Buffer.from(normalized, 'base64url');
    if (
        decoded.length < Math.max(minBytes, 0)
        || decoded.length > Math.max(maxBytes, 0)
        || decoded.toString('base64url') !== normalized
    ) {
        throw new Error(`${field} is malformed`);
    }
    return decoded;
};

const sha256 = (input) => crypto.createHash('sha256').update(input).digest();

const normalizeOrigin = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    try {
        const parsed = new URL(normalized);
        if (
            !['http:', 'https:'].includes(parsed.protocol)
            || parsed.origin === 'null'
            || parsed.username
            || parsed.password
        ) {
            return '';
        }
        return parsed.origin;
    } catch {
        return '';
    }
};

const getBrowserDeclaredOrigin = (req = {}) => {
    const explicitOrigin = normalizeText(req.headers?.origin || '');
    if (explicitOrigin) return explicitOrigin;

    const referer = normalizeText(req.headers?.referer || '');
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch {
            return '';
        }
    }

    return '';
};

const getRequestOrigin = (req = {}) => {
    const browserDeclaredOrigin = getBrowserDeclaredOrigin(req);
    if (browserDeclaredOrigin) return browserDeclaredOrigin;

    // This compatibility header is intentionally limited to local/test use. In
    // production it is attacker-controlled and must never select the RP origin.
    if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
        const explicitClientOrigin = normalizeText(
            req.get?.(CLIENT_ORIGIN_HEADER)
            || req.headers?.[CLIENT_ORIGIN_HEADER]
            || ''
        );
        if (explicitClientOrigin) return explicitClientOrigin;
    }

    const host = normalizeText(req.get?.('host') || req.headers?.host || '');
    const forwardedHost = normalizeText(req.headers?.['x-forwarded-host'] || '');
    const resolvedHost = forwardedHost.split(',')[0].trim() || host;
    if (!resolvedHost) {
        return normalizeText(trustedDeviceFlags.authWebAuthnOrigin || '') || 'https://localhost';
    }

    const forwardedProto = normalizeText(req.headers?.['x-forwarded-proto'] || '');
    const protocol = forwardedProto.split(',')[0].trim() || req.protocol || 'https';
    return `${protocol}://${resolvedHost}`;
};

const resolveWebAuthnRequestContext = (req = {}) => {
    const configuredOrigin = normalizeText(trustedDeviceFlags.authWebAuthnOrigin || '');
    const normalizedConfiguredOrigin = normalizeOrigin(configuredOrigin);
    const configuredRpId = normalizeHost(trustedDeviceFlags.authWebAuthnRpId || '');
    const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    if (isProduction && (
        !normalizedConfiguredOrigin
        || configuredOrigin !== normalizedConfiguredOrigin
        || !configuredRpId
    )) {
        throw new Error('Production WebAuthn requires an exact configured origin and relying-party ID');
    }
    const browserDeclaredOrigin = getBrowserDeclaredOrigin(req);
    const normalizedBrowserDeclaredOrigin = normalizeOrigin(browserDeclaredOrigin);
    const inferredRequestOrigin = getRequestOrigin(req);
    const requestOrigin = normalizedConfiguredOrigin || normalizeOrigin(inferredRequestOrigin);
    if (!requestOrigin) {
        throw new Error('Unable to resolve WebAuthn origin for trusted device verification');
    }

    const requestHost = normalizeHost(requestOrigin);
    const configuredOriginHost = normalizeHost(normalizedConfiguredOrigin);
    const rpId = configuredRpId || requestHost;

    let enrollmentIneligibilityReason = '';
    if (configuredOrigin && (
        !normalizedConfiguredOrigin
        || configuredOrigin !== normalizedConfiguredOrigin
    )) {
        enrollmentIneligibilityReason = 'The configured WebAuthn origin is invalid.';
    } else if (browserDeclaredOrigin && !normalizedBrowserDeclaredOrigin) {
        enrollmentIneligibilityReason = 'The browser supplied an invalid WebAuthn origin.';
    } else if (
        normalizedConfiguredOrigin
        && normalizedBrowserDeclaredOrigin
        && normalizedConfiguredOrigin !== normalizedBrowserDeclaredOrigin
    ) {
        enrollmentIneligibilityReason = 'The configured WebAuthn origin does not match the browser origin.';
    } else if (isProduction && (!normalizedConfiguredOrigin || !configuredRpId)) {
        enrollmentIneligibilityReason = 'Production passkeys require a configured WebAuthn origin and relying-party ID.';
    } else if (!requestHost) {
        enrollmentIneligibilityReason = 'Passkeys need a host-bound origin for trusted device enrollment.';
    } else if (isIpLiteralHost(requestHost)) {
        enrollmentIneligibilityReason = 'Passkeys are not offered on IP-address hosts. Use localhost or a verified domain instead.';
    } else if (!(requestHost === 'localhost' || isRegistrableHost(requestHost))) {
        enrollmentIneligibilityReason = 'Passkeys are only offered on localhost or verified domains that can own a relying-party ID.';
    } else if (!isRpIdCompatibleWithHost({ host: requestHost, rpId })) {
        enrollmentIneligibilityReason = 'The configured WebAuthn relying party ID does not match this host.';
    }

    return {
        origin: requestOrigin,
        rpId,
        rpName: normalizeText(trustedDeviceFlags.authWebAuthnRpName) || DEFAULT_RP_NAME,
        userVerification: normalizeUserVerification(trustedDeviceFlags.authWebAuthnUserVerification),
        authenticatorAttachment: normalizeAuthenticatorAttachment(trustedDeviceFlags.authWebAuthnAuthenticatorAttachment),
        timeoutMs: Math.max(Number(trustedDeviceFlags.authWebAuthnTimeoutMs || 60_000), 15_000),
        requestHost,
        configuredOrigin: normalizedConfiguredOrigin,
        configuredOriginHost,
        configuredRpId,
        browserDeclaredOrigin: normalizedBrowserDeclaredOrigin,
        isEnrollmentEligible: !enrollmentIneligibilityReason,
        enrollmentIneligibilityReason,
    };
};

const normalizeTransport = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'].includes(normalized)) {
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
        authenticatorAttachment: context.authenticatorAttachment || 'platform',
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
    const raw = decodeBase64Url(clientDataJSONBase64Url, {
        field: 'WebAuthn client data',
        maxBytes: MAX_CLIENT_DATA_BYTES,
    });
    let parsed;
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch {
        throw new Error('WebAuthn client data is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('WebAuthn client data is malformed');
    }
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
    const clientOrigin = normalizeOrigin(parsed?.origin || '');
    const normalizedExpectedOrigin = normalizeOrigin(expectedOrigin);
    if (!clientOrigin || !normalizedExpectedOrigin || clientOrigin !== normalizedExpectedOrigin) {
        throw new Error('WebAuthn origin mismatch');
    }
    if (parsed?.crossOrigin === true || normalizeText(parsed?.topOrigin || '')) {
        throw new Error('Cross-origin WebAuthn ceremonies are not supported');
    }
    return { raw, parsed };
};

const ensurePublicKeyCredential = ({ credential = {}, expectedCredentialIdBase64Url = '' } = {}) => {
    if (normalizeText(credential?.type) !== 'public-key') {
        throw new Error('WebAuthn credential type must be public-key');
    }

    const rawIdBase64Url = normalizeText(credential?.rawIdBase64Url || '');
    const rawId = decodeBase64Url(rawIdBase64Url, {
        field: 'WebAuthn credential ID',
        maxBytes: MAX_CREDENTIAL_ID_BYTES,
    });
    const serializedId = normalizeText(credential?.id || '');
    if (serializedId) {
        const id = decodeBase64Url(serializedId, {
            field: 'WebAuthn credential ID',
            maxBytes: MAX_CREDENTIAL_ID_BYTES,
        });
        if (id.length !== rawId.length || !crypto.timingSafeEqual(id, rawId)) {
            throw new Error('WebAuthn credential ID fields do not match');
        }
    }

    if (expectedCredentialIdBase64Url) {
        const expectedCredentialId = decodeBase64Url(expectedCredentialIdBase64Url, {
            field: 'Stored WebAuthn credential ID',
            maxBytes: MAX_CREDENTIAL_ID_BYTES,
        });
        if (
            expectedCredentialId.length !== rawId.length
            || !crypto.timingSafeEqual(expectedCredentialId, rawId)
        ) {
            throw new Error('WebAuthn credential mismatch');
        }
    }

    return { rawId, rawIdBase64Url };
};

const ensureExpectedUserHandle = ({
    userHandleBase64Url = '',
    expectedUserHandleBase64Url = '',
} = {}) => {
    const normalizedUserHandle = normalizeText(userHandleBase64Url);
    if (!normalizedUserHandle) return;
    if (!expectedUserHandleBase64Url) {
        throw new Error('WebAuthn user handle was not expected');
    }

    const userHandle = decodeBase64Url(normalizedUserHandle, {
        field: 'WebAuthn user handle',
        maxBytes: MAX_USER_HANDLE_BYTES,
    });
    const expectedUserHandle = decodeBase64Url(expectedUserHandleBase64Url, {
        field: 'Expected WebAuthn user handle',
        maxBytes: MAX_USER_HANDLE_BYTES,
    });
    if (
        userHandle.length !== expectedUserHandle.length
        || !crypto.timingSafeEqual(userHandle, expectedUserHandle)
    ) {
        throw new Error('WebAuthn user handle mismatch');
    }
};

const parseAuthenticatorData = (rawAuthenticatorData) => {
    const buffer = toArray(rawAuthenticatorData);
    if (buffer.length < 37 || buffer.length > MAX_AUTHENTICATOR_DATA_BYTES) {
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
        backupEligible: Boolean(flags & FLAG_BACKUP_ELIGIBLE),
        backedUp: Boolean(flags & FLAG_BACKUP_STATE),
        attestedCredentialData: Boolean(flags & FLAG_ATTESTED_CREDENTIAL_DATA),
        extensionDataIncluded: Boolean(flags & FLAG_EXTENSION_DATA),
    };

    if (parsed.backedUp && !parsed.backupEligible) {
        throw new Error('WebAuthn backup state is inconsistent');
    }

    if (!parsed.attestedCredentialData) {
        if (!parsed.extensionDataIncluded && buffer.length !== 37) {
            throw new Error('WebAuthn authenticator data contains unexpected trailing bytes');
        }
        return parsed;
    }

    let offset = 37;
    if (buffer.length < offset + 18) {
        throw new Error('WebAuthn attested credential data is malformed');
    }
    parsed.aaguid = toBase64Url(buffer.subarray(offset, offset + 16));
    offset += 16;

    const credentialIdLength = buffer.readUInt16BE(offset);
    offset += 2;

    if (
        credentialIdLength < 1
        || credentialIdLength > MAX_CREDENTIAL_ID_BYTES
        || buffer.length <= offset + credentialIdLength
    ) {
        throw new Error('WebAuthn credential ID length is invalid');
    }

    parsed.credentialId = buffer.subarray(offset, offset + credentialIdLength);
    offset += credentialIdLength;
    parsed.credentialPublicKeyBytes = buffer.subarray(offset);
    if (parsed.credentialPublicKeyBytes.length > MAX_CREDENTIAL_PUBLIC_KEY_BYTES) {
        throw new Error('WebAuthn credential public key is too large');
    }
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
        const x = toArray(getCoseValue(cosePublicKey, -2));
        const y = toArray(getCoseValue(cosePublicKey, -3));
        if (algorithm !== -7 || curve !== 1 || x.length !== 32 || y.length !== 32) {
            throw new Error('Unsupported WebAuthn EC credential');
        }
        return {
            jwk: {
                kty: 'EC',
                crv: 'P-256',
                x: toBase64Url(x),
                y: toBase64Url(y),
                alg: 'ES256',
                key_ops: ['verify'],
                ext: true,
            },
            algorithmLabel: 'WEBAUTHN-ES256',
        };
    }

    if (keyType === 3) {
        const n = toArray(getCoseValue(cosePublicKey, -1));
        const e = toArray(getCoseValue(cosePublicKey, -2));
        if (
            algorithm !== -257
            || n.length < 256
            || n.length > 512
            || e.length < 1
            || e.length > 4
        ) {
            throw new Error('Unsupported WebAuthn RSA credential');
        }
        return {
            jwk: {
                kty: 'RSA',
                n: toBase64Url(n),
                e: toBase64Url(e),
                alg: 'RS256',
                key_ops: ['verify'],
                ext: true,
            },
            algorithmLabel: 'WEBAUTHN-RS256',
        };
    }

    throw new Error('Unsupported WebAuthn credential type');
};

const toPublicKeySpkiBase64 = (cosePublicKeyBytes) => {
    const encoded = toArray(cosePublicKeyBytes);
    if (!encoded.length || encoded.length > MAX_CREDENTIAL_PUBLIC_KEY_BYTES) {
        throw new Error('WebAuthn credential public key is malformed');
    }
    const decoded = cbor.decodeFirstSync(encoded);
    const { jwk, algorithmLabel } = coseToJwk(decoded);
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return {
        publicKeySpkiBase64: toBase64(publicKey.export({ format: 'der', type: 'spki' })),
        algorithmLabel,
    };
};

const isEmptyAttestationStatement = (attestationStatement) => {
    if (attestationStatement instanceof Map) {
        return attestationStatement.size === 0;
    }
    return Boolean(
        attestationStatement
        && typeof attestationStatement === 'object'
        && !Array.isArray(attestationStatement)
        && Object.keys(attestationStatement).length === 0
    );
};

const ensureNoneAttestation = (attestationObject = {}) => {
    if (
        normalizeText(attestationObject?.fmt) !== 'none'
        || !isEmptyAttestationStatement(attestationObject?.attStmt)
        || !Buffer.isBuffer(attestationObject?.authData)
    ) {
        throw new Error('Only WebAuthn none attestation is supported');
    }
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

    const { rawId } = ensurePublicKeyCredential({ credential });

    ensureExpectedClientData({
        clientDataJSONBase64Url: response.clientDataJSONBase64Url,
        expectedType: 'webauthn.create',
        expectedChallenge,
        expectedOrigin,
    });

    const attestationObjectBytes = decodeBase64Url(response.attestationObjectBase64Url, {
        field: 'WebAuthn attestation object',
        maxBytes: MAX_ATTESTATION_OBJECT_BYTES,
    });
    const attestationObject = cbor.decodeFirstSync(attestationObjectBytes);
    ensureNoneAttestation(attestationObject);
    const authenticatorData = parseAuthenticatorData(attestationObject?.authData);
    if (!authenticatorData.attestedCredentialData || !authenticatorData.credentialId || !authenticatorData.credentialPublicKeyBytes) {
        throw new Error('WebAuthn registration data is incomplete');
    }

    ensureAuthenticatorBinding({
        authenticatorData,
        expectedRpId,
        userVerification,
    });

    if (
        rawId.length !== authenticatorData.credentialId.length
        || !crypto.timingSafeEqual(rawId, authenticatorData.credentialId)
    ) {
        throw new Error('WebAuthn attested credential ID mismatch');
    }
    if (authenticatorData.extensionDataIncluded) {
        throw new Error('Unexpected WebAuthn registration extensions');
    }

    const { publicKeySpkiBase64, algorithmLabel } = toPublicKeySpkiBase64(authenticatorData.credentialPublicKeyBytes);

    return {
        method: PASSKEY_METHOD,
        algorithm: algorithmLabel,
        publicKeySpkiBase64,
        credentialIdBase64Url: toBase64Url(authenticatorData.credentialId),
        counter: Number(authenticatorData.signCount || 0),
        transports: normalizeTransports(response.transports),
        authenticatorAttachment: normalizeText(credential?.authenticatorAttachment || ''),
        // Persist what the authenticator actually asserted, not only the
        // preference that the RP requested. A preferred ceremony without UV
        // is a possession proof, not an MFA event.
        userVerification: authenticatorData.userVerified
            ? 'required'
            : normalizeUserVerification(userVerification),
        userVerified: Boolean(authenticatorData.userVerified),
        aaguid: normalizeText(authenticatorData.aaguid || ''),
        backupEligible: Boolean(authenticatorData.backupEligible),
        backedUp: Boolean(authenticatorData.backedUp),
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
    expectedUserHandleBase64Url = '',
}) => {
    const response = credential?.response || {};
    if (!response.authenticatorDataBase64Url || !response.clientDataJSONBase64Url || !response.signatureBase64Url) {
        throw new Error('WebAuthn assertion payload is incomplete');
    }

    const { rawId } = ensurePublicKeyCredential({
        credential,
        expectedCredentialIdBase64Url: storedCredentialIdBase64Url,
    });

    const { raw: clientDataRaw } = ensureExpectedClientData({
        clientDataJSONBase64Url: response.clientDataJSONBase64Url,
        expectedType: 'webauthn.get',
        expectedChallenge,
        expectedOrigin,
    });

    ensureExpectedUserHandle({
        userHandleBase64Url: response.userHandleBase64Url,
        expectedUserHandleBase64Url,
    });

    const authenticatorData = parseAuthenticatorData(decodeBase64Url(response.authenticatorDataBase64Url, {
        field: 'WebAuthn authenticator data',
        maxBytes: MAX_AUTHENTICATOR_DATA_BYTES,
    }));
    ensureAuthenticatorBinding({
        authenticatorData,
        expectedRpId,
        userVerification,
    });
    if (authenticatorData.attestedCredentialData || authenticatorData.extensionDataIncluded) {
        throw new Error('WebAuthn assertion authenticator data is malformed');
    }

    const verificationData = Buffer.concat([
        authenticatorData.raw,
        sha256(clientDataRaw),
    ]);
    const signature = decodeBase64Url(response.signatureBase64Url, {
        field: 'WebAuthn assertion signature',
        maxBytes: MAX_SIGNATURE_BYTES,
    });
    const storedPublicKey = Buffer.from(String(storedPublicKeySpkiBase64 || ''), 'base64');
    if (!storedPublicKey.length || storedPublicKey.length > MAX_CREDENTIAL_PUBLIC_KEY_BYTES) {
        throw new Error('Stored WebAuthn public key is malformed');
    }
    const publicKey = crypto.createPublicKey({
        key: storedPublicKey,
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
        userVerification: authenticatorData.userVerified
            ? 'required'
            : normalizeUserVerification(userVerification),
        userVerified: Boolean(authenticatorData.userVerified),
        credentialIdBase64Url: toBase64Url(rawId),
        backupEligible: Boolean(authenticatorData.backupEligible),
        backedUp: Boolean(authenticatorData.backedUp),
    };
};

module.exports = {
    PASSKEY_METHOD,
    normalizeUserVerification,
    normalizeAuthenticatorAttachment,
    normalizeTransports,
    resolveWebAuthnRequestContext,
    buildRegistrationOptions,
    buildAssertionOptions,
    verifyWebAuthnRegistration,
    verifyWebAuthnAssertion,
};
