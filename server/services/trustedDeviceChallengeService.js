const crypto = require('crypto');
const User = require('../models/User');
const {
    flags: trustedDeviceFlags,
    getCurrentTrustedDeviceKeyEntry,
    getTrustedDeviceSecretsByVersion,
} = require('../config/authTrustedDeviceFlags');
const {
    PASSKEY_METHOD,
    buildAssertionOptions,
    buildRegistrationOptions,
    normalizeTransports,
    resolveWebAuthnRequestContext,
    verifyWebAuthnAssertion,
    verifyWebAuthnRegistration,
} = require('./webauthnTrustedDeviceService');

const TRUSTED_DEVICE_ID_HEADER = 'x-aura-device-id';
const TRUSTED_DEVICE_LABEL_HEADER = 'x-aura-device-label';
const TRUSTED_DEVICE_SESSION_HEADER = 'x-aura-device-session';
const DEVICE_CHALLENGE_TTL_MS = Math.max(Number(process.env.AUTH_DEVICE_CHALLENGE_TTL_MS || 90_000), 30_000);
const MAX_TRUSTED_DEVICES = Math.max(Number(process.env.AUTH_TRUSTED_DEVICE_LIMIT || 5), 1);
const DEVICE_SESSION_TTL_MS = Math.max(Number(process.env.AUTH_DEVICE_SESSION_TTL_MS || (12 * 60 * 60 * 1000)), 5 * 60 * 1000);

const TOKEN_KEY_DERIVATION_SALT = 'aura-trusted-device-token';
const BROWSER_KEY_METHOD = 'browser_key';

const normalizeDeviceId = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (!/^[A-Za-z0-9:_-]{12,128}$/.test(normalized)) return '';
    return normalized;
};

const normalizeDeviceLabel = (value) => {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.slice(0, 120);
};

const normalizeChallengeScope = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (!/^[a-z0-9:_-]{1,64}$/.test(normalized)) return '';
    return normalized;
};

const extractTrustedDeviceContext = (req = {}) => ({
    deviceId: normalizeDeviceId(
        req.get?.(TRUSTED_DEVICE_ID_HEADER)
        || req.headers?.[TRUSTED_DEVICE_ID_HEADER]
        || req.body?.deviceId
        || ''
    ),
    deviceLabel: normalizeDeviceLabel(
        req.get?.(TRUSTED_DEVICE_LABEL_HEADER)
        || req.headers?.[TRUSTED_DEVICE_LABEL_HEADER]
        || req.body?.deviceLabel
        || ''
    ),
});

const getTrustedDeviceSessionToken = (req = {}) => String(
    req.get?.(TRUSTED_DEVICE_SESSION_HEADER)
    || req.headers?.[TRUSTED_DEVICE_SESSION_HEADER]
    || ''
).trim();

const hashTrustedDeviceSessionToken = (deviceSessionToken = '') => {
    const safeToken = String(deviceSessionToken || '').trim();
    if (!safeToken) return '';
    return crypto.createHash('sha256').update(safeToken).digest('hex');
};

const extractTrustedDeviceChallengePayload = (source = {}) => {
    const nested = source?.trustedDeviceChallenge && typeof source.trustedDeviceChallenge === 'object'
        ? source.trustedDeviceChallenge
        : {};
    const credential = nested.credential && typeof nested.credential === 'object'
        ? nested.credential
        : source?.credential && typeof source.credential === 'object'
            ? source.credential
        : source?.trustedDeviceChallengeCredential && typeof source.trustedDeviceChallengeCredential === 'object'
            ? source.trustedDeviceChallengeCredential
            : null;

    return {
        token: String(
            nested.token
            || nested.challengeToken
            || source?.token
            || source?.challengeToken
            || source?.trustedDeviceChallengeToken
            || ''
        ).trim(),
        method: String(
            nested.method
            || nested.challengeMethod
            || source?.method
            || source?.challengeMethod
            || source?.trustedDeviceChallengeMethod
            || ''
        ).trim().toLowerCase(),
        proof: String(
            nested.proof
            || nested.proofBase64
            || source?.proof
            || source?.proofBase64
            || source?.trustedDeviceChallengeProof
            || ''
        ).trim(),
        publicKeySpkiBase64: String(
            nested.publicKeySpkiBase64
            || source?.publicKeySpkiBase64
            || source?.trustedDeviceChallengePublicKeySpkiBase64
            || ''
        ).trim(),
        credential,
    };
};

const buildSessionBinding = ({ authUid = '', authToken = null } = {}) => {
    const sessionStartedAt = Number(authToken?.auth_time || authToken?.iat || 0);
    return `${String(authUid || '').trim()}:${Number.isFinite(sessionStartedAt) ? sessionStartedAt : 0}`;
};

const buildAcceptedSessionBindings = ({ authUid = '', authToken = null } = {}) => {
    const normalizedAuthUid = String(authUid || '').trim();
    const candidates = [
        Number(authToken?.auth_time || 0),
        Number(authToken?.iat || 0),
    ];

    return [...new Set(candidates
        .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
        .map((timestamp) => `${normalizedAuthUid}:${timestamp}`))];
};

const sessionBindingMatches = (payloadBinding = '', authContext = {}) => {
    const normalizedPayloadBinding = String(payloadBinding || '').trim();
    if (!normalizedPayloadBinding) return false;
    return buildAcceptedSessionBindings(authContext).includes(normalizedPayloadBinding)
        || normalizedPayloadBinding === buildSessionBinding(authContext);
};

const deriveTokenKey = (secret) => crypto.scryptSync(String(secret || ''), TOKEN_KEY_DERIVATION_SALT, 32);

const encryptPayload = (payload, secret) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveTokenKey(secret), iv);
    const encoded = Buffer.from(JSON.stringify(payload));
    const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
};

const decryptPayload = (encodedToken, secret) => {
    const buffer = Buffer.from(String(encodedToken || ''), 'base64url');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveTokenKey(secret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
};

const parseTokenEnvelope = (token) => {
    const rawToken = String(token || '').trim();
    const separatorIndex = rawToken.indexOf('.');
    if (separatorIndex <= 0) {
        return { keyVersion: '', encodedToken: rawToken, legacyToken: rawToken };
    }

    return {
        keyVersion: rawToken.slice(0, separatorIndex),
        encodedToken: rawToken.slice(separatorIndex + 1),
        legacyToken: rawToken,
    };
};

const sealToken = (payload) => {
    const keyEntry = getCurrentTrustedDeviceKeyEntry();
    if (!keyEntry?.secret) {
        throw new Error('Trusted device challenge secret is not configured');
    }

    const encodedToken = encryptPayload(payload, keyEntry.secret);
    return `${keyEntry.version}.${encodedToken}`;
};

const openToken = (token) => {
    const { keyVersion, encodedToken, legacyToken } = parseTokenEnvelope(token);
    const secretsByVersion = getTrustedDeviceSecretsByVersion();

    const attempts = [];
    if (keyVersion && secretsByVersion.has(keyVersion)) {
        attempts.push({
            keyVersion,
            secret: secretsByVersion.get(keyVersion),
            candidateToken: encodedToken,
        });
    }

    for (const [candidateVersion, secret] of secretsByVersion.entries()) {
        if (candidateVersion === keyVersion) continue;
        attempts.push({
            keyVersion: candidateVersion,
            secret,
            candidateToken: keyVersion ? encodedToken : legacyToken,
        });
    }

    for (const attempt of attempts) {
        try {
            return {
                payload: decryptPayload(attempt.candidateToken, attempt.secret),
                keyVersion: attempt.keyVersion,
            };
        } catch {
            // Keep trying rotation entries until one succeeds.
        }
    }

    throw new Error('Trusted device token invalid');
};

const buildChallengeMessage = ({ challenge = '', mode = '', deviceId = '' } = {}) => (
    Buffer.from(`aura-device-proof|${String(mode)}|${String(deviceId)}|${String(challenge)}`, 'utf8')
);

const normalizeChallengeMethod = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === PASSKEY_METHOD) return PASSKEY_METHOD;
    return BROWSER_KEY_METHOD;
};

const issueTrustedDeviceSession = ({
    user,
    authUid = '',
    authToken = null,
    deviceId = '',
} = {}) => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const expiresAt = Date.now() + DEVICE_SESSION_TTL_MS;

    return {
        deviceSessionToken: sealToken({
            typ: 'trusted_device_session',
            sub: String(user?._id || ''),
            deviceId: normalizedDeviceId,
            sessionBinding: buildSessionBinding({ authUid, authToken }),
            exp: expiresAt,
        }),
        expiresAt: new Date(expiresAt).toISOString(),
    };
};

const verifyTrustedDeviceSession = ({
    user,
    authUid = '',
    authToken = null,
    deviceId = '',
    deviceSessionToken = '',
} = {}) => {
    try {
        const { payload } = openToken(deviceSessionToken);
        const normalizedDeviceId = normalizeDeviceId(deviceId);

        if (payload?.typ !== 'trusted_device_session') {
            return { success: false, reason: 'Trusted device session type mismatch' };
        }
        if (String(payload?.sub || '') !== String(user?._id || '')) {
            return { success: false, reason: 'Trusted device session subject mismatch' };
        }
        if (payload?.deviceId !== normalizedDeviceId) {
            return { success: false, reason: 'Trusted device session device mismatch' };
        }
        if (Date.now() > Number(payload?.exp || 0)) {
            return { success: false, reason: 'Trusted device session expired' };
        }
        if (!sessionBindingMatches(payload?.sessionBinding, { authUid, authToken })) {
            return { success: false, reason: 'Trusted device session binding mismatch' };
        }

        return { success: true };
    } catch {
        return { success: false, reason: 'Trusted device session invalid' };
    }
};

const verifyTrustedDeviceBootstrapSession = ({
    user,
    deviceId = '',
    deviceSessionToken = '',
} = {}) => {
    try {
        const { payload } = openToken(deviceSessionToken);
        const normalizedDeviceId = normalizeDeviceId(deviceId);

        if (payload?.typ !== 'trusted_device_session') {
            return { success: false, reason: 'Trusted device session type mismatch' };
        }
        if (String(payload?.sub || '') !== String(user?._id || '')) {
            return { success: false, reason: 'Trusted device session subject mismatch' };
        }
        if (payload?.deviceId !== normalizedDeviceId) {
            return { success: false, reason: 'Trusted device session device mismatch' };
        }
        if (Date.now() > Number(payload?.exp || 0)) {
            return { success: false, reason: 'Trusted device session expired' };
        }

        return {
            success: true,
            deviceSessionHash: hashTrustedDeviceSessionToken(deviceSessionToken),
        };
    } catch {
        return { success: false, reason: 'Trusted device session invalid' };
    }
};

const issueTrustedDeviceBootstrapChallenge = async ({
    req = {},
    user = null,
    scope = '',
} = {}) => {
    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    const deviceSessionToken = getTrustedDeviceSessionToken(req);
    const existingDevice = getTrustedDeviceRegistration(user, deviceId);

    if (!user?._id || !deviceId || !deviceSessionToken || !existingDevice) {
        return null;
    }
    if (getTrustedDeviceMethod(existingDevice) !== PASSKEY_METHOD) {
        return null;
    }

    const verification = verifyTrustedDeviceBootstrapSession({
        user,
        deviceId,
        deviceSessionToken,
    });

    if (!verification.success) {
        return null;
    }

    return issueTrustedDeviceChallenge({
        user,
        deviceId,
        deviceLabel,
        req,
        allowEnrollment: false,
        expectedDeviceSessionHash: verification.deviceSessionHash,
        challengeScope: scope,
    });
};

const resolveTrustedDeviceBootstrapSignal = async ({
    req = {},
    user = null,
    challengePayload = {},
    expectedScope = '',
    requireFreshProof = false,
} = {}) => {
    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    const deviceSessionToken = getTrustedDeviceSessionToken(req);
    const existingDevice = getTrustedDeviceRegistration(user, deviceId);

    if (!user?._id || !deviceId || !deviceSessionToken || !existingDevice) {
        return {
            required: false,
            verified: false,
            deviceId: '',
            deviceSessionHash: '',
            method: '',
            reason: '',
        };
    }

    const sessionVerification = verifyTrustedDeviceBootstrapSession({
        user,
        deviceId,
        deviceSessionToken,
    });

    if (!sessionVerification.success) {
        return {
            required: false,
            verified: false,
            deviceId: '',
            deviceSessionHash: '',
            method: '',
            reason: '',
        };
    }
    if (getTrustedDeviceMethod(existingDevice) !== PASSKEY_METHOD) {
        return {
            required: false,
            verified: false,
            deviceId: '',
            deviceSessionHash: '',
            method: '',
            reason: '',
        };
    }

    const normalizedChallenge = extractTrustedDeviceChallengePayload(challengePayload);
    const hasFreshProof = Boolean(
        normalizedChallenge.token
        && (normalizedChallenge.proof || normalizedChallenge.credential)
    );

    if (!hasFreshProof) {
        if (requireFreshProof) {
            return {
                required: true,
                verified: false,
                deviceId: '',
                deviceSessionHash: '',
                method: '',
                reason: 'Fresh trusted device verification is required.',
            };
        }

        return {
            required: false,
            verified: true,
            deviceId,
            deviceSessionHash: sessionVerification.deviceSessionHash,
            method: '',
            reason: '',
        };
    }

    const challengeVerification = await verifyTrustedDeviceChallenge({
        user,
        token: normalizedChallenge.token,
        method: normalizedChallenge.method,
        proof: normalizedChallenge.proof,
        publicKeySpkiBase64: normalizedChallenge.publicKeySpkiBase64,
        credential: normalizedChallenge.credential,
        deviceId,
        deviceLabel,
        deviceSessionToken,
        expectedScope,
    });

    if (!challengeVerification.success) {
        return {
            required: true,
            verified: false,
            deviceId: '',
            deviceSessionHash: '',
            method: '',
            reason: `Fresh trusted device verification failed: ${challengeVerification.reason}`,
        };
    }

    return {
        required: true,
        verified: true,
        deviceId,
        deviceSessionHash: sessionVerification.deviceSessionHash,
        method: challengeVerification.method || '',
        reason: '',
    };
};

const verifyRsaPssSignature = ({ publicKeySpkiBase64 = '', signatureBase64 = '', message }) => {
    const publicKeyDer = Buffer.from(String(publicKeySpkiBase64 || ''), 'base64');
    const signature = Buffer.from(String(signatureBase64 || ''), 'base64');
    if (!publicKeyDer.length || !signature.length) return false;

    return crypto.verify(
        'sha256',
        message,
        {
            key: publicKeyDer,
            format: 'der',
            type: 'spki',
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32,
        },
        signature
    );
};

const getTrustedDeviceMethod = (device = {}) => {
    const normalizedMethod = normalizeChallengeMethod(device?.method);
    if (normalizedMethod === PASSKEY_METHOD && device?.webauthnCredentialIdBase64Url) {
        return PASSKEY_METHOD;
    }
    if (device?.webauthnCredentialIdBase64Url) {
        return PASSKEY_METHOD;
    }
    return BROWSER_KEY_METHOD;
};

const sanitizeTrustedDevice = (device = {}) => ({
    deviceId: normalizeDeviceId(device.deviceId),
    label: normalizeDeviceLabel(device.label),
    method: getTrustedDeviceMethod(device),
    algorithm: String(device.algorithm || 'RSA-PSS-SHA256'),
    authenticatorAttachment: String(device.authenticatorAttachment || ''),
    webauthnCredentialIdBase64Url: String(device.webauthnCredentialIdBase64Url || ''),
    webauthnTransports: normalizeTransports(device.webauthnTransports),
    webauthnCounter: Number(device.webauthnCounter || 0),
    webauthnUserVerification: String(device.webauthnUserVerification || ''),
    webauthnAaguid: String(device.webauthnAaguid || ''),
    createdAt: device.createdAt ? new Date(device.createdAt).toISOString() : null,
    lastSeenAt: device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : null,
    lastVerifiedAt: device.lastVerifiedAt ? new Date(device.lastVerifiedAt).toISOString() : null,
});

const getTrustedDeviceRegistration = (user = null, deviceId = '') => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!user || !normalizedDeviceId || !Array.isArray(user.trustedDevices)) {
        return null;
    }

    return user.trustedDevices.find((entry) => normalizeDeviceId(entry?.deviceId) === normalizedDeviceId) || null;
};

const isTrustedDeviceRegisteredForUser = (user = null, deviceId = '') => Boolean(
    getTrustedDeviceRegistration(user, deviceId)
);

const upsertTrustedDevice = async ({
    userId,
    deviceId,
    deviceLabel = '',
    method = BROWSER_KEY_METHOD,
    algorithm = 'RSA-PSS-SHA256',
    publicKeySpkiBase64 = '',
    replaceExistingKey = false,
    webauthnCredentialIdBase64Url = '',
    webauthnTransports = [],
    webauthnCounter = 0,
    webauthnUserVerification = '',
    webauthnAaguid = '',
    authenticatorAttachment = '',
}) => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedLabel = normalizeDeviceLabel(deviceLabel) || 'Trusted browser';
    const normalizedPublicKey = String(publicKeySpkiBase64 || '').trim();
    const normalizedMethod = normalizeChallengeMethod(method);
    const now = new Date();

    const user = await User.findById(userId, 'trustedDevices').lean();
    const currentDevices = Array.isArray(user?.trustedDevices) ? [...user.trustedDevices] : [];
    const existingIndex = currentDevices.findIndex((entry) => normalizeDeviceId(entry?.deviceId) === normalizedDeviceId);
    const existingDevice = existingIndex >= 0 ? currentDevices[existingIndex] : null;

    const nextRecord = {
        deviceId: normalizedDeviceId,
        label: normalizedLabel,
        method: normalizedMethod,
        algorithm,
        createdAt: existingDevice?.createdAt || now,
        lastSeenAt: now,
        lastVerifiedAt: now,
        publicKeySpkiBase64: replaceExistingKey || existingIndex < 0
            ? normalizedPublicKey
            : String(existingDevice?.publicKeySpkiBase64 || normalizedPublicKey),
        webauthnCredentialIdBase64Url: normalizedMethod === PASSKEY_METHOD
            ? String(webauthnCredentialIdBase64Url || existingDevice?.webauthnCredentialIdBase64Url || '')
            : '',
        webauthnTransports: normalizedMethod === PASSKEY_METHOD
            ? normalizeTransports(webauthnTransports.length ? webauthnTransports : existingDevice?.webauthnTransports)
            : [],
        webauthnCounter: normalizedMethod === PASSKEY_METHOD
            ? Number(webauthnCounter || existingDevice?.webauthnCounter || 0)
            : 0,
        webauthnUserVerification: normalizedMethod === PASSKEY_METHOD
            ? String(webauthnUserVerification || existingDevice?.webauthnUserVerification || 'required')
            : '',
        webauthnAaguid: normalizedMethod === PASSKEY_METHOD
            ? String(webauthnAaguid || existingDevice?.webauthnAaguid || '')
            : '',
        authenticatorAttachment: normalizedMethod === PASSKEY_METHOD
            ? String(authenticatorAttachment || existingDevice?.authenticatorAttachment || '')
            : '',
    };

    if (existingIndex >= 0) {
        currentDevices.splice(existingIndex, 1, nextRecord);
    } else {
        currentDevices.push(nextRecord);
    }

    currentDevices.sort((left, right) => (
        new Date(right?.lastVerifiedAt || 0).getTime() - new Date(left?.lastVerifiedAt || 0).getTime()
    ));

    const trimmedDevices = currentDevices.slice(0, MAX_TRUSTED_DEVICES);

    await User.updateOne(
        { _id: userId },
        { $set: { trustedDevices: trimmedDevices } }
    );

    return sanitizeTrustedDevice(nextRecord);
};

const issueTrustedDeviceChallenge = async ({
    user,
    authUid = '',
    authToken = null,
    deviceId = '',
    deviceLabel = '',
    req = {},
    allowEnrollment = true,
    expectedDeviceSessionHash = '',
    challengeScope = '',
}) => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!user?._id || !normalizedDeviceId) {
        throw new Error('Trusted device challenges require a stable device identifier');
    }

    const existingDevice = getTrustedDeviceRegistration(user, normalizedDeviceId);
    if (!allowEnrollment && !existingDevice) {
        throw new Error('Trusted device registration missing');
    }
    const challenge = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + DEVICE_CHALLENGE_TTL_MS;
    const mode = existingDevice ? 'assert' : 'enroll';
    const registeredMethod = existingDevice ? getTrustedDeviceMethod(existingDevice) : '';
    const webauthnContext = resolveWebAuthnRequestContext(req);
    const canOfferWebAuthnEnrollment = mode !== 'enroll' || webauthnContext.isEnrollmentEligible;
    const preferredMethod = mode === 'enroll'
        ? (
            trustedDeviceFlags.authTrustedDevicePreferWebAuthn && canOfferWebAuthnEnrollment
                ? PASSKEY_METHOD
                : BROWSER_KEY_METHOD
        )
        : registeredMethod || BROWSER_KEY_METHOD;
    const availableMethods = mode === 'enroll'
        ? (
            canOfferWebAuthnEnrollment
                ? (trustedDeviceFlags.authTrustedDevicePreferWebAuthn
                    ? [PASSKEY_METHOD, BROWSER_KEY_METHOD]
                    : [BROWSER_KEY_METHOD, PASSKEY_METHOD])
                : [BROWSER_KEY_METHOD]
        )
        : [preferredMethod];

    const token = sealToken({
        sub: String(user._id),
        challenge,
        mode,
        deviceId: normalizedDeviceId,
        deviceLabel: normalizeDeviceLabel(deviceLabel),
        preferredMethod,
        registeredMethod,
        webauthnContext,
        sessionBinding: buildSessionBinding({ authUid, authToken }),
        expectedDeviceSessionHash: String(expectedDeviceSessionHash || '').trim(),
        scope: normalizeChallengeScope(challengeScope),
        exp: expiresAt,
    });

    const webauthn = availableMethods.includes(PASSKEY_METHOD)
        ? (mode === 'enroll'
            ? {
                registrationOptions: buildRegistrationOptions({
                    challenge,
                    context: webauthnContext,
                    user,
                }),
            }
            : registeredMethod === PASSKEY_METHOD
                ? {
                    assertionOptions: buildAssertionOptions({
                        challenge,
                        context: webauthnContext,
                        credentialIdBase64Url: existingDevice?.webauthnCredentialIdBase64Url || '',
                        transports: existingDevice?.webauthnTransports || [],
                    }),
                }
                : null)
        : null;

    return {
        token,
        challenge,
        mode,
        algorithm: preferredMethod === PASSKEY_METHOD
            ? 'WEBAUTHN'
            : 'RSA-PSS-SHA256',
        deviceId: normalizedDeviceId,
        expiresAt: new Date(expiresAt).toISOString(),
        registered: Boolean(existingDevice),
        registeredLabel: existingDevice ? normalizeDeviceLabel(existingDevice.label) : '',
        preferredMethod,
        availableMethods,
        registeredMethod,
        webauthn,
    };
};

const verifyTrustedDeviceChallenge = async ({
    user,
    authUid = '',
    authToken = null,
    token = '',
    method = '',
    proof = '',
    deviceId = '',
    deviceLabel = '',
    publicKeySpkiBase64 = '',
    credential = null,
    deviceSessionToken = '',
    expectedScope = '',
}) => {
    let payload;
    try {
        ({ payload } = openToken(token));
    } catch {
        return { success: false, reason: 'Trusted device challenge token invalid' };
    }

    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!payload?.sub || String(payload.sub) !== String(user?._id || '')) {
        return { success: false, reason: 'Device challenge subject mismatch' };
    }
    if (!normalizedDeviceId || payload.deviceId !== normalizedDeviceId) {
        return { success: false, reason: 'Device challenge device mismatch' };
    }
    if (!payload.challenge || Date.now() > Number(payload.exp || 0)) {
        return { success: false, reason: 'Device challenge expired' };
    }
    if (!sessionBindingMatches(payload.sessionBinding, { authUid, authToken })) {
        return { success: false, reason: 'Device challenge session binding mismatch' };
    }
    const expectedDeviceSessionHash = String(payload?.expectedDeviceSessionHash || '').trim();
    if (expectedDeviceSessionHash && expectedDeviceSessionHash !== hashTrustedDeviceSessionToken(deviceSessionToken)) {
        return { success: false, reason: 'Device challenge trusted session mismatch' };
    }
    const challengeScope = normalizeChallengeScope(payload?.scope || '');
    const requestedScope = normalizeChallengeScope(expectedScope);
    if (challengeScope && challengeScope !== requestedScope) {
        return { success: false, reason: 'Device challenge scope mismatch' };
    }

    const requestedMethod = normalizeChallengeMethod(
        method
        || (credential ? PASSKEY_METHOD : '')
        || (proof ? BROWSER_KEY_METHOD : '')
        || payload.registeredMethod
        || payload.preferredMethod
        || BROWSER_KEY_METHOD
    );

    const message = buildChallengeMessage({
        challenge: payload.challenge,
        mode: payload.mode,
        deviceId: normalizedDeviceId,
    });

    if (requestedMethod === PASSKEY_METHOD) {
        try {
            if (!payload.webauthnContext) {
                return { success: false, reason: 'Trusted device challenge is missing WebAuthn context' };
            }

            if (payload.mode === 'assert') {
                const registeredDevice = getTrustedDeviceRegistration(user, normalizedDeviceId);
                if (!registeredDevice?.publicKeySpkiBase64 || getTrustedDeviceMethod(registeredDevice) !== PASSKEY_METHOD) {
                    return { success: false, reason: 'Trusted passkey registration missing' };
                }

                const assertion = verifyWebAuthnAssertion({
                    credential,
                    expectedChallenge: payload.challenge,
                    expectedOrigin: payload.webauthnContext.origin,
                    expectedRpId: payload.webauthnContext.rpId,
                    userVerification: payload.webauthnContext.userVerification,
                    storedPublicKeySpkiBase64: registeredDevice.publicKeySpkiBase64,
                    storedCredentialIdBase64Url: registeredDevice.webauthnCredentialIdBase64Url,
                    storedCounter: registeredDevice.webauthnCounter,
                });

                const trustedDevice = await upsertTrustedDevice({
                    userId: user._id,
                    deviceId: normalizedDeviceId,
                    deviceLabel: deviceLabel || registeredDevice.label || payload.deviceLabel || '',
                    method: PASSKEY_METHOD,
                    algorithm: String(registeredDevice.algorithm || 'WEBAUTHN'),
                    publicKeySpkiBase64: registeredDevice.publicKeySpkiBase64,
                    replaceExistingKey: false,
                    webauthnCredentialIdBase64Url: registeredDevice.webauthnCredentialIdBase64Url,
                    webauthnTransports: registeredDevice.webauthnTransports || [],
                    webauthnCounter: assertion.counter,
                    webauthnUserVerification: assertion.userVerification,
                    webauthnAaguid: registeredDevice.webauthnAaguid || '',
                    authenticatorAttachment: registeredDevice.authenticatorAttachment || '',
                });

                return {
                    success: true,
                    mode: 'assert',
                    method: PASSKEY_METHOD,
                    trustedDevice,
                    ...issueTrustedDeviceSession({
                        user,
                        authUid,
                        authToken,
                        deviceId: normalizedDeviceId,
                    }),
                };
            }

            const registration = verifyWebAuthnRegistration({
                credential,
                expectedChallenge: payload.challenge,
                expectedOrigin: payload.webauthnContext.origin,
                expectedRpId: payload.webauthnContext.rpId,
                userVerification: payload.webauthnContext.userVerification,
            });

            const trustedDevice = await upsertTrustedDevice({
                userId: user._id,
                deviceId: normalizedDeviceId,
                deviceLabel: deviceLabel || payload.deviceLabel || 'Trusted passkey device',
                method: PASSKEY_METHOD,
                algorithm: registration.algorithm,
                publicKeySpkiBase64: registration.publicKeySpkiBase64,
                replaceExistingKey: true,
                webauthnCredentialIdBase64Url: registration.credentialIdBase64Url,
                webauthnTransports: registration.transports,
                webauthnCounter: registration.counter,
                webauthnUserVerification: registration.userVerification,
                webauthnAaguid: registration.aaguid,
                authenticatorAttachment: registration.authenticatorAttachment,
            });

            return {
                success: true,
                mode: 'enroll',
                method: PASSKEY_METHOD,
                trustedDevice,
                ...issueTrustedDeviceSession({
                    user,
                    authUid,
                    authToken,
                    deviceId: normalizedDeviceId,
                }),
            };
        } catch (error) {
            return { success: false, reason: error.message || 'Trusted device WebAuthn verification failed' };
        }
    }

    if (payload.mode === 'assert' && payload.registeredMethod === PASSKEY_METHOD) {
        return { success: false, reason: 'Trusted device requires passkey verification for this browser' };
    }

    if (payload.mode === 'assert') {
        const registeredDevice = getTrustedDeviceRegistration(user, normalizedDeviceId);
        if (!registeredDevice?.publicKeySpkiBase64) {
            return { success: false, reason: 'Trusted device registration missing' };
        }

        const valid = verifyRsaPssSignature({
            publicKeySpkiBase64: registeredDevice.publicKeySpkiBase64,
            signatureBase64: proof,
            message,
        });

        if (!valid) {
            return { success: false, reason: 'Trusted device signature invalid' };
        }

        const trustedDevice = await upsertTrustedDevice({
            userId: user._id,
            deviceId: normalizedDeviceId,
            deviceLabel: deviceLabel || registeredDevice.label || payload.deviceLabel || '',
            method: BROWSER_KEY_METHOD,
            algorithm: 'RSA-PSS-SHA256',
            publicKeySpkiBase64: registeredDevice.publicKeySpkiBase64,
            replaceExistingKey: false,
        });

        return {
            success: true,
            mode: 'assert',
            method: BROWSER_KEY_METHOD,
            trustedDevice,
            ...issueTrustedDeviceSession({
                user,
                authUid,
                authToken,
                deviceId: normalizedDeviceId,
            }),
        };
    }

    const normalizedPublicKey = String(publicKeySpkiBase64 || '').trim();
    if (!normalizedPublicKey) {
        return { success: false, reason: 'Trusted device public key missing for enrollment' };
    }

    const enrollmentValid = verifyRsaPssSignature({
        publicKeySpkiBase64: normalizedPublicKey,
        signatureBase64: proof,
        message,
    });

    if (!enrollmentValid) {
        return { success: false, reason: 'Trusted device enrollment signature invalid' };
    }

    const trustedDevice = await upsertTrustedDevice({
        userId: user._id,
        deviceId: normalizedDeviceId,
        deviceLabel: deviceLabel || payload.deviceLabel || 'Trusted browser',
        method: BROWSER_KEY_METHOD,
        algorithm: 'RSA-PSS-SHA256',
        publicKeySpkiBase64: normalizedPublicKey,
        replaceExistingKey: true,
    });

    return {
        success: true,
        mode: 'enroll',
        method: BROWSER_KEY_METHOD,
        trustedDevice,
        ...issueTrustedDeviceSession({
            user,
            authUid,
            authToken,
            deviceId: normalizedDeviceId,
        }),
    };
};

module.exports = {
    TRUSTED_DEVICE_ID_HEADER,
    TRUSTED_DEVICE_LABEL_HEADER,
    TRUSTED_DEVICE_SESSION_HEADER,
    extractTrustedDeviceContext,
    extractTrustedDeviceChallengePayload,
    getTrustedDeviceSessionToken,
    getTrustedDeviceRegistration,
    isTrustedDeviceRegisteredForUser,
    hashTrustedDeviceSessionToken,
    issueTrustedDeviceChallenge,
    issueTrustedDeviceBootstrapChallenge,
    issueTrustedDeviceSession,
    resolveTrustedDeviceBootstrapSignal,
    verifyTrustedDeviceSession,
    verifyTrustedDeviceBootstrapSession,
    normalizeDeviceId,
    verifyTrustedDeviceChallenge,
};
