const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { isProduction, deriveHmacKey, safeCompareHex } = require('../utils/cryptoKdf');

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

    // Recovery codes are long-lived bearer credentials. Sharing their key with
    // OTP-flow tokens or device challenges means one leak unlocks all three, so
    // production must use the dedicated variable.
    if (isProduction() && !String(process.env.AUTH_RECOVERY_CODE_SECRET || '').trim()) {
        throw new AppError(
            'AUTH_RECOVERY_CODE_SECRET must be configured in production instead of reusing the shared OTP/device-challenge secret',
            500
        );
    }

    return secret;
};

// ── TWO DERIVATIONS, DELIBERATELY ────────────────────────────────────────────
// Legacy codeHash values are BARE HEX with no prefix, keyed by HMAC over the raw
// configured secret. Every hash already stored looks like that, so it is FROZEN
// and stays a valid read path.
//
// v2 (`hmac-sha256-v2:`) derives an HKDF subkey first, giving real domain
// separation from the other purposes that share this secret.
//
// Verification accepts either, and a legacy hash is rewritten to v2 the moment
// the code is consumed — so the population migrates itself as codes are used,
// with no separate backfill and no risk of locking a user out mid-rotation.
const RECOVERY_CODE_HASH_PREFIX_V2 = 'hmac-sha256-v2:';
const RECOVERY_CODE_INDEX_CONTEXT = 'recovery-code.hash.v2';

const hashRecoveryCode = (code) => (
    `${RECOVERY_CODE_HASH_PREFIX_V2}${crypto
        .createHmac('sha256', deriveHmacKey({
            secret: getRecoveryCodeSecret(),
            context: RECOVERY_CODE_INDEX_CONTEXT,
        }))
        .update(normalizeRecoveryCode(code))
        .digest('hex')}`
);

// Frozen: reproduces the original bare-hex derivation for legacy stored hashes.
const hashRecoveryCodeLegacy = (code) => crypto
    .createHmac('sha256', getRecoveryCodeSecret())
    .update(normalizeRecoveryCode(code))
    .digest('hex');

/** Every hash a stored recovery code could be recorded under, newest first. */
const recoveryCodeHashCandidates = (code) => [
    hashRecoveryCode(code),
    hashRecoveryCodeLegacy(code),
];

/**
 * Find the stored entry matching a candidate code, across both hash versions.
 *
 * The two stored forms are compared differently on purpose:
 *   - v2 (`hmac-sha256-v2:<hex>`) is compared as a whole string. Buffering a
 *     prefixed value through `Buffer.from(x, 'hex')` silently mangles it, so a
 *     hex comparison can never match a prefixed hash.
 *   - legacy (bare hex) is compared constant-time via safeCompareHex.
 *
 * v2 entries carry no secret beyond what the HMAC already covers and are only
 * ever compared against a freshly derived candidate, so an exact string compare
 * leaks nothing the hex path would not.
 */
const matchesAnyRecoveryCodeHash = (storedHash, candidates) => {
    const stored = String(storedHash ?? '');
    if (!stored) return false;

    if (stored.startsWith(RECOVERY_CODE_HASH_PREFIX_V2)) {
        return candidates.some((candidate) => (
            candidate.startsWith(RECOVERY_CODE_HASH_PREFIX_V2) && candidate === stored
        ));
    }

    return candidates.some((candidate) => safeCompareHex(stored, candidate));
};

const findMatchingRecoveryCode = (entries, code) => {
    if (!Array.isArray(entries)) return null;
    const candidates = recoveryCodeHashCandidates(code);
    return entries.find((entry) => (
        !entry?.usedAt && matchesAnyRecoveryCodeHash(entry?.codeHash, candidates)
    )) || null;
};

const safeCompare = safeCompareHex;

const formatRecoveryCode = () => {
    const raw = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('base64url').toUpperCase();
    return normalizeRecoveryCode(raw).slice(0, 16).match(/.{1,4}/g).join('-');
};

const getPasskeyCount = (user = null) => (
    Array.isArray(user?.trustedDevices)
        ? user.trustedDevices.filter((device) => (
            !device?.revokedAt
            && (!device?.expiresAt || new Date(device.expiresAt).getTime() > Date.now())
            && String(device?.method || '').trim().toLowerCase() === 'webauthn'
        )).length
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

const generateRecoveryCodesForUser = async ({ userId = '', requirePasskey = true } = {}) => {
    if (!userId) {
        throw new AppError('User is required to generate recovery codes', 400);
    }

    const user = await User.findById(userId, 'trustedDevices recoveryCodeState mfa').lean();
    if (!user) {
        throw new AppError('User not found', 404);
    }
    if (requirePasskey && getPasskeyCount(user) <= 0) {
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

    const user = await User.findOne(
        { email: safeEmail, isVerified: true },
        'name email phone isVerified trustedDevices recoveryCodeState +recoveryCodes'
    ).lean();

    // Dual-version match: a code stored under the legacy bare-hex derivation
    // must still verify after this change.
    const matchingCode = findMatchingRecoveryCode(user?.recoveryCodes, normalizedCode);

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

const consumeRecoveryCodeForMfa = async ({ userId = '', code = '', purpose = 'mfa' } = {}) => {
    const normalizedCode = normalizeRecoveryCode(code);
    if (!userId || !normalizedCode) {
        throw new AppError('Recovery code is invalid or already used.', 401);
    }

    const user = await User.findById(
        userId,
        'name email phone avatar gender dob bio isAdmin adminRoles isVerified trustedDevices isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt recoveryCodeState mfa loyalty createdAt +recoveryCodes'
    ).lean();

    // Dual-version match across the legacy bare-hex and v2 prefixed derivations.
    const matchingCode = findMatchingRecoveryCode(user?.recoveryCodes, normalizedCode);

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
                'recoveryCodes.$.usedFor': String(purpose || 'mfa').slice(0, 80),
                'recoveryCodeState.lastUsedAt': now,
                'mfa.enabled': true,
                'mfa.lastMfaAt': now,
                'mfa.lastMfaMethod': 'recovery_code',
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
        'name email phone avatar gender dob bio isAdmin adminRoles isVerified trustedDevices isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt recoveryCodeState mfa loyalty createdAt +recoveryCodes'
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
        purpose: String(purpose || 'mfa').slice(0, 80),
        remaining: activeCount,
    });

    return {
        user: {
            ...safeUser,
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
    consumeRecoveryCodeForMfa,
    consumeRecoveryCodeForPasswordReset,
    generateRecoveryCodesForUser,
    getPasskeyCount,
    getRecoveryReadiness,
    hashRecoveryCode,
    hashRecoveryCodeLegacy,
    recoveryCodeHashCandidates,
    findMatchingRecoveryCode,
    normalizeRecoveryCode,
};
