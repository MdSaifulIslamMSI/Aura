const crypto = require('crypto');
const {
    TRUSTED_DEVICE_SESSION_HEADER,
    verifyTrustedDeviceSession,
} = require('./trustedDeviceChallengeService');

const normalizeText = (value = '') => String(value || '').trim();
const hashValue = (value = '') => (
    normalizeText(value)
        ? crypto.createHash('sha256').update(normalizeText(value)).digest('hex')
        : ''
);

const getRequestDeviceId = (request = {}) => normalizeText(
    request.headers?.['x-aura-device-id']
    || request.get?.('X-Aura-Device-Id')
    || request.body?.deviceId
);

const getRequestDeviceSession = (request = {}) => normalizeText(
    request.headers?.[TRUSTED_DEVICE_SESSION_HEADER]
    || request.get?.('X-Aura-Device-Session')
);

const registerDeviceBinding = async ({
    userId,
    sessionId,
    credentialId = '',
    publicKeyThumbprint = '',
    userAgentHash = '',
} = {}) => ({
    userId: normalizeText(userId),
    sessionIdHash: hashValue(sessionId),
    credentialIdHash: hashValue(credentialId),
    publicKeyThumbprintHash: hashValue(publicKeyThumbprint),
    userAgentHash: userAgentHash || '',
    registeredAt: new Date().toISOString(),
});

const verifyDeviceBinding = ({
    user,
    userId,
    sessionId,
    proof = {},
    request = {},
    authUid = '',
    authToken = null,
} = {}) => {
    const deviceId = normalizeText(proof.deviceId || getRequestDeviceId(request));
    const deviceSessionToken = normalizeText(proof.deviceSessionToken || getRequestDeviceSession(request));

    if (!deviceId) return { success: false, reason: 'device_id_missing' };
    if (proof.sessionId && normalizeText(proof.sessionId) !== normalizeText(sessionId)) {
        return { success: false, reason: 'device_session_mismatch' };
    }
    if (!deviceSessionToken) {
        return { success: false, reason: 'device_session_missing' };
    }

    const session = verifyTrustedDeviceSession({
        user: user || { _id: userId },
        authUid,
        authToken,
        deviceId,
        deviceSessionToken,
    });
    if (!session.success) {
        return { success: false, reason: session.reason || 'device_session_invalid' };
    }

    return { success: true, deviceId };
};

const revokeDeviceBinding = async ({ userId, deviceId } = {}) => ({
    userId: normalizeText(userId),
    deviceId: normalizeText(deviceId),
    revokedAt: new Date().toISOString(),
});

module.exports = {
    getRequestDeviceId,
    registerDeviceBinding,
    revokeDeviceBinding,
    verifyDeviceBinding,
};
