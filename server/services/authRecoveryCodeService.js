const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const parseRecoveryCodeCount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 5) : 10;
};

const RECOVERY_CODE_COUNT = parseRecoveryCodeCount(process.env.AUTH_RECOVERY_CODE_COUNT || 10);
const RECOVERY_CODE_BYTES = 12;
const RECOVERY_CODE_PURPOSE_FORGOT_PASSWORD = 'forgot-password';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const normalizeRecoveryCode = (value) => String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const getRecoveryCodeSecret = () => {
    const secret = String(
        process.env.AUTH_RECOVERY_CODE_SECRET
        || process.env.OTP_FLOW_SECRET
        || process.env.AUTH_DEVICE_CHALLENGE_SECRET
        || ''
    ).trim();

    if (!secret) {
        throw new AppError('Recovery code secret is not configured', 500);
    }

    return secret;
};

const hashRecoveryCode = (code) => crypto
    .createHmac('sha256', getRecoveryCodeSecret())
    .update(normalizeRecoveryCode(code))
    .digest('hex');

const safeCompare = (left = '', right = '') => {
    const leftBuffer = Buffer.from(String(left || ''), 'hex');
    const rightBuffer = Buffer.from(String(right || ''), 'hex');
    return leftBuffer.length > 0
        && leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const formatRecoveryCode = () => {
    const raw = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('base64url').toUpperCase();
    return normalizeRecoveryCode(raw).slice(0, 16).match(/.{1,4}/g).join('-');
};

const getPasskeyCount = (user = null) => (
    Array.isArray(user?.trustedDevices)
        ? user.trustedDevices.filter((device) => String(device?.method || '').trim().toLowerCase() === 'webauthn').length
        : 0
);

const getRecoveryCodeState = (user = null) => ({
    generatedAt: user?.recoveryCodeState?.generatedAt || null,
    lastUsedAt: user?.recoveryCodeState?.lastUsedAt || null,
    activeCount: Math.max(Number(user?.recoveryCodeState?.activeCount || 0), 0),
});

const getRecoveryReadiness = (user = null) => {
    const passkeyCount = getPasskeyCount(user);
    const recoveryCodeState = getRecoveryCodeState(user);
    return {
        hasPasskey: passkeyCount > 0,
        passkeyCount,
        recoveryCodesActiveCount: recoveryCodeState.activeCount,
        recoveryCodesGeneratedAt: recoveryCodeState.generatedAt,
        recoveryCodesLastUsedAt: recoveryCodeState.lastUsedAt,
        passkeyRecoveryReady: passkeyCount === 0 || recoveryCodeState.activeCount > 0,
        shouldEnrollRecoveryCodes: passkeyCount > 0 && recoveryCodeState.activeCount <= 0,
    };
};

const generateRecoveryCodesForUser = async ({ userId = '' } = {}) => {
    if (!userId) {
        throw new AppError('User is required to generate recovery codes', 400);
    }

    const user = await User.findById(userId, 'trustedDevices recoveryCodeState').lean();
    if (!user) {
        throw new AppError('User not found', 404);
    }
    if (getPasskeyCount(user) <= 0) {
        throw new AppError('Register a passkey before creating backup recovery codes.', 409);
    }

    const now = new Date();
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, formatRecoveryCode);
    const records = codes.map((code) => ({
        codeHash: hashRecoveryCode(code),
        createdAt: now,
        usedAt: null,
        usedFor: '',
    }));

    const updated = await User.findByIdAndUpdate(
        userId,
        {
            $set: {
                recoveryCodes: records,
                recoveryCodeState: {
                    generatedAt: now,
                    lastUsedAt: null,
                    activeCount: records.length,
                },
            },
        },
        {
            returnDocument: 'after',
            projection: 'trustedDevices recoveryCodeState',
            lean: true,
        }
    );

    logger.info('auth.recovery_codes_generated', {
        userId: String(userId),
        count: records.length,
    });

    return {
        codes,
        recoveryCodeState: getRecoveryCodeState(updated),
        readiness: getRecoveryReadiness(updated),
    };
};

const consumeRecoveryCodeForPasswordReset = async ({ email = '', code = '' } = {}) => {
    const safeEmail = normalizeEmail(email);
    const normalizedCode = normalizeRecoveryCode(code);
    if (!safeEmail || !normalizedCode) {
        throw new AppError('Recovery code is invalid or already used.', 401);
    }

    const candidateHash = hashRecoveryCode(normalizedCode);
    const user = await User.findOne(
        { email: safeEmail, isVerified: true },
        'name email phone isVerified trustedDevices recoveryCodeState +recoveryCodes'
    ).lean();

    const matchingCode = Array.isArray(user?.recoveryCodes)
        ? user.recoveryCodes.find((entry) => (
            !entry?.usedAt && safeCompare(entry?.codeHash, candidateHash)
        ))
        : null;

    if (!user || !matchingCode) {
        throw new AppError('Recovery code is invalid or already used.', 401);
    }

    const now = new Date();
    const result = await User.updateOne(
        {
            _id: user._id,
            recoveryCodes: {
                $elemMatch: {
                    codeHash: matchingCode.codeHash,
                    usedAt: null,
                },
            },
        },
        {
            $set: {
                'recoveryCodes.$.usedAt': now,
                'recoveryCodes.$.usedFor': RECOVERY_CODE_PURPOSE_FORGOT_PASSWORD,
                'recoveryCodeState.lastUsedAt': now,
                resetOtpVerifiedAt: now,
            },
            $inc: {
                'recoveryCodeState.activeCount': -1,
            },
        }
    );

    if (!result?.modifiedCount) {
        throw new AppError('Recovery code is invalid or already used.', 401);
    }

    const refreshedUser = await User.findById(
        user._id,
        'name email phone isVerified trustedDevices recoveryCodeState +resetOtpVerifiedAt +recoveryCodes'
    ).lean();
    const activeCount = Array.isArray(refreshedUser?.recoveryCodes)
        ? refreshedUser.recoveryCodes.filter((entry) => !entry?.usedAt).length
        : Math.max(Number(refreshedUser?.recoveryCodeState?.activeCount || 0), 0);
    if (activeCount !== Number(refreshedUser?.recoveryCodeState?.activeCount || 0)) {
        await User.updateOne(
            { _id: user._id },
            { $set: { 'recoveryCodeState.activeCount': activeCount } }
        );
    }
    const { recoveryCodes: _recoveryCodes, ...safeUser } = refreshedUser || user;

    logger.warn('auth.recovery_code_consumed', {
        userId: String(user._id),
        purpose: RECOVERY_CODE_PURPOSE_FORGOT_PASSWORD,
        remaining: activeCount,
    });

    return {
        user: {
            ...safeUser,
            resetOtpVerifiedAt: now,
            recoveryCodeState: {
                ...(safeUser.recoveryCodeState || {}),
                lastUsedAt: now,
                activeCount,
            },
        },
        recoveryCodeState: {
            ...(safeUser.recoveryCodeState || {}),
            lastUsedAt: now,
            activeCount,
        },
    };
};

module.exports = {
    RECOVERY_CODE_PURPOSE_FORGOT_PASSWORD,
    consumeRecoveryCodeForPasswordReset,
    generateRecoveryCodesForUser,
    getPasskeyCount,
    getRecoveryReadiness,
    hashRecoveryCode,
    normalizeRecoveryCode,
};
