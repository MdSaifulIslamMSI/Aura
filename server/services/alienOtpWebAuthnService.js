const User = require('../models/User');
const { getChallenge } = require('./alienOtpChallengeService');
const {
    buildAssertionOptions,
    normalizeTransports,
    resolveWebAuthnRequestContext,
    verifyWebAuthnAssertion,
} = require('./webauthnTrustedDeviceService');

const normalizeText = (value = '') => String(value || '').trim();

const normalizeCredential = (assertionResponse = {}) => (
    assertionResponse?.credential && typeof assertionResponse.credential === 'object'
        ? assertionResponse.credential
        : assertionResponse
);

const loadUserById = async (userId) => User.findById(userId).lean();

const getPasskeyDevices = (user = {}) => (
    Array.isArray(user?.trustedDevices)
        ? user.trustedDevices.filter((device) => (
            normalizeText(device?.webauthnCredentialIdBase64Url)
            && normalizeText(device?.publicKeySpkiBase64)
        ))
        : []
);

const findPasskeyDevice = ({ user = {}, credential = {}, deviceId = '' } = {}) => {
    const rawCredentialId = normalizeText(credential?.rawIdBase64Url || credential?.id);
    const normalizedDeviceId = normalizeText(deviceId);
    const devices = getPasskeyDevices(user);

    return devices.find((device) => (
        rawCredentialId
        && normalizeText(device.webauthnCredentialIdBase64Url) === rawCredentialId
    )) || devices.find((device) => (
        normalizedDeviceId
        && normalizeText(device.deviceId) === normalizedDeviceId
    )) || null;
};

const generateAlienAssertionOptions = async ({
    userId,
    challengeId,
    req = {},
    user = null,
    loadUser = loadUserById,
} = {}) => {
    const challenge = await getChallenge(challengeId);
    if (!challenge || String(challenge.userId) !== String(userId || '')) {
        return null;
    }

    const resolvedUser = user || await loadUser(userId);
    const device = findPasskeyDevice({
        user: resolvedUser,
        deviceId: challenge.deviceId,
    }) || getPasskeyDevices(resolvedUser)[0];
    if (!device) return null;

    const context = resolveWebAuthnRequestContext(req);
    return buildAssertionOptions({
        challenge: challenge.nonce,
        context,
        credentialIdBase64Url: device.webauthnCredentialIdBase64Url,
        transports: normalizeTransports(device.webauthnTransports),
    });
};

const verifyAlienAssertion = async ({
    userId,
    challengeId,
    assertionResponse,
    expectedOrigin = '',
    expectedRpId = '',
    req = {},
    user = null,
    loadUser = loadUserById,
    verifyAssertion = verifyWebAuthnAssertion,
} = {}) => {
    const challenge = await getChallenge(challengeId);
    const credential = normalizeCredential(assertionResponse);
    const resolvedUser = user || await loadUser(userId);
    const device = findPasskeyDevice({
        user: resolvedUser,
        credential,
        deviceId: assertionResponse?.deviceId || challenge?.deviceId,
    });

    if (!challenge) return { success: false, reason: 'challenge_missing' };
    if (String(challenge.userId) !== String(userId || '')) return { success: false, reason: 'wrong_user' };
    if (!credential?.response) return { success: false, reason: 'webauthn_assertion_missing' };
    if (!device) return { success: false, reason: 'unknown_passkey_credential' };

    try {
        const context = (expectedOrigin && expectedRpId)
            ? { origin: expectedOrigin, rpId: expectedRpId, userVerification: 'required' }
            : resolveWebAuthnRequestContext(req);
        const result = verifyAssertion({
            credential,
            expectedChallenge: challenge.nonce,
            expectedOrigin: expectedOrigin || context.origin,
            expectedRpId: expectedRpId || context.rpId,
            userVerification: context.userVerification || 'required',
            storedPublicKeySpkiBase64: device.publicKeySpkiBase64,
            storedCredentialIdBase64Url: device.webauthnCredentialIdBase64Url,
            storedCounter: Number(device.webauthnCounter || 0),
        });
        return {
            success: true,
            method: 'webauthn',
            deviceId: normalizeText(device.deviceId),
            credentialId: normalizeText(device.webauthnCredentialIdBase64Url),
            counter: result.counter,
        };
    } catch (error) {
        return { success: false, reason: error.message || 'webauthn_assertion_failed' };
    }
};

module.exports = {
    findPasskeyDevice,
    generateAlienAssertionOptions,
    verifyAlienAssertion,
};
