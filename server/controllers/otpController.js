const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const firebaseAdmin = require('../config/firebase');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');
const { sendOtpEmail } = require('../services/emailService');
const { sendOtpSms, normalizePhoneE164 } = require('../services/sms');
const { saveAuthProfileSnapshot, getAuthProfileSnapshotByEmail } = require('../services/authProfileVault');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { issuePaymentChallengeToken } = require('../utils/paymentChallengeToken');
const { flags: otpEmailFlags } = require('../config/otpEmailFlags');
const { flags: otpSmsFlags } = require('../config/otpSmsFlags');

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = otpEmailFlags.otpEmailTtlMinutes * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const BCRYPT_SALT_ROUNDS = 8;
const LOGIN_PROOF_MAX_AGE_SECONDS = 10 * 60;

const ALLOWED_PURPOSES = ['signup', 'login', 'forgot-password', 'payment-challenge'];
const ALLOWED_GENDERS = new Set(['male', 'female', 'other', 'prefer-not-to-say', '']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?\d{10,15}$/;
const OTP_REGEX = new RegExp(`^\\d{${OTP_LENGTH}}$`);

const OTP_FIELDS = 'name email phone isAdmin isVerified +otp +otpExpiry +otpPurpose +otpAttempts +otpLockedUntil';

const maskEmail = (email) => (
    typeof email === 'string'
        ? email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
        : '-'
);

const maskPhoneSuffix = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return 'unknown';
    const suffix = digits.slice(-4);
    return `***${suffix}`;
};

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizePhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const normalizePurpose = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const getPhoneDigits = (value) => String(value || '').replace(/\D/g, '');

const buildPhoneCandidates = (phone) => {
    const normalized = normalizePhone(phone);
    const digits = getPhoneDigits(normalized);
    const candidates = new Set();

    if (normalized) candidates.add(normalized);
    if (digits) {
        candidates.add(digits);
        candidates.add(`+${digits}`);
    }
    if (digits.length > 10) {
        const tail10 = digits.slice(-10);
        candidates.add(tail10);
        candidates.add(`+${tail10}`);
    }

    return Array.from(candidates).filter(Boolean);
};

const phoneMatchesCandidates = (storedPhone, candidates = []) => {
    if (!storedPhone) return false;
    const normalizedStored = normalizePhone(storedPhone);
    const digitsStored = getPhoneDigits(normalizedStored);
    const tailStored = digitsStored.length > 10 ? digitsStored.slice(-10) : digitsStored;

    return candidates.some((candidate) => {
        const normalizedCandidate = normalizePhone(candidate);
        const digitsCandidate = getPhoneDigits(normalizedCandidate);
        const tailCandidate = digitsCandidate.length > 10 ? digitsCandidate.slice(-10) : digitsCandidate;

        return normalizedCandidate === normalizedStored
            || digitsCandidate === digitsStored
            || (tailCandidate && tailStored && tailCandidate === tailStored);
    });
};

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const isLoginCredentialProofRequired = () => parseBooleanEnv(
    process.env.OTP_LOGIN_REQUIRE_CREDENTIAL_PROOF,
    process.env.NODE_ENV !== 'test'
);

const isLoginAutoRecoverEnabled = () => parseBooleanEnv(
    process.env.OTP_LOGIN_AUTO_RECOVER_PROFILE,
    true
);

const extractClientIp = (req) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const fallback = req.ip || req.connection?.remoteAddress || '';
    return (forwarded || fallback || '-').replace(/^::ffff:/i, '');
};

const audit = (event, data) => {
    logger.info(`otp.${event.toLowerCase()}`, {
        event,
        phone: data.phone || '-',
        email: data.email ? maskEmail(data.email) : '-',
        purpose: data.purpose || '-',
        ip: data.ip || '-',
        requestId: data.requestId || '-',
        success: data.success !== undefined ? data.success : null,
        reason: data.reason || null,
    });
};

const isOtpSessionStorageUnavailableError = (error) => (
    String(error?.message || '').toLowerCase().includes('cannot create a new collection')
);

const generateOtp = () => crypto.randomInt(100000, 999999).toString();
const hashOtp = (otp) => bcrypt.hash(otp, BCRYPT_SALT_ROUNDS);
const compareOtp = (otp, hash) => bcrypt.compare(otp, hash);

const verifyLoginCredentialProof = async ({ credentialProofToken, expectedEmail }) => {
    const token = String(credentialProofToken || '').trim();
    if (!token) {
        throw new AppError('Re-enter your password to continue secure OTP login.', 401);
    }
    if (token.length > 5000) {
        throw new AppError('Credential proof token is invalid', 400);
    }

    let decoded = null;
    try {
        decoded = await firebaseAdmin.auth().verifyIdToken(token);
    } catch {
        throw new AppError('Credential verification failed. Please sign in again.', 401);
    }

    const tokenEmail = normalizeEmail(decoded?.email || '');
    if (!tokenEmail || tokenEmail !== expectedEmail) {
        throw new AppError('Credential verification failed for this email.', 401);
    }

    const provider = decoded?.firebase?.sign_in_provider || '';
    if (provider && provider !== 'password') {
        throw new AppError('Secure OTP login requires password sign-in.', 401);
    }

    const authTimeSeconds = Number(decoded?.auth_time || 0);
    if (!authTimeSeconds) {
        throw new AppError('Credential proof is missing auth time. Please sign in again.', 401);
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - authTimeSeconds;
    if (ageSeconds < 0 || ageSeconds > LOGIN_PROOF_MAX_AGE_SECONDS) {
        throw new AppError('Credential proof expired. Re-enter password and try again.', 401);
    }

    return decoded;
};

const buildRecoveredName = (decodedToken, email) => {
    const source = String(decodedToken?.name || '').trim();
    if (source) return source.slice(0, 80);
    const local = String(email || '').split('@')[0] || 'Aura User';
    return local.slice(0, 80);
};

const buildVaultRecoveredUserPayload = ({
    email,
    phone,
    vaultProfile,
    fallbackName,
}) => {
    const recoveredPhone = PHONE_REGEX.test(String(vaultProfile?.phone || ''))
        ? normalizePhone(vaultProfile.phone)
        : phone;
    const recoveredGender = ALLOWED_GENDERS.has(String(vaultProfile?.gender || '').trim())
        ? String(vaultProfile.gender || '').trim()
        : '';
    const recoveredDob = vaultProfile?.dob ? new Date(vaultProfile.dob) : null;
    const safeDob = recoveredDob instanceof Date && !Number.isNaN(recoveredDob.getTime())
        ? recoveredDob
        : null;

    return {
        email,
        phone: recoveredPhone,
        name: String(vaultProfile?.name || fallbackName || 'Aura User').trim().slice(0, 120),
        avatar: String(vaultProfile?.avatar || '').trim(),
        gender: recoveredGender,
        dob: safeDob,
        bio: String(vaultProfile?.bio || '').trim(),
        isVerified: true,
        isAdmin: false,
    };
};

const clearUserOtpStateByPhone = async (phone) => {
    const phoneCandidates = buildPhoneCandidates(phone);
    if (phoneCandidates.length === 0) return;
    await User.updateOne(
        { phone: { $in: phoneCandidates } },
        { $set: { otp: null, otpExpiry: null, otpPurpose: null, otpAttempts: 0, otpLockedUntil: null } }
    );
};

const clearUserOtpStateByUserId = async (userId) => {
    if (!userId) return;
    await User.updateOne(
        { _id: userId },
        { $set: { otp: null, otpExpiry: null, otpPurpose: null, otpAttempts: 0, otpLockedUntil: null } }
    );
};

const mirrorUserOtpState = async ({ userId, otpHash, otpExpiry, purpose, attempts = 0, lockedUntil = null }) => {
    await User.updateOne(
        { _id: userId },
        {
            $set: {
                otp: otpHash,
                otpExpiry,
                otpPurpose: purpose,
                otpAttempts: attempts,
                otpLockedUntil: lockedUntil,
            },
        }
    );
};

const buildLegacyOtpSession = ({ user, purpose }) => {
    if (!user?.otp || !user?.otpExpiry) {
        return null;
    }
    if (user.otpPurpose && user.otpPurpose !== purpose) {
        return null;
    }
    return {
        otpHash: user.otp,
        expiresAt: user.otpExpiry,
        attempts: Number(user.otpAttempts || 0),
        lockedUntil: user.otpLockedUntil || null,
        __legacyFallback: true,
        async save() {
            await mirrorUserOtpState({
                userId: user._id,
                otpHash: this.otpHash,
                otpExpiry: this.expiresAt,
                purpose,
                attempts: Number(this.attempts || 0),
                lockedUntil: this.lockedUntil || null,
            });
        },
    };
};

const upsertOtpSession = async ({
    userId,
    purpose,
    otpHash,
    otpExpiry,
    requestMeta,
    attempts = 0,
    lockedUntil = null,
}) => {
    try {
        return await OtpSession.findOneAndUpdate(
            { user: userId, purpose },
            {
                $set: {
                    otpHash,
                    expiresAt: otpExpiry,
                    attempts,
                    lockedUntil,
                    lastSentAt: new Date(),
                    requestMeta,
                },
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
                runValidators: true,
            }
        ).select('+otpHash');
    } catch (error) {
        if (isOtpSessionStorageUnavailableError(error)) {
            logger.warn('otp.session_storage_unavailable', {
                reason: error.message,
                userId: String(userId),
                purpose,
            });
            return null;
        }
        throw error;
    }
};

const clearOtpSession = async ({ userId, purpose }) => {
    try {
        await OtpSession.deleteMany({ user: userId, purpose });
    } catch (error) {
        if (!isOtpSessionStorageUnavailableError(error)) {
            throw error;
        }
    }
};

const shouldAttemptEmailSend = () => {
    if (process.env.NODE_ENV !== 'test') return true;
    // In test, only enable SMTP path when the current process env explicitly requests it.
    return parseBooleanEnv(process.env.OTP_EMAIL_SEND_IN_TEST, false);
};

const isOtpEmailFailClosed = () => parseBooleanEnv(
    process.env.OTP_EMAIL_FAIL_CLOSED,
    otpEmailFlags.otpEmailFailClosed
);

const shouldAttemptSmsSend = () => {
    if (!otpSmsFlags.otpSmsEnabled) return false;
    if (process.env.NODE_ENV !== 'test') return true;
    return parseBooleanEnv(process.env.OTP_SMS_SEND_IN_TEST, otpSmsFlags.otpSmsSendInTest);
};

const isOtpSmsFailClosed = () => parseBooleanEnv(
    process.env.OTP_SMS_FAIL_CLOSED,
    otpSmsFlags.otpSmsFailClosed
);

const rollbackOtpStateAfterDeliveryFailure = async ({
    targetUser,
    purpose,
    createdPendingUser,
    email,
    phoneCandidates,
}) => {
    await clearOtpSession({ userId: targetUser._id, purpose });

    if (purpose === 'signup') {
        if (createdPendingUser?._id) {
            await User.deleteOne({ _id: createdPendingUser._id, isVerified: false });
        } else {
            await User.deleteMany({
                email,
                phone: { $in: phoneCandidates },
                isVerified: false,
            });
        }
        return;
    }

    await clearUserOtpStateByUserId(targetUser._id);
};

/**
 * @desc    Send OTP to user's email and mobile number
 * @route   POST /api/otp/send
 * @access  Public
 */
const sendOtp = asyncHandler(async (req, res, next) => {
    const rawEmail = req.body?.email;
    const rawPhone = req.body?.phone;
    const rawPurpose = req.body?.purpose;
    const rawCredentialProofToken = req.body?.credentialProofToken;
    const clientIp = extractClientIp(req);
    const requestId = req.requestId || '-';

    if (rawEmail === undefined || rawEmail === null || rawEmail === '') {
        return next(new AppError('Email is required', 400));
    }
    if (rawPhone === undefined || rawPhone === null || rawPhone === '') {
        return next(new AppError('Phone number is required', 400));
    }
    if (rawPurpose === undefined || rawPurpose === null || rawPurpose === '') {
        return next(new AppError('OTP purpose is required', 400));
    }

    if (typeof rawEmail !== 'string') {
        return next(new AppError('Email must be a string', 400));
    }
    if (typeof rawPhone !== 'string') {
        return next(new AppError('Phone number must be a string', 400));
    }
    if (typeof rawPurpose !== 'string') {
        return next(new AppError('OTP purpose must be a string', 400));
    }
    if (rawCredentialProofToken !== undefined && rawCredentialProofToken !== null && typeof rawCredentialProofToken !== 'string') {
        return next(new AppError('credentialProofToken must be a string', 400));
    }

    const email = normalizeEmail(rawEmail);
    const phone = normalizePhone(rawPhone);
    const phoneCandidates = buildPhoneCandidates(phone);
    const purpose = normalizePurpose(rawPurpose);
    const credentialProofToken = typeof rawCredentialProofToken === 'string'
        ? rawCredentialProofToken.trim()
        : '';

    if (!EMAIL_REGEX.test(email)) {
        return next(new AppError('Valid email address is required', 400));
    }
    if (!PHONE_REGEX.test(phone)) {
        return next(new AppError('Valid phone number is required', 400));
    }

    const purposeIsFormatted = rawPurpose === purpose;
    if (!purposeIsFormatted || !ALLOWED_PURPOSES.includes(purpose)) {
        return next(new AppError('Invalid OTP purpose. Must be: signup, login, forgot-password, or payment-challenge', 400));
    }

    const otpPlain = generateOtp();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);
    const otpHash = await hashOtp(otpPlain);

    let targetUser = null;
    let createdPendingUser = null;
    let credentialProof = null;

    if (purpose === 'signup') {
        const [existingVerified] = await Promise.all([
            User.findOne({ $or: [{ email }, { phone: { $in: phoneCandidates } }], isVerified: true }, 'email phone').lean(),
            User.deleteMany({ $or: [{ email }, { phone: { $in: phoneCandidates } }], isVerified: { $ne: true } }),
        ]);

        if (existingVerified) {
            const field = existingVerified.email === email ? 'email' : 'phone number';
            audit('SEND_BLOCKED', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `${field} already exists`,
            });
            return next(new AppError(`An account with this ${field} already exists. Please sign in.`, 409));
        }

        try {
            createdPendingUser = await User.create({
                email,
                phone,
                name: 'Pending',
                isVerified: false,
            });
            targetUser = createdPendingUser;
        } catch (createError) {
            if (createError?.code === 11000) {
                return next(new AppError('Account already exists. Please sign in.', 409));
            }
            throw createError;
        }
    } else {
        if (purpose === 'login' && isLoginCredentialProofRequired()) {
            try {
                credentialProof = await verifyLoginCredentialProof({
                    credentialProofToken,
                    expectedEmail: email,
                });
            } catch (proofError) {
                audit('SEND_FORBIDDEN', {
                    phone,
                    email,
                    purpose,
                    ip: clientIp,
                    requestId,
                    success: false,
                    reason: proofError.message,
                });
                return next(proofError);
            }
        }

        const [verifiedByEmail, verifiedByPhone] = await Promise.all([
            User.findOne({ email, isVerified: true }, '_id email phone').lean(),
            User.findOne({ phone: { $in: phoneCandidates }, isVerified: true }, '_id email phone').lean(),
        ]);

        if (verifiedByEmail && !phoneMatchesCandidates(verifiedByEmail.phone, phoneCandidates)) {
            audit('SEND_MISMATCH', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `phone mismatch expected ${maskPhoneSuffix(verifiedByEmail.phone)}`,
            });
            return next(new AppError(
                `Phone number does not match your account. Use the registered number ending ${maskPhoneSuffix(verifiedByEmail.phone)}.`,
                404
            ));
        }

        if (!verifiedByEmail && verifiedByPhone && normalizeEmail(verifiedByPhone.email) !== email) {
            audit('SEND_MISMATCH', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: 'email mismatch for registered phone',
            });
            return next(new AppError(
                'Email does not match the account linked to this phone number.',
                404
            ));
        }

        targetUser = verifiedByEmail || verifiedByPhone || null;

        if (!targetUser && ['login', 'forgot-password'].includes(purpose) && isLoginAutoRecoverEnabled()) {
            const vaultProfile = await getAuthProfileSnapshotByEmail(email);
            if (vaultProfile) {
                if (vaultProfile.phone && !phoneMatchesCandidates(vaultProfile.phone, phoneCandidates)) {
                    return next(new AppError(
                        `Phone number does not match your account. Use the registered number ending ${maskPhoneSuffix(vaultProfile.phone)}.`,
                        404
                    ));
                }

                try {
                    targetUser = await User.create(buildVaultRecoveredUserPayload({
                        email,
                        phone,
                        vaultProfile,
                        fallbackName: buildRecoveredName(credentialProof, email),
                    }));
                    audit('SEND_RECOVERED', {
                        phone: targetUser.phone,
                        email,
                        purpose,
                        ip: clientIp,
                        requestId,
                        success: true,
                        reason: 'recreated verified profile from auth vault snapshot',
                    });
                } catch (createError) {
                    if (createError?.code !== 11000) {
                        throw createError;
                    }
                }
            }
        }

        if (!targetUser && purpose === 'login' && credentialProof && isLoginAutoRecoverEnabled()) {
            try {
                const recoveredName = buildRecoveredName(credentialProof, email);
                targetUser = await User.create({
                    email,
                    phone,
                    name: recoveredName,
                    isVerified: true,
                });
                audit('SEND_RECOVERED', {
                    phone,
                    email,
                    purpose,
                    ip: clientIp,
                    requestId,
                    success: true,
                    reason: 'recreated verified profile from credential proof',
                });
            } catch (createError) {
                if (createError?.code === 11000) {
                    const recovered = await User.findOne(
                        {
                            $or: [
                                { email, isVerified: true },
                                { phone: { $in: phoneCandidates }, isVerified: true },
                            ],
                        },
                        '_id email phone'
                    ).lean();

                    if (recovered && normalizeEmail(recovered.email) === email && phoneMatchesCandidates(recovered.phone, phoneCandidates)) {
                        targetUser = recovered;
                    } else if (recovered) {
                        const mismatchMsg = normalizeEmail(recovered.email) === email
                            ? `Phone mismatch. Use number ending ${maskPhoneSuffix(recovered.phone)}.`
                            : 'Email does not match the account linked to this phone number.';
                        return next(new AppError(mismatchMsg, 404));
                    }
                } else {
                    throw createError;
                }
            }
        }

        if (!targetUser) {
            audit('SEND_404', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: 'verified user not found for login context',
            });
            return next(new AppError('No account found with this phone number. Please sign up first.', 404));
        }
    }

    await saveAuthProfileSnapshot({
        name: targetUser.name,
        email: targetUser.email || email,
        phone: targetUser.phone || phone,
        avatar: targetUser.avatar || '',
        gender: targetUser.gender || '',
        dob: targetUser.dob || null,
        bio: targetUser.bio || '',
        isVerified: purpose === 'signup' ? Boolean(targetUser.isVerified) : true,
        isAdmin: Boolean(targetUser.isAdmin),
    });

    const requestMeta = {
        ip: clientIp,
        userAgent: req.headers['user-agent'] || '',
        location: String(req.headers['x-client-location'] || '').trim(),
        requestId,
    };

    await upsertOtpSession({
        userId: targetUser._id,
        purpose,
        otpHash,
        otpExpiry,
        requestMeta,
    });

    await mirrorUserOtpState({
        userId: targetUser._id,
        otpHash,
        otpExpiry,
        purpose,
        attempts: 0,
        lockedUntil: null,
    });

    const smsTarget = normalizePhoneE164(phone);
    let emailDelivered = false;
    let smsDelivered = false;
    let mobileChannel = 'sms';

    if (shouldAttemptEmailSend()) {
        try {
            await sendOtpEmail({
                to: email,
                otp: otpPlain,
                purpose,
                requestId,
                context: {
                    ip: clientIp,
                    userAgent: req.headers['user-agent'] || '',
                    requestTime: new Date(),
                    location: String(req.headers['x-client-location'] || '').trim(),
                },
            });
            emailDelivered = true;
        } catch (emailError) {
            const failReason = emailError?.message || 'OTP email delivery failed';
            const otpEmailFailClosed = isOtpEmailFailClosed();

            if (otpEmailFailClosed) {
                await rollbackOtpStateAfterDeliveryFailure({
                    targetUser,
                    purpose,
                    createdPendingUser,
                    email,
                    phoneCandidates,
                });
            }

            audit('SEND_EMAIL_FAIL', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: failReason,
            });

            if (otpEmailFailClosed) {
                return next(new AppError('Unable to deliver verification email right now. Please try again shortly.', 503));
            }
        }
    }

    if (shouldAttemptSmsSend()) {
        try {
            const smsResult = await sendOtpSms({
                toPhone: smsTarget,
                otp: otpPlain,
                purpose,
                requestId,
                context: {
                    ip: clientIp,
                    userAgent: req.headers['user-agent'] || '',
                    requestTime: new Date(),
                    location: String(req.headers['x-client-location'] || '').trim(),
                },
            });
            mobileChannel = String(smsResult?.channel || 'sms').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'sms';
            smsDelivered = true;
        } catch (smsError) {
            const failReason = smsError?.message || 'OTP SMS delivery failed';
            const otpSmsFailClosed = isOtpSmsFailClosed();

            if (otpSmsFailClosed) {
                await rollbackOtpStateAfterDeliveryFailure({
                    targetUser,
                    purpose,
                    createdPendingUser,
                    email,
                    phoneCandidates,
                });
            }

            audit('SEND_SMS_FAIL', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: failReason,
            });

            if (otpSmsFailClosed) {
                return next(new AppError('Unable to deliver verification SMS right now. Please try again shortly.', 503));
            }
        }
    }

    const mobileDestination = mobileChannel === 'whatsapp'
        ? `${phone} on WhatsApp`
        : phone;
    const deliveryLabel = emailDelivered && smsDelivered
        ? `${email} and ${mobileDestination}`
        : emailDelivered
            ? email
            : smsDelivered
                ? mobileDestination
                : `${email} and ${phone}`;

    audit('SEND_OK', { phone, email, purpose, ip: clientIp, requestId, success: true });
    res.json({ success: true, message: `OTP sent to ${deliveryLabel}` });
});

/**
 * @desc    Verify OTP
 * @route   POST /api/otp/verify
 * @access  Public
 */
const verifyOtp = asyncHandler(async (req, res, next) => {
    const rawPhone = req.body?.phone;
    const rawOtp = req.body?.otp;
    const rawPurpose = req.body?.purpose;
    const rawIntentId = req.body?.intentId;
    const clientIp = extractClientIp(req);
    const requestId = req.requestId || '-';

    if (rawPhone === undefined || rawPhone === null || rawPhone === '') {
        return next(new AppError('Phone number is required', 400));
    }
    if (rawOtp === undefined || rawOtp === null || rawOtp === '') {
        return next(new AppError('OTP is required', 400));
    }
    if (rawPurpose === undefined || rawPurpose === null || rawPurpose === '') {
        return next(new AppError('OTP purpose is required', 400));
    }

    if (typeof rawPhone !== 'string') {
        return next(new AppError('Phone number must be a string', 400));
    }
    if (typeof rawOtp !== 'string') {
        return next(new AppError('OTP must be a string', 400));
    }
    if (typeof rawPurpose !== 'string') {
        return next(new AppError('OTP purpose must be a string', 400));
    }

    const phone = normalizePhone(rawPhone);
    const otp = rawOtp.trim();
    const purpose = normalizePurpose(rawPurpose);

    if (!PHONE_REGEX.test(phone)) {
        return next(new AppError('Valid phone number is required', 400));
    }
    if (!OTP_REGEX.test(otp)) {
        return next(new AppError(`Invalid OTP. Please enter a valid ${OTP_LENGTH}-digit code.`, 400));
    }

    const purposeIsFormatted = rawPurpose === purpose;
    if (!purposeIsFormatted || !ALLOWED_PURPOSES.includes(purpose)) {
        return next(new AppError('Invalid OTP purpose. Must be: signup, login, forgot-password, or payment-challenge', 400));
    }

    if (rawIntentId !== undefined && rawIntentId !== null && rawIntentId !== '') {
        if (typeof rawIntentId !== 'string') {
            return next(new AppError('intentId must be a string', 400));
        }
        const intentId = rawIntentId.trim();
        if (intentId.length < 6 || intentId.length > 120) {
            return next(new AppError('intentId format is invalid', 400));
        }
    }

    const phoneCandidates = buildPhoneCandidates(phone);
    const user = await User.findOne({ phone: { $in: phoneCandidates } }).select(OTP_FIELDS);

    if (!user) {
        audit('VERIFY_404', { phone, purpose, ip: clientIp, requestId, success: false, reason: 'user not found' });
        return next(new AppError('No account found with this phone number', 404));
    }

    let session = null;
    let otpSessionStorageUnavailable = false;
    try {
        session = await OtpSession.findOne({ user: user._id, purpose }).select('+otpHash');
    } catch (error) {
        if (!isOtpSessionStorageUnavailableError(error)) {
            throw error;
        }
        otpSessionStorageUnavailable = true;
    }

    if (!session) {
        if (user.otpPurpose && user.otpPurpose !== purpose) {
            audit('VERIFY_MISMATCH', {
                phone,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `expected ${user.otpPurpose}`,
            });
            return next(new AppError('OTP purpose mismatch. Please request a new OTP.', 400));
        }

        if (user.otpLockedUntil && new Date() < user.otpLockedUntil) {
            const minutesLeft = Math.ceil((new Date(user.otpLockedUntil).getTime() - Date.now()) / 60000);
            audit('VERIFY_LOCKED', {
                phone,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `legacy lock ${minutesLeft}min`,
            });
            return next(new AppError(
                `Too many failed attempts. Account locked for ${minutesLeft} more minute(s). Please try again later.`,
                423
            ));
        }

        const legacySession = buildLegacyOtpSession({ user, purpose });

        if (legacySession) {
            if (otpSessionStorageUnavailable) {
                session = legacySession;
            } else {
                session = await upsertOtpSession({
                    userId: user._id,
                    purpose,
                    otpHash: user.otp,
                    otpExpiry: user.otpExpiry,
                    requestMeta: {
                        ip: clientIp,
                        userAgent: req.headers['user-agent'] || '',
                        location: String(req.headers['x-client-location'] || '').trim(),
                        requestId,
                    },
                    attempts: Number(user.otpAttempts || 0),
                    lockedUntil: user.otpLockedUntil || null,
                });
                if (!session) {
                    otpSessionStorageUnavailable = true;
                    session = legacySession;
                }
            }
        }
    }

    if (!session) {
        let anySession = null;
        if (!otpSessionStorageUnavailable) {
            try {
                anySession = await OtpSession.findOne({ user: user._id }).lean();
            } catch (error) {
                if (!isOtpSessionStorageUnavailableError(error)) {
                    throw error;
                }
                otpSessionStorageUnavailable = true;
            }
        }
        if (anySession?.purpose && anySession.purpose !== purpose) {
            audit('VERIFY_MISMATCH', {
                phone,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `expected ${anySession.purpose}`,
            });
            return next(new AppError('OTP purpose mismatch. Please request a new OTP.', 400));
        }

        audit('VERIFY_EXPIRED', { phone, purpose, ip: clientIp, requestId, success: false, reason: 'OTP expired/missing' });
        await clearUserOtpStateByUserId(user._id);
        return next(new AppError('OTP has expired. Please request a new one.', 410));
    }

    if (session.lockedUntil && new Date() < session.lockedUntil) {
        const minutesLeft = Math.ceil((new Date(session.lockedUntil).getTime() - Date.now()) / 60000);
        audit('VERIFY_LOCKED', { phone, purpose, ip: clientIp, requestId, success: false, reason: `locked ${minutesLeft}min` });
        return next(new AppError(
            `Too many failed attempts. Account locked for ${minutesLeft} more minute(s). Please try again later.`,
            423
        ));
    }

    if (!session.expiresAt || new Date() > session.expiresAt) {
        await clearOtpSession({ userId: user._id, purpose });
        await clearUserOtpStateByUserId(user._id);
        audit('VERIFY_EXPIRED', { phone, purpose, ip: clientIp, requestId, success: false, reason: 'OTP expired' });
        return next(new AppError('OTP has expired. Please request a new one.', 410));
    }

    const isMatch = session.otpHash ? await compareOtp(otp, session.otpHash) : false;

    if (!isMatch) {
        const newAttempts = Number(session.attempts || 0) + 1;

        if (newAttempts >= MAX_OTP_ATTEMPTS) {
            const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
            await clearOtpSession({ userId: user._id, purpose });

            await User.updateOne(
                { _id: user._id },
                {
                    $set: {
                        otp: null,
                        otpExpiry: null,
                        otpPurpose: purpose,
                        otpAttempts: newAttempts,
                        otpLockedUntil: lockedUntil,
                    },
                }
            );

            audit('VERIFY_LOCKOUT', {
                phone,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `locked after ${newAttempts} attempts`,
            });

            return next(new AppError(
                `Too many failed attempts (${newAttempts}/${MAX_OTP_ATTEMPTS}). Account locked for 15 minutes.`,
                423
            ));
        }

        session.attempts = newAttempts;
        await session.save();

        if (!session.__legacyFallback) {
            await mirrorUserOtpState({
                userId: user._id,
                otpHash: session.otpHash,
                otpExpiry: session.expiresAt,
                purpose,
                attempts: newAttempts,
                lockedUntil: null,
            });
        }

        const remaining = MAX_OTP_ATTEMPTS - newAttempts;
        audit('VERIFY_WRONG', {
            phone,
            purpose,
            ip: clientIp,
            requestId,
            success: false,
            reason: `attempt ${newAttempts}/${MAX_OTP_ATTEMPTS}`,
        });
        return next(new AppError(
            `Invalid OTP. Please check and try again. ${remaining} attempt(s) remaining.`,
            401
        ));
    }

    await clearOtpSession({ userId: user._id, purpose });

    await User.updateOne(
        { _id: user._id },
        {
            $set: {
                otp: null,
                otpExpiry: null,
                otpPurpose: null,
                otpAttempts: 0,
                otpLockedUntil: null,
                isVerified: true,
            },
        }
    );

    await saveAuthProfileSnapshot({
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar || '',
        gender: user.gender || '',
        dob: user.dob || null,
        bio: user.bio || '',
        isVerified: true,
        isAdmin: Boolean(user.isAdmin),
    });

    audit('VERIFY_OK', { phone, email: user.email, purpose, ip: clientIp, requestId, success: true });

    const challengePayload = purpose === 'payment-challenge'
        ? issuePaymentChallengeToken({
            userId: user._id,
            phone: user.phone,
            intentId: typeof rawIntentId === 'string' ? rawIntentId.trim() : '',
        })
        : null;

    res.json({
        success: true,
        message: 'OTP verified successfully',
        verified: true,
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            isAdmin: user.isAdmin,
        },
        ...(challengePayload || {}),
    });
});

/**
 * @desc    Check if a user exists by phone number
 * @route   POST /api/otp/check-user
 * @access  Public
 */
const checkUserExists = asyncHandler(async (req, res, next) => {
    const rawEmail = req.body?.email;
    const rawPhone = req.body?.phone;

    if (rawPhone === undefined || rawPhone === null || rawPhone === '') {
        return next(new AppError('Phone number is required', 400));
    }

    if (typeof rawPhone !== 'string') {
        return next(new AppError('Phone number must be a string', 400));
    }

    let email = '';
    if (rawEmail !== undefined && rawEmail !== null && rawEmail !== '') {
        if (typeof rawEmail !== 'string') {
            return next(new AppError('Email must be a string', 400));
        }
        email = normalizeEmail(rawEmail);
        if (!EMAIL_REGEX.test(email)) {
            return next(new AppError('Valid email address is required', 400));
        }
    }

    const phone = normalizePhone(rawPhone);
    if (!PHONE_REGEX.test(phone)) {
        return next(new AppError('Valid phone number is required', 400));
    }

    const phoneCandidates = buildPhoneCandidates(phone);
    let user = null;
    let reason = null;
    let registeredPhoneSuffix = null;

    if (email) {
        const [verifiedByEmail, verifiedByPhone] = await Promise.all([
            User.findOne({ email, isVerified: true }, 'email phone').lean(),
            User.findOne({ phone: { $in: phoneCandidates }, isVerified: true }, 'email phone').lean(),
        ]);

        if (verifiedByEmail && !phoneMatchesCandidates(verifiedByEmail.phone, phoneCandidates)) {
            reason = 'phone_mismatch';
            registeredPhoneSuffix = maskPhoneSuffix(verifiedByEmail.phone);
        } else if (!verifiedByEmail && verifiedByPhone && normalizeEmail(verifiedByPhone.email) !== email) {
            reason = 'email_mismatch';
        } else {
            user = verifiedByEmail || verifiedByPhone || null;
        }
    } else {
        user = await User.findOne({ phone: { $in: phoneCandidates }, isVerified: true }, 'email phone').lean();
    }

    res.json({
        exists: !!user,
        email: user ? maskEmail(user.email) : null,
        phone: user ? user.phone : null,
        reason,
        registeredPhoneSuffix,
    });
});

module.exports = { sendOtp, verifyOtp, checkUserExists };
