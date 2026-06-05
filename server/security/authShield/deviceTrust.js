const {
    TRUSTED_DEVICE_SESSION_HEADER,
    extractTrustedDeviceContext,
    verifyTrustedDeviceSession,
} = require('../../services/trustedDeviceChallengeService');

const verifyDeviceTrust = ({ req = {}, requireDeviceProof = false, config = {} } = {}) => {
    const { deviceId } = extractTrustedDeviceContext(req);
    const deviceSessionToken = String(
        req.get?.(TRUSTED_DEVICE_SESSION_HEADER)
        || req.headers?.[TRUSTED_DEVICE_SESSION_HEADER]
        || ''
    ).trim();

    if (!requireDeviceProof) {
        return { ok: true, trusted: Boolean(deviceId), reasons: [] };
    }

    if (!config.deviceTrustEnabled) {
        return {
            ok: true,
            trusted: false,
            shadow: true,
            reasons: [deviceId ? 'device_trust_disabled' : 'device_trust_disabled_missing_device'],
        };
    }

    if (!deviceId || !deviceSessionToken) {
        return { ok: false, trusted: false, reasons: ['device_proof_missing'] };
    }

    const cached = req._trustedDeviceSessionVerification;
    const verification = cached || verifyTrustedDeviceSession({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceId,
        deviceSessionToken,
    });
    req._trustedDeviceSessionVerification = verification;

    if (!verification.success) {
        return {
            ok: false,
            trusted: false,
            reasons: [verification.reason || 'device_proof_invalid'],
        };
    }

    return {
        ok: true,
        trusted: true,
        method: verification.method || '',
        reasons: [],
    };
};

module.exports = {
    verifyDeviceTrust,
};
