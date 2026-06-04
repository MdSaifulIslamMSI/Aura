const {
    consumeRecoveryCodeForMfa,
    generateRecoveryCodesForUser,
    hashRecoveryCode,
    normalizeRecoveryCode,
} = require('./authRecoveryCodeService');

const generateRecoveryCodes = ({ userId, requirePasskey = false } = {}) => (
    generateRecoveryCodesForUser({ userId, requirePasskey })
);

const hashRecoveryCodes = (codes = []) => (
    Array.isArray(codes)
        ? codes.map((code) => hashRecoveryCode(code))
        : []
);

const verifyAndConsumeRecoveryCode = ({ userId, code, purpose = 'mfa' } = {}) => (
    consumeRecoveryCodeForMfa({ userId, code, purpose })
);

module.exports = {
    generateRecoveryCodes,
    hashRecoveryCodes,
    normalizeRecoveryCode,
    verifyAndConsumeRecoveryCode,
};
