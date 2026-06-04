const crypto = require('crypto');
const qrcode = require('qrcode');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { getMfaEncryptionKey, resolveMfaConfig } = require('../config/mfaConfig');
const { generateRecoveryCodesForUser } = require('./authRecoveryCodeService');

const TOTP_ISSUER = 'Aura';
const TOTP_ENCRYPTION_VERSION = 'v1';
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const TOTP_ALGORITHM = 'SHA256';
const TOTP_HMAC_ALGORITHM = 'sha256';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const normalizeCode = (value = '') => String(value || '').replace(/\s+/g, '').trim();
const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const base32Encode = (buffer) => {
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
};

const base32Decode = (secret = '') => {
    const normalized = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const output = [];

    for (const char of normalized) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index < 0) continue;
        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(output);
};

const generateTotpCode = ({ secret = '', timestamp = Date.now() } = {}) => {
    const key = base32Decode(secret);
    const counter = Math.floor(Number(timestamp || Date.now()) / 1000 / TOTP_PERIOD_SECONDS);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuffer.writeUInt32BE(counter >>> 0, 4);
    const digest = crypto.createHmac(TOTP_HMAC_ALGORITHM, key).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (
        ((digest[offset] & 0x7f) << 24)
        | ((digest[offset + 1] & 0xff) << 16)
        | ((digest[offset + 2] & 0xff) << 8)
        | (digest[offset + 3] & 0xff)
    );
    return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
};

const encryptTotpSecret = (secret, env = process.env) => {
    const key = getMfaEncryptionKey(env);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const ciphertext = Buffer.concat([
        cipher.update(String(secret || ''), 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
        TOTP_ENCRYPTION_VERSION,
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
};

const decryptTotpSecret = (encrypted, env = process.env) => {
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = String(encrypted || '').split('.');
    if (version !== TOTP_ENCRYPTION_VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
        throw new AppError('TOTP secret is not readable', 500);
    }
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getMfaEncryptionKey(env),
        Buffer.from(ivEncoded, 'base64url'),
        { authTagLength: 16 }
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
};

const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

const createOtpAuthUri = ({ secret, accountName = '' } = {}) => {
    const safeAccount = normalizeEmail(accountName) || 'user';
    const label = encodeURIComponent(`Aura:${safeAccount}`);
    const params = new URLSearchParams({
        secret,
        issuer: TOTP_ISSUER,
        algorithm: TOTP_ALGORITHM,
        digits: String(TOTP_DIGITS),
        period: String(TOTP_PERIOD_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
};

const createQrCodeDataUrl = async (uri) => qrcode.toDataURL(String(uri || ''), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256,
});

const assertTotpEnabled = (env = process.env) => {
    const config = resolveMfaConfig(env);
    if (!config.enabled || !config.totpEnabled) {
        throw new AppError('Authenticator app MFA is not enabled.', 403);
    }
};

const buildTotpSetupPayload = async ({ user, secret }) => {
    const otpauthUri = createOtpAuthUri({
        secret,
        accountName: user?.email,
    });
    return {
        issuer: TOTP_ISSUER,
        accountName: normalizeEmail(user?.email),
        manualKey: secret,
        otpauthUri,
        qrCodeDataUrl: await createQrCodeDataUrl(otpauthUri),
    };
};

const beginTotpSetup = async ({ userId } = {}) => {
    assertTotpEnabled();
    if (!userId) throw new AppError('User is required for TOTP setup.', 400);

    const user = await User.findById(userId, 'email mfa').lean();
    if (!user?._id) throw new AppError('User not found.', 404);

    const secret = generateTotpSecret(user);
    await User.updateOne(
        { _id: user._id },
        {
            $set: {
                'mfa.totp.pendingSecretEncrypted': encryptTotpSecret(secret),
                'mfa.totp.pendingCreatedAt': new Date(),
            },
        }
    );

    return buildTotpSetupPayload({ user, secret });
};

const getPendingTotpSetup = async ({ userId } = {}) => {
    assertTotpEnabled();
    const user = await User.findById(userId).select('+mfa.totp.pendingSecretEncrypted').lean();
    if (!user?._id) throw new AppError('User not found.', 404);
    if (!user?.mfa?.totp?.pendingSecretEncrypted) {
        throw new AppError('No pending authenticator app setup exists.', 404);
    }
    const secret = decryptTotpSecret(user.mfa.totp.pendingSecretEncrypted);
    return buildTotpSetupPayload({ user, secret });
};

const verifyTotpSecret = ({ secret = '', code = '' } = {}) => (
    Boolean(secret && normalizeCode(code))
    && Array.from({ length: (TOTP_WINDOW * 2) + 1 }, (_, index) => index - TOTP_WINDOW)
        .some((offset) => {
            const expected = generateTotpCode({
                secret,
                timestamp: Date.now() + (offset * TOTP_PERIOD_SECONDS * 1000),
            });
            const expectedBuffer = Buffer.from(expected);
            const candidateBuffer = Buffer.from(normalizeCode(code));
            return expectedBuffer.length === candidateBuffer.length
                && crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
        })
);

const verifyTotpCode = ({ user = null, code = '', pending = false } = {}) => {
    const encrypted = pending
        ? user?.mfa?.totp?.pendingSecretEncrypted
        : user?.mfa?.totp?.secretEncrypted;
    if (!encrypted) return false;
    return verifyTotpSecret({
        secret: decryptTotpSecret(encrypted),
        code,
    });
};

const enableTotpAfterVerification = async ({ userId, code } = {}) => {
    assertTotpEnabled();
    const user = await User.findById(userId).select('+mfa.totp.pendingSecretEncrypted').lean();
    if (!user?._id) throw new AppError('User not found.', 404);
    if (!verifyTotpCode({ user, code, pending: true })) {
        throw new AppError('Authenticator app code is invalid.', 401);
    }

    const now = new Date();
    const updated = await User.findByIdAndUpdate(
        user._id,
        {
            $set: {
                'mfa.enabled': true,
                'mfa.defaultMethod': user?.mfa?.defaultMethod || 'totp',
                'mfa.totp.enabled': true,
                'mfa.totp.secretEncrypted': user.mfa.totp.pendingSecretEncrypted,
                'mfa.totp.confirmedAt': now,
                'mfa.totp.lastVerifiedAt': now,
                'mfa.lastMfaAt': now,
                'mfa.lastMfaMethod': 'totp',
            },
            $unset: {
                'mfa.totp.pendingSecretEncrypted': '',
                'mfa.totp.pendingCreatedAt': '',
            },
        },
        {
            returnDocument: 'after',
            projection: 'mfa recoveryCodeState trustedDevices',
            lean: true,
        }
    );

    let recovery = null;
    if (Number(updated?.recoveryCodeState?.activeCount || 0) <= 0) {
        recovery = await generateRecoveryCodesForUser({
            userId: user._id,
            requirePasskey: false,
        });
    }

    return {
        user: updated,
        recoveryCodes: recovery?.codes || [],
        recoveryCodeState: recovery?.recoveryCodeState || updated?.recoveryCodeState || null,
        recoveryReadiness: recovery?.readiness || null,
    };
};

const verifyEnabledTotpForUser = async ({ userId, code } = {}) => {
    assertTotpEnabled();
    const user = await User.findById(userId).select('+mfa.totp.secretEncrypted').lean();
    if (!user?._id) throw new AppError('User not found.', 404);
    if (!user?.mfa?.totp?.enabled || !verifyTotpCode({ user, code })) {
        throw new AppError('Authenticator app code is invalid.', 401);
    }

    const now = new Date();
    return User.findByIdAndUpdate(
        user._id,
        {
            $set: {
                'mfa.enabled': true,
                'mfa.totp.lastVerifiedAt': now,
                'mfa.lastMfaAt': now,
                'mfa.lastMfaMethod': 'totp',
            },
        },
        {
            returnDocument: 'after',
            projection: 'name email phone avatar gender dob bio isAdmin adminRoles isVerified isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt trustedDevices recoveryCodeState mfa loyalty createdAt',
            lean: true,
        }
    );
};

const disableTotpAfterFreshMfa = async ({ userId } = {}) => {
    const now = new Date();
    return User.findByIdAndUpdate(
        userId,
        {
            $set: {
                'mfa.totp.enabled': false,
                'mfa.totp.disabledAt': now,
            },
            $unset: {
                'mfa.totp.secretEncrypted': '',
                'mfa.totp.pendingSecretEncrypted': '',
                'mfa.totp.pendingCreatedAt': '',
            },
        },
        {
            returnDocument: 'after',
            projection: 'mfa recoveryCodeState trustedDevices',
            lean: true,
        }
    );
};

const rotateTotpSecret = beginTotpSetup;

module.exports = {
    TOTP_ISSUER,
    base32Decode,
    base32Encode,
    beginTotpSetup,
    createOtpAuthUri,
    createQrCodeDataUrl,
    decryptTotpSecret,
    disableTotpAfterFreshMfa,
    enableTotpAfterVerification,
    encryptTotpSecret,
    generateTotpCode,
    generateTotpSecret,
    getPendingTotpSetup,
    rotateTotpSecret,
    verifyEnabledTotpForUser,
    verifyTotpCode,
    verifyTotpSecret,
};
