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
const { inspectOtpFlowToken, issueOtpFlowToken, verifyOtpFlowToken } = require('../utils/otpFlowToken');
const { flags: otpEmailFlags } = require('../config/otpEmailFlags');
const { flags: otpSmsFlags } = require('../config/otpSmsFlags');
const { validatePasswordPolicy, detectWeakPasswordPatterns } = require('../utils/passwordValidator');
const {
    extractTrustedDeviceChallengePayload,
    extractTrustedDeviceContext,
    getTrustedDeviceSessionToken,
    hashTrustedDeviceSessionToken,
    resolveTrustedDeviceBootstrapSignal,
} = require('../services/trustedDeviceChallengeService');
const { registerOtpFlowGrant, consumeOtpFlowGrant } = require('../services/otpFlowGrantService');
const {
    AUTH_ASSURANCE_ACTIONS,
    requireAuthAssurance,
} = require('../services/authAssurancePolicyService');

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = otpEmailFlags.otpEmailTtlMinutes * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const BCRYPT_SALT_ROUNDS = 8;
const LOGIN_PROOF_MAX_AGE_SECONDS = 10 * 60;
const LOGIN_ASSURANCE_TTL_MS = 10 * 60 * 1000;
const RESET_PASSWORD_SESSION_TTL_MS = 10 * 60 * 1000;
const SIGNUP_IDENTIFIER_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_IDENTIFIER_MAX_REQUESTS = 5;
const SIGNUP_IDENTIFIER_TELEMETRY_THRESHOLD = 3;
const GENERIC_OTP_VERIFICATION_MESSAGE = 'If account details are valid, verification will proceed.';

const ALLOWED_PURPOSES = ['signup', 'login', 'forgot-password', 'payment-challenge'];
const ALLOWED_GENDERS = new Set(['male', 'female', 'other', 'prefer-not-to-say', '']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?\d{10,15}$/;
const PHONE_E164_INPUT_REGEX = /^\+[1-9]\d{7,14}$/;
const OTP_REGEX = new RegExp(`^\\d{${OTP_LENGTH}}$`);
const GENERIC_ACCOUNT_DISCOVERY_MESSAGE = 'If an account exists, verification instructions have been sent.';
const GENERIC_ACCOUNT_RESPONSE_MESSAGE = 'If the account details are valid, we will continue with verification steps.';

const OTP_FIELDS = 'name email phone isAdmin isVerified authAssurance authAssuranceAt trustedDevices +otp +otpExpiry +otpPurpose +otpAttempts +otpLockedUntil';
const signupIdentifierRateStore = new Map();
const EMAIL_FACTOR_PURPOSES = new Set(['signup', 'login', 'forgot-password']);
const BOOTSTRAP_CHALLENGE_SCOPE_BY_PURPOSE = {
    login: 'otp-send:login',
    'forgot-password': 'otp-send:forgot-password',
};

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

const canonicalizePhoneIdentity = (value) => {
    const normalized = normalizePhone(value);
    if (!PHONE_REGEX.test(normalized)) return '';
    try {
        return normalizePhoneE164(normalized);
    } catch {
        return '';
    }
};

const phoneIdentityMatches = (storedPhone, canonicalPhone) => {
    if (!storedPhone || !canonicalPhone) return false;
    return canonicalizePhoneIdentity(storedPhone) === canonicalPhone;
};

const buildPhoneLookupCandidates = (phoneInput, canonicalPhone) => {
    const candidates = new Set();
    const canonical = canonicalPhone || canonicalizePhoneIdentity(phoneInput);
    const normalizedInput = normalizePhone(phoneInput);

    if (canonical) {
        candidates.add(canonical);
        const canonicalDigits = canonical.replace(/\D/g, '');
        if (canonicalDigits) {
            candidates.add(canonicalDigits);
            if (canonicalDigits.length > 10) {
                candidates.add(canonicalDigits.slice(-10));
            }
        }
    }

    if (normalizedInput) {
        candidates.add(normalizedInput);
        const normalizedDigits = normalizedInput.replace(/\D/g, '');
        if (normalizedDigits) {
            candidates.add(normalizedDigits);
            if (normalizedDigits.length > 10) {
                candidates.add(normalizedDigits.slice(-10));
            }
        }
    }

    return Array.from(candidates).filter(Boolean);
};

const normalizePurpose = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const normalizeOtpFactor = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const buildOtpFlowSignalBond = ({ req = {}, session = null, purpose = '' } = {}) => {
    const signalBond = {};
    const boundDeviceId = String(session?.requestMeta?.deviceId || '').trim();
    const boundDeviceSessionHash = String(session?.requestMeta?.deviceSessionHash || '').trim();
    const boundDeviceMethod = String(session?.requestMeta?.deviceMethod || '').trim().toLowerCase();
    const boundAuthUid = String(session?.requestMeta?.credentialUid || '').trim();

    if (boundDeviceId) {
        signalBond.deviceId = boundDeviceId;
    }
    if (boundDeviceSessionHash) {
        signalBond.deviceSessionHash = boundDeviceSessionHash;
    }
    if (boundDeviceMethod) {
        signalBond.deviceMethod = boundDeviceMethod;
    }
    if (purpose === 'login' && boundAuthUid) {
        signalBond.authUid = boundAuthUid;
    }

    return signalBond;
};

const resolveOtpFlowCurrentStep = ({ factor = '', currentStep = '' } = {}) => {
    const explicitStep = String(currentStep || '').trim();
    if (explicitStep) {
        return explicitStep;
    }
    return String(factor || '').trim().toLowerCase() === 'email'
        ? 'email-verified'
        : 'otp-verified';
};

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const isTestEnvironment = () => process.env.NODE_ENV === 'test';


const isProductionEnvironment = () => process.env.NODE_ENV === 'production';

const isExplicitNonProdFailOpenPath = () => {
    if (isProductionEnvironment() || isTestEnvironment()) return false;
    return parseBooleanEnv(process.env.OTP_ALLOW_FAIL_OPEN_WITHOUT_DELIVERY, false);
};

const isLoginCredentialProofRequired = () => parseBooleanEnv(
    isTestEnvironment()
        ? process.env.OTP_LOGIN_REQUIRE_CREDENTIAL_PROOF_IN_TEST
        : process.env.OTP_LOGIN_REQUIRE_CREDENTIAL_PROOF,
    !isTestEnvironment()
);

const isLoginAutoRecoverEnabled = () => parseBooleanEnv(
    isTestEnvironment()
        ? process.env.OTP_LOGIN_AUTO_RECOVER_PROFILE_IN_TEST
        : process.env.OTP_LOGIN_AUTO_RECOVER_PROFILE,
    false
);

const isInternationalPhoneFormatRequired = () => parseBooleanEnv(
    process.env.AUTH_REQUIRE_INTERNATIONAL_PHONE_FORMAT,
    isProductionEnvironment()
);

const extractClientIp = (req) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const fallback = req.ip || req.connection?.remoteAddress || '';
    return (forwarded || fallback || '-').replace(/^::ffff:/i, '');
};

const audit = (event, data) => {
    const maskedPhone = data.phone ? maskPhoneSuffix(data.phone) : '-';

    logger.info(`otp.${event.toLowerCase()}`, {
        event,
        phone: maskedPhone,
        email: data.email ? maskEmail(data.email) : '-',
        purpose: data.purpose || '-',
        requestId: data.requestId || '-',
        success: data.success !== undefined ? data.success : null,
        reason: data.reason || null,
        ...(data.includeIp ? { ip: data.ip || '-' } : {}),
    });
};

const computeSignupIdentifierRateState = ({ email, phone }) => {
    const now = Date.now();
    const key = `${normalizeEmail(email)}|${normalizePhone(phone)}`;
    const current = signupIdentifierRateStore.get(key);

    if (!current || current.resetAt <= now) {
        const next = {
            count: 1,
            resetAt: now + SIGNUP_IDENTIFIER_WINDOW_MS,
        };
        signupIdentifierRateStore.set(key, next);
        return { key, ...next, ttlMs: SIGNUP_IDENTIFIER_WINDOW_MS };
    }

    current.count += 1;
    signupIdentifierRateStore.set(key, current);
    return {
        key,
        count: current.count,
        resetAt: current.resetAt,
        ttlMs: Math.max(current.resetAt - now, 0),
    };
};

const sendGenericOtpResponse = (res) => res.json({ success: true, message: GENERIC_ACCOUNT_DISCOVERY_MESSAGE });

const sendGenericAccountFlowResponse = (res) => res.status(200).json({
    success: true,
    message: GENERIC_ACCOUNT_RESPONSE_MESSAGE,
});

const isOtpSessionStorageUnavailableError = (error) => (
    String(error?.message || '').toLowerCase().includes('cannot create a new collection')
);


const AUTH_ASSURANCE_BY_PURPOSE = {
    signup: 'otp',
    login: 'password+otp',
    'forgot-password': 'otp',
    'payment-challenge': 'password+otp',
};

const getAssuranceForPurpose = (purpose) => AUTH_ASSURANCE_BY_PURPOSE[purpose] || 'otp';

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
    const recoveredPhone = canonicalizePhoneIdentity(vaultProfile?.phone) || phone;
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

const clearUserOtpStateByPhone = async (canonicalPhone) => {
    if (!canonicalPhone) return;
    await User.updateOne(
        { phone: canonicalPhone },
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
    identityKey,
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
            { identityKey, purpose },
            {
                $set: {
                    identityKey,
                    user: userId,
                    otpHash,
                    expiresAt: otpExpiry,
                    attempts,
                    lockedUntil,
                    lastSentAt: new Date(),
                    requestMeta,
                },
            },
            {
                returnDocument: 'after',
                upsert: true,
                setDefaultsOnInsert: true,
                runValidators: true,
            }
        ).select('+otpHash');
    } catch (error) {
        if (isOtpSessionStorageUnavailableError(error)) {
            logger.warn('otp.session_storage_unavailable', {
                reason: error.message,
                identityKey,
                userId: String(userId),
                purpose,
            });
            return null;
        }
        throw error;
    }
};


const findOtpSessionByIdentity = async ({ identityKey, userId, purpose, includeHash = false }) => {
    const projection = includeHash ? '+otpHash' : '';
    let session = await OtpSession.findOne({ identityKey, purpose }).select(projection);
    if (session) {
        if (String(session.user) !== String(userId)) {
            session.user = userId;
            await session.save();
        }
        return session;
    }

    const legacySession = await OtpSession.findOne({ user: userId, purpose }).select(projection);
    if (!legacySession) return null;

    legacySession.identityKey = identityKey;
    await legacySession.save();
    return legacySession;
};

const clearOtpSession = async ({ identityKey, purpose }) => {
    try {
        await OtpSession.deleteMany({ identityKey, purpose });
    } catch (error) {
        if (!isOtpSessionStorageUnavailableError(error)) {
            throw error;
        }
    }
};

const shouldAttemptEmailSend = () => {
    if (process.env.NODE_ENV !== 'test') return true;
    // In test, enable delivery (it hits the mock provider)
    return true;
};

const isOtpEmailFailClosed = () => parseBooleanEnv(
    process.env.OTP_EMAIL_FAIL_CLOSED,
    otpEmailFlags.otpEmailFailClosed
);

const shouldAttemptSmsSend = () => {
    if (!otpSmsFlags.otpSmsEnabled) return false;
    if (process.env.NODE_ENV !== 'test') return true;
    // In test, enable mocked delivery
    return true;
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
    canonicalPhone,
}) => {
    await clearOtpSession({ identityKey: canonicalPhone, purpose });

    if (purpose === 'signup') {
        if (createdPendingUser?._id) {
            await User.deleteOne({ _id: createdPendingUser._id, isVerified: false });
        } else if (email && canonicalPhone) {
            await User.deleteMany({
                email,
                phone: canonicalPhone,
                isVerified: false,
            });
        } else if (targetUser?._id) {
            await clearUserOtpStateByUserId(targetUser._id);
        }
        return;
    }

    if (targetUser?._id) {
        await clearUserOtpStateByUserId(targetUser._id);
    }
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
    const rawSkipSms = req.body?.skipSms;
    const rawStrictIdentity = req.body?.strictIdentity;
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
    if (rawSkipSms !== undefined && rawSkipSms !== null && typeof rawSkipSms !== 'boolean') {
        return next(new AppError('skipSms must be a boolean', 400));
    }
    if (rawStrictIdentity !== undefined && rawStrictIdentity !== null && typeof rawStrictIdentity !== 'boolean') {
        return next(new AppError('strictIdentity must be a boolean', 400));
    }

    const email = normalizeEmail(rawEmail);
    const phone = normalizePhone(rawPhone);
    const canonicalPhone = canonicalizePhoneIdentity(phone);
    const purpose = normalizePurpose(rawPurpose);
    const skipSms = rawSkipSms === true;
    const strictIdentity = rawStrictIdentity === true;
    const credentialProofToken = typeof rawCredentialProofToken === 'string'
        ? rawCredentialProofToken.trim()
        : '';
    const useStrictLoginIdentity = purpose === 'login' && strictIdentity;

    if (!EMAIL_REGEX.test(email)) {
        return next(new AppError('Valid email address is required', 400));
    }
    if (!canonicalPhone) {
        return next(new AppError('Valid phone number is required', 400));
    }
    if (isInternationalPhoneFormatRequired() && !PHONE_E164_INPUT_REGEX.test(phone)) {
        return next(new AppError('Use international phone format with country code, for example +12025550142', 400));
    }

    const purposeIsFormatted = rawPurpose === purpose;
    if (!purposeIsFormatted || !ALLOWED_PURPOSES.includes(purpose)) {
        return next(new AppError('Invalid OTP purpose. Must be: signup, login, forgot-password, or payment-challenge', 400));
    }

    const otpPlain = generateOtp();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);
    const otpHash = await hashOtp(otpPlain);

    let targetUser = null;
    let credentialProof = null;
    const shouldReturnGenericNonSignupResponse = () => (
        !useStrictLoginIdentity
        && purpose !== 'signup'
        && ['login', 'forgot-password'].includes(purpose)
    );
    const failStrictLoginIdentity = (message, statusCode = 403) => {
        if (!useStrictLoginIdentity) {
            return false;
        }
        next(new AppError(message, statusCode));
        return true;
    };
    const returnGenericNonSignupResponse = ({ event, reason }) => {
        audit(event, {
            phone,
            email,
            purpose,
            ip: clientIp,
            requestId,
            success: true,
            reason,
        });
        return res.json({ success: true, message: GENERIC_ACCOUNT_RESPONSE_MESSAGE });
    };

    if (purpose === 'signup') {
        const signupRateState = computeSignupIdentifierRateState({ email, phone });
        if (signupRateState.count >= SIGNUP_IDENTIFIER_TELEMETRY_THRESHOLD) {
            audit('SEND_ABUSE_SIGNAL', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: null,
                reason: `signup identifier requested ${signupRateState.count} times in ${Math.ceil(SIGNUP_IDENTIFIER_WINDOW_MS / 60000)}m`,
            });
        }
        if (signupRateState.count > SIGNUP_IDENTIFIER_MAX_REQUESTS) {
            audit('SEND_ABUSE_BLOCKED', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `signup identifier rate limit exceeded (${signupRateState.count}/${SIGNUP_IDENTIFIER_MAX_REQUESTS})`,
            });
            return next(new AppError('Too many signup OTP requests for this account. Please wait a few minutes and try again.', 429));
        }

        const signupPhoneCandidates = buildPhoneLookupCandidates(phone, canonicalPhone);
        const existingVerified = await User.findOne(
            {
                isVerified: true,
                $or: [
                    { email },
                    { phone: { $in: signupPhoneCandidates } },
                ],
            },
            'email phone'
        ).lean();

        if (existingVerified) {
            const field = existingVerified.email === email ? 'email' : 'phone number';
            audit('SEND_BLOCKED', {
                phone: canonicalPhone,
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
            targetUser = await User.findOneAndUpdate(
                { email, isVerified: false },
                {
                    $set: {
                        phone: canonicalPhone,
                        name: 'Pending',
                        isVerified: false,
                        isAdmin: false,
                    },
                    $setOnInsert: {
                        email,
                    },
                },
                {
                    returnDocument: 'after',
                    upsert: true,
                    setDefaultsOnInsert: true,
                    runValidators: true,
                    select: OTP_FIELDS,
                }
            );
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
                    phone: canonicalPhone,
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

        const verifiedCandidates = await User.find(
            {
                isVerified: true,
                $or: [
                    { email },
                    { phone: canonicalPhone },
                ],
            },
            '_id email phone'
        )
            .limit(4)
            .lean();

        const verifiedByEmail = verifiedCandidates.find(
            (candidate) => normalizeEmail(candidate?.email) === email
        ) || null;
        const verifiedByPhone = verifiedCandidates.find(
            (candidate) => phoneIdentityMatches(candidate?.phone, canonicalPhone)
        ) || null;

        if (verifiedByEmail && !phoneIdentityMatches(verifiedByEmail.phone, canonicalPhone)) {
            const reason = `phone mismatch expected ${maskPhoneSuffix(verifiedByEmail.phone)}`;
            if (failStrictLoginIdentity('Phone number does not match your registered account.', 403)) return;
            if (shouldReturnGenericNonSignupResponse()) {
                return returnGenericNonSignupResponse({ event: 'SEND_MISMATCH', reason });
            }
            return next(new AppError(GENERIC_OTP_VERIFICATION_MESSAGE, 404));
        }

        if (!verifiedByEmail && verifiedByPhone && normalizeEmail(verifiedByPhone.email) !== email) {
            const reason = 'email mismatch for registered phone';
            if (failStrictLoginIdentity('Email address does not match your registered account.', 403)) return;
            if (shouldReturnGenericNonSignupResponse()) {
                return returnGenericNonSignupResponse({ event: 'SEND_MISMATCH', reason });
            }
            return next(new AppError(GENERIC_OTP_VERIFICATION_MESSAGE, 404));
        }

        targetUser = verifiedByEmail || verifiedByPhone || null;

        if (!targetUser && !useStrictLoginIdentity && ['login', 'forgot-password'].includes(purpose) && isLoginAutoRecoverEnabled()) {
            const vaultProfile = await getAuthProfileSnapshotByEmail(email);
            if (vaultProfile) {
                if (vaultProfile.phone && !phoneIdentityMatches(vaultProfile.phone, canonicalPhone)) {
                    const reason = `phone mismatch expected ${maskPhoneSuffix(vaultProfile.phone)} from auth vault snapshot`;
                    if (shouldReturnGenericNonSignupResponse()) {
                        return returnGenericNonSignupResponse({ event: 'SEND_MISMATCH', reason });
                    }
                    return next(new AppError(GENERIC_OTP_VERIFICATION_MESSAGE, 404));
                }

                try {
                    targetUser = await User.create(buildVaultRecoveredUserPayload({
                        email,
                        phone: canonicalPhone,
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

        if (!targetUser && !useStrictLoginIdentity && purpose === 'login' && credentialProof && isLoginAutoRecoverEnabled()) {
            try {
                const recoveredName = buildRecoveredName(credentialProof, email);
                targetUser = await User.create({
                    email,
                    phone: canonicalPhone,
                    name: recoveredName,
                    isVerified: true,
                });
                audit('SEND_RECOVERED', {
                    phone: canonicalPhone,
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
                                { phone: canonicalPhone, isVerified: true },
                            ],
                        },
                        '_id email phone'
                    ).lean();

                    if (recovered && normalizeEmail(recovered.email) === email && phoneIdentityMatches(recovered.phone, canonicalPhone)) {
                        targetUser = recovered;
                    } else if (recovered) {
                        const reason = normalizeEmail(recovered.email) === email
                            ? `phone mismatch expected ${maskPhoneSuffix(recovered.phone)} after credential recovery`
                            : 'email mismatch for registered phone after credential recovery';
                        if (shouldReturnGenericNonSignupResponse()) {
                            return returnGenericNonSignupResponse({ event: 'SEND_MISMATCH', reason });
                        }
                        return next(new AppError(GENERIC_OTP_VERIFICATION_MESSAGE, 404));
                    }
                } else {
                    throw createError;
                }
            }
        }

        if (!targetUser) {
            const reason = 'verified user not found for login context';
            if (failStrictLoginIdentity(
                'No verified account found for this email and phone number. Please sign up first.',
                404
            )) return;
            if (shouldReturnGenericNonSignupResponse()) {
                return returnGenericNonSignupResponse({ event: 'SEND_404', reason });
            }
            return next(new AppError(GENERIC_OTP_VERIFICATION_MESSAGE, 404));
        }
    }

    await saveAuthProfileSnapshot({
        name: targetUser.name,
        email: targetUser.email || email,
        phone: targetUser.phone || canonicalPhone,
        avatar: targetUser.avatar || '',
        gender: targetUser.gender || '',
        dob: targetUser.dob || null,
        bio: targetUser.bio || '',
        isVerified: purpose === 'signup' ? Boolean(targetUser.isVerified) : true,
        isAdmin: Boolean(targetUser.isAdmin),
    });

    const verifiedBootstrapDeviceSignal = await resolveTrustedDeviceBootstrapSignal({
        req,
        user: targetUser,
        challengePayload: extractTrustedDeviceChallengePayload(req.body || {}),
        expectedScope: BOOTSTRAP_CHALLENGE_SCOPE_BY_PURPOSE[purpose] || '',
        requireFreshProof: Boolean(BOOTSTRAP_CHALLENGE_SCOPE_BY_PURPOSE[purpose]),
    });
    if (verifiedBootstrapDeviceSignal.required && !verifiedBootstrapDeviceSignal.verified) {
        return next(new AppError(
            verifiedBootstrapDeviceSignal.reason || 'Fresh trusted device verification is required.',
            403
        ));
    }

    const requestMeta = {
        ip: clientIp,
        userAgent: req.headers['user-agent'] || '',
        location: String(req.headers['x-client-location'] || '').trim(),
        requestId,
        deviceId: verifiedBootstrapDeviceSignal.deviceId || '',
        deviceSessionHash: verifiedBootstrapDeviceSignal.deviceSessionHash || '',
        deviceMethod: verifiedBootstrapDeviceSignal.method || '',
        credentialUid: String(credentialProof?.uid || credentialProof?.sub || '').trim(),
    };

    // SECURITY: Delete other active OTP purposes for the same canonical identity.
    try {
        await OtpSession.deleteMany({
            identityKey: canonicalPhone,
            purpose: { $ne: purpose },
        });
    } catch (cleanupError) {
        if (!isOtpSessionStorageUnavailableError(cleanupError)) {
            logger.warn('otp.cleanup_other_purposes_failed', {
                userId: String(targetUser._id),
                purpose,
                error: cleanupError.message,
            });
        }
    }

    await upsertOtpSession({
        identityKey: canonicalPhone,
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

    const smsTarget = canonicalPhone;
    let emailDelivered = false;
    let smsDelivered = false;
    let mobileChannel = 'sms';
    const shouldSendSms = !skipSms && shouldAttemptSmsSend();

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
                    createdPendingUser: targetUser,
                    email,
                    canonicalPhone,
                });
                return next(new AppError('Unable to deliver verification code. Please try again later.', 503));
            }

            audit('SEND_EMAIL_FAIL', {
                phone: canonicalPhone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `${failReason} | failClosed=${otpEmailFailClosed}`,
            });
        }
    }

    if (shouldSendSms) {
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
                    createdPendingUser: targetUser,
                    email,
                    canonicalPhone,
                });
                return next(new AppError('Unable to deliver verification code. Please try again later.', 503));
            }

            audit('SEND_SMS_FAIL', {
                phone: canonicalPhone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: `${failReason} | failClosed=${otpSmsFailClosed}`,
            });
        }
    }

    if (!emailDelivered && !smsDelivered) {
        const allowFailOpenNoDelivery = isExplicitNonProdFailOpenPath();

        if (!allowFailOpenNoDelivery) {
            await rollbackOtpStateAfterDeliveryFailure({
                targetUser,
                purpose,
                createdPendingUser: targetUser,
                email,
                canonicalPhone,
            });

            audit('SEND_FAIL', {
                phone,
                email,
                purpose,
                ip: clientIp,
                requestId,
                success: false,
                reason: 'no delivery channel succeeded',
            });

            return next(new AppError('Unable to deliver verification code right now. Please try again shortly.', 503));
        }

        audit('SEND_FAIL_OPEN', {
            phone,
            email,
            purpose,
            ip: clientIp,
            requestId,
            success: true,
            reason: 'no delivery channel succeeded but non-production fail-open override is enabled',
        });
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
    res.json({
        success: true,
        message: purpose === 'login' || purpose === 'forgot-password'
            ? GENERIC_ACCOUNT_RESPONSE_MESSAGE
            : `If deliverable, the OTP has been sent to ${deliveryLabel}.`,
    });
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
    const rawEmail = req.body?.email;
    const rawFactor = req.body?.factor;
    const rawUserId = req.body?.userId;
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
    if (rawEmail !== undefined && rawEmail !== null && rawEmail !== '' && typeof rawEmail !== 'string') {
        return next(new AppError('Email must be a string', 400));
    }
    if (rawFactor !== undefined && rawFactor !== null && rawFactor !== '' && typeof rawFactor !== 'string') {
        return next(new AppError('factor must be a string', 400));
    }
    if (rawUserId !== undefined && rawUserId !== null && rawUserId !== '' && typeof rawUserId !== 'string') {
        return next(new AppError('userId must be a string', 400));
    }

    const phone = normalizePhone(rawPhone);
    const canonicalPhone = canonicalizePhoneIdentity(phone);
    const otp = rawOtp.trim();
    const purpose = normalizePurpose(rawPurpose);
    const email = rawEmail ? normalizeEmail(rawEmail) : '';
    const factor = normalizeOtpFactor(rawFactor);
    const userId = rawUserId ? rawUserId.trim() : '';
    const isEmailFactorOtp = factor === 'email';

    if (!canonicalPhone) {
        return next(new AppError('Valid phone number is required', 400));
    }
    if (!OTP_REGEX.test(otp)) {
        return next(new AppError(`Invalid OTP. Please enter a valid ${OTP_LENGTH}-digit code.`, 400));
    }
    if (email && !EMAIL_REGEX.test(email)) {
        return next(new AppError('Valid email address is required', 400));
    }
    if (userId && !/^[a-f\d]{24}$/i.test(userId)) {
        return next(new AppError('userId format is invalid', 400));
    }

    const purposeIsFormatted = rawPurpose === purpose;
    if (!purposeIsFormatted || !ALLOWED_PURPOSES.includes(purpose)) {
        return next(new AppError('Invalid OTP purpose. Must be: signup, login, forgot-password, or payment-challenge', 400));
    }
    if ((factor && factor !== 'email') || (factor && !EMAIL_FACTOR_PURPOSES.has(purpose))) {
        return next(new AppError('Invalid OTP factor. Email OTP verification is supported for signup, login, and forgot-password only.', 400));
    }
    if (isEmailFactorOtp && !email) {
        return next(new AppError(`Email is required for ${purpose} email OTP verification`, 400));
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

    const phoneLookupCandidates = buildPhoneLookupCandidates(phone, canonicalPhone);
    const user = await User.findOne({ phone: { $in: phoneLookupCandidates } }).select('isVerified ' + OTP_FIELDS);

    if (!user) {
        audit('VERIFY_404', { phone, purpose, ip: clientIp, requestId, success: false, reason: 'user not found' });
        return next(new AppError('No account found with this phone number', 404));
    }

    if (email && normalizeEmail(user.email) !== email) {
        audit('VERIFY_IDENTITY_MISMATCH', {
            phone,
            purpose,
            ip: clientIp,
            requestId,
            success: false,
            reason: 'email mismatch',
        });
        return next(new AppError('OTP identity mismatch for email.', 403));
    }

    if (userId && String(user._id) !== userId) {
        audit('VERIFY_IDENTITY_MISMATCH', {
            phone,
            purpose,
            ip: clientIp,
            requestId,
            success: false,
            reason: 'userId mismatch',
        });
        return next(new AppError('OTP identity mismatch for user.', 403));
    }

    let session = null;
    let otpSessionStorageUnavailable = false;
    try {
        session = await findOtpSessionByIdentity({ identityKey: canonicalPhone, userId: user._id, purpose, includeHash: true });
    } catch (error) {
        if (!isOtpSessionStorageUnavailableError(error)) {
            throw error;
        }
        otpSessionStorageUnavailable = true;
    }

    if (!session) {
        if (user.otpPurpose && user.otpPurpose !== purpose) {
            audit('VERIFY_MISMATCH', {
                phone: canonicalPhone,
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
                phone: canonicalPhone,
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
                    identityKey: canonicalPhone,
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
                anySession = await OtpSession.findOne({ identityKey: canonicalPhone }).lean();
                if (!anySession) {
                    anySession = await OtpSession.findOne({ user: user._id }).lean();
                }
            } catch (error) {
                if (!isOtpSessionStorageUnavailableError(error)) {
                    throw error;
                }
                otpSessionStorageUnavailable = true;
            }
        }
        if (anySession?.purpose && anySession.purpose !== purpose) {
            audit('VERIFY_MISMATCH', {
                phone: canonicalPhone,
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

    if (session.user && String(session.user) !== String(user._id)) {
        audit('VERIFY_IDENTITY_MISMATCH', {
            phone,
            purpose,
            ip: clientIp,
            requestId,
            success: false,
            reason: 'otp session not linked to user',
        });
        return next(new AppError('OTP session identity mismatch.', 403));
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
        await clearOtpSession({ identityKey: canonicalPhone, purpose });
        await clearUserOtpStateByUserId(user._id);
        audit('VERIFY_EXPIRED', { phone, purpose, ip: clientIp, requestId, success: false, reason: 'OTP expired' });
        return next(new AppError('OTP has expired. Please request a new one.', 410));
    }

    const isMatch = session.otpHash ? await compareOtp(otp, session.otpHash) : false;

    if (!isMatch) {
        const newAttempts = Number(session.attempts || 0) + 1;

        if (newAttempts >= MAX_OTP_ATTEMPTS) {
            const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
            await clearOtpSession({ identityKey: canonicalPhone, purpose });

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
                phone: canonicalPhone,
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

    await clearOtpSession({ identityKey: canonicalPhone, purpose });
    const verificationMutation = {
        otp: null,
        otpExpiry: null,
        otpPurpose: null,
        otpAttempts: 0,
        otpLockedUntil: null,
        isVerified: purpose === 'signup'
            ? Boolean(user.isVerified || !isEmailFactorOtp)
            : Boolean(user.isVerified),
    };

    if (isEmailFactorOtp) {
        if (purpose === 'signup') {
            verificationMutation.signupEmailOtpVerifiedAt = new Date();
        } else if (purpose === 'login') {
            verificationMutation.loginEmailOtpVerifiedAt = new Date();
        } else if (purpose === 'forgot-password') {
            verificationMutation.resetEmailOtpVerifiedAt = new Date();
            verificationMutation.resetOtpVerifiedAt = null;
        }
    } else if (purpose === 'signup' || purpose === 'forgot-password') {
        const authAssurance = getAssuranceForPurpose(purpose);
        verificationMutation.authAssurance = authAssurance;
        verificationMutation.authAssuranceAt = new Date();
        verificationMutation.authAssuranceAuthTime = null;
    }

    if (purpose === 'login' && !isEmailFactorOtp) {
        verificationMutation.loginEmailOtpVerifiedAt = null;
        verificationMutation.loginOtpVerifiedAt = new Date();
        verificationMutation.loginOtpAssuranceExpiresAt = new Date(Date.now() + LOGIN_ASSURANCE_TTL_MS);
    } else if (purpose === 'signup' && !isEmailFactorOtp) {
        verificationMutation.signupEmailOtpVerifiedAt = null;
    } else if (purpose === 'forgot-password' && !isEmailFactorOtp) {
        verificationMutation.resetEmailOtpVerifiedAt = null;
        verificationMutation.resetOtpVerifiedAt = new Date();
    }

    await User.updateOne({ _id: user._id }, { $set: verificationMutation });

    await saveAuthProfileSnapshot({
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar || '',
        gender: user.gender || '',
        dob: user.dob || null,
        bio: user.bio || '',
        isVerified: purpose === 'signup'
            ? Boolean(user.isVerified || !isEmailFactorOtp)
            : Boolean(user.isVerified),
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

    const { tokenState, ...publicFlowPayload } = issueOtpFlowToken({
        userId: user._id,
        purpose,
        factor: isEmailFactorOtp ? 'email' : 'otp',
        signalBond: buildOtpFlowSignalBond({
            req,
            session,
            purpose,
        }),
    });
    await registerOtpFlowGrant({
        tokenId: tokenState?.tokenId,
        userId: user._id,
        purpose,
        factor: isEmailFactorOtp ? 'email' : 'otp',
        currentStep: resolveOtpFlowCurrentStep({
            factor: isEmailFactorOtp ? 'email' : 'otp',
        }),
        nextStep: tokenState?.nextStep,
        expiresAt: publicFlowPayload.flowTokenExpiresAt,
    });

    res.json({
        success: true,
        message: isEmailFactorOtp ? 'Email OTP verified successfully' : 'OTP verified successfully',
        verified: true,
        maskedIdentifier: isEmailFactorOtp ? maskEmail(user.email) : maskPhoneSuffix(user.phone),
        ...(isEmailFactorOtp ? { nextFactor: 'phone' } : {}),
        ...publicFlowPayload,
        ...(challengePayload || {}),
    });
});

/**
 * @desc    Reset password after OTP verification
 * @route   POST /api/otp/reset-password
 * @access  Public
 */
const resetPasswordWithOtp = asyncHandler(async (req, res, next) => {
    const rawFlowToken = req.body?.flowToken;
    const rawPassword = req.body?.password;
    const clientIp = extractClientIp(req);
    const requestId = req.requestId || '-';
    const { deviceId } = extractTrustedDeviceContext(req);
    const deviceSessionHash = hashTrustedDeviceSessionToken(getTrustedDeviceSessionToken(req));

    if (rawFlowToken === undefined || rawFlowToken === null || rawFlowToken === '') {
        return next(new AppError('Recovery flow token is required', 400));
    }
    if (rawPassword === undefined || rawPassword === null || rawPassword === '') {
        return next(new AppError('Password is required', 400));
    }

    if (typeof rawFlowToken !== 'string') {
        return next(new AppError('Recovery flow token must be a string', 400));
    }
    if (typeof rawPassword !== 'string') {
        return next(new AppError('Password must be a string', 400));
    }

    const flowToken = rawFlowToken.trim();
    const password = rawPassword;

    if (!flowToken) {
        return next(new AppError('Recovery flow token is required', 400));
    }

    const passwordValidation = validatePasswordPolicy(password);
    if (!passwordValidation.isValid) {
        return next(new AppError(passwordValidation.errors[0], 400));
    }

    const weakPassword = detectWeakPasswordPatterns(password);
    if (weakPassword.isWeak) {
        return next(new AppError(weakPassword.reason || 'Password is too weak', 400));
    }

    const inspectedFlow = inspectOtpFlowToken(flowToken);

    const user = await User.findById(inspectedFlow.sub)
        .select('name email phone avatar gender dob bio isAdmin isVerified trustedDevices +resetOtpVerifiedAt')
        .lean();

    const email = normalizeEmail(user?.email || '');
    const phone = normalizePhone(user?.phone || '');

    if (!user || !user.isVerified || !EMAIL_REGEX.test(email)) {
        audit('RESET_PASSWORD_REJECTED', {
            phone,
            email,
            purpose: 'forgot-password',
            ip: clientIp,
            requestId,
            success: false,
            reason: 'verified account not found for reset',
        });
        return next(new AppError('Password reset verification is required before setting a new password.', 403));
    }

    const verifiedBootstrapDeviceSignal = await resolveTrustedDeviceBootstrapSignal({
        req,
        user,
        challengePayload: extractTrustedDeviceChallengePayload(req.body || {}),
        expectedScope: 'reset-password',
        requireFreshProof: Boolean(inspectedFlow.signalBond.deviceSessionHash),
    });
    if ((verifiedBootstrapDeviceSignal.required || inspectedFlow.signalBond.deviceSessionHash)
        && !verifiedBootstrapDeviceSignal.verified) {
        return next(new AppError(
            verifiedBootstrapDeviceSignal.reason || 'Fresh trusted device verification is required.',
            403
        ));
    }

    const verifiedFlow = verifyOtpFlowToken({
        token: flowToken,
        expectedPurpose: 'forgot-password',
        expectedFactor: inspectedFlow.factor === 'recovery-code' ? 'recovery-code' : 'otp',
        expectedSignalBond: {
            ...(inspectedFlow.signalBond.deviceId
                && (verifiedBootstrapDeviceSignal.deviceId || deviceId)
                ? { deviceId: verifiedBootstrapDeviceSignal.deviceId || deviceId }
                : {}),
            ...(inspectedFlow.signalBond.deviceSessionHash && verifiedBootstrapDeviceSignal.deviceSessionHash
                ? { deviceSessionHash: verifiedBootstrapDeviceSignal.deviceSessionHash }
                : {}),
        },
        expectedNextStep: 'reset-password',
    });

    const resetOtpVerifiedAt = user.resetOtpVerifiedAt
        ? new Date(user.resetOtpVerifiedAt).getTime()
        : 0;
    const resetSessionStillFresh = Number.isFinite(resetOtpVerifiedAt)
        && resetOtpVerifiedAt > 0
        && (Date.now() - resetOtpVerifiedAt) <= RESET_PASSWORD_SESSION_TTL_MS;

    if (!resetSessionStillFresh) {
        if (resetOtpVerifiedAt > 0) {
            await User.updateOne(
                { _id: user._id },
                { $set: { resetOtpVerifiedAt: null } }
            );
        }

        audit('RESET_PASSWORD_REJECTED', {
            phone,
            email,
            purpose: 'forgot-password',
            ip: clientIp,
            requestId,
            success: false,
            reason: resetOtpVerifiedAt > 0 ? 'reset verification expired' : 'reset verification missing',
        });

        return next(new AppError(
            resetOtpVerifiedAt > 0
                ? 'Password reset verification expired. Please request a new OTP.'
                : 'Password reset verification is required before setting a new password.',
            403
        ));
    }

    requireAuthAssurance({
        action: AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE,
        user,
        flow: verifiedFlow,
        trustedDeviceSignal: verifiedBootstrapDeviceSignal,
        deviceSessionHash,
        resetSessionFresh: resetSessionStillFresh,
    });

    await consumeOtpFlowGrant({
        tokenId: verifiedFlow.tokenId,
        userId: verifiedFlow.sub,
        purpose: verifiedFlow.purpose,
        factor: verifiedFlow.factor,
        nextStep: verifiedFlow.nextStep,
    });

    try {
        const authUser = await firebaseAdmin.auth().getUserByEmail(email);
        await firebaseAdmin.auth().updateUser(authUser.uid, { password });
        await firebaseAdmin.auth().revokeRefreshTokens(authUser.uid);
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            audit('RESET_PASSWORD_REJECTED', {
                phone,
                email,
                purpose: 'forgot-password',
                ip: clientIp,
                requestId,
                success: false,
                reason: 'firebase user not found',
            });
            return next(new AppError('Password reset account is not ready. Please contact support.', 404));
        }

        logger.error('otp.reset_password_failed', {
            email: maskEmail(email),
            phone: maskPhoneSuffix(phone),
            requestId,
            error: error?.message || 'unknown',
            code: error?.code || '',
        });

        return next(new AppError('Unable to update password right now. Please try again shortly.', 503));
    }

    await User.updateOne(
        { _id: user._id },
        {
            $set: {
                resetOtpVerifiedAt: null,
                authAssurance: 'password',
                authAssuranceAt: new Date(),
                authAssuranceAuthTime: null,
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
        isVerified: Boolean(user.isVerified),
        isAdmin: Boolean(user.isAdmin),
    });

    audit('RESET_PASSWORD_OK', {
        phone,
        email,
        purpose: 'forgot-password',
        ip: clientIp,
        requestId,
        success: true,
    });

    res.json({
        success: true,
        message: 'Password reset successful. Please sign in with your new password.',
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
    const clientIp = extractClientIp(req);
    const requestId = req.requestId || '-';

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
    const canonicalPhone = canonicalizePhoneIdentity(phone);
    if (!canonicalPhone) {
        return next(new AppError('Valid phone number is required', 400));
    }

    let userExists = false;
    let reason = 'not_found';

    if (email) {
        const [verifiedByEmail, verifiedByPhone] = await Promise.all([
            User.findOne({ email, isVerified: true }, 'email phone').lean(),
            User.findOne({ phone: canonicalPhone, isVerified: true }, 'email phone').lean(),
        ]);

        if (verifiedByEmail && !phoneIdentityMatches(verifiedByEmail.phone, canonicalPhone)) {
            reason = 'phone_mismatch';
        } else if (!verifiedByEmail && verifiedByPhone && normalizeEmail(verifiedByPhone.email) !== email) {
            reason = 'email_mismatch';
        } else {
            userExists = !!(verifiedByEmail || verifiedByPhone);
            reason = userExists ? 'match' : 'not_found';
        }
    } else {
        const user = await User.findOne({ phone: canonicalPhone, isVerified: true }, '_id').lean();
        userExists = !!user;
        reason = userExists ? 'match' : 'not_found';
    }

    audit('CHECK_USER', {
        phone,
        email,
        purpose: 'check-user',
        ip: clientIp,
        requestId,
        success: true,
        reason: userExists ? 'verified user exists' : reason,
    });

    return res.json({ success: true, message: GENERIC_ACCOUNT_DISCOVERY_MESSAGE });
});

module.exports = { sendOtp, verifyOtp, resetPasswordWithOtp, checkUserExists };
