const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { saveAuthProfileSnapshot } = require('./authProfileVault');
const { awardLoyaltyPoints, getRewardSnapshotFromUser } = require('./loyaltyService');
const { normalizePhoneE164 } = require('./sms');
const { verifyOtpFlowToken } = require('../utils/otpFlowToken');

const PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt trustedDevices +loginOtpAssuranceExpiresAt addresses cart wishlist loyalty createdAt';
const AUTH_ONLY_PROJECTION = 'name email phone isAdmin isVerified isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt trustedDevices +loginOtpAssuranceExpiresAt loyalty createdAt';
const SESSION_PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt trustedDevices +loginOtpAssuranceExpiresAt loyalty createdAt';

const PHONE_REGEX = /^\+?\d{10,15}$/;
const LOGIN_ASSURANCE_TTL_MS = 10 * 60 * 1000;

const normalizePhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const canonicalizePhone = (value) => {
    const normalized = normalizePhone(value);
    if (!normalized || !PHONE_REGEX.test(normalized)) return '';
    try {
        return normalizePhoneE164(normalized);
    } catch {
        return '';
    }
};

const buildPhoneLookupCandidates = (value) => {
    const candidates = new Set();
    const normalizedInput = normalizePhone(value);
    const canonicalPhone = canonicalizePhone(value);

    if (canonicalPhone) {
        candidates.add(canonicalPhone);
        const canonicalDigits = canonicalPhone.replace(/\D/g, '');
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

const normalizeText = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const getDuplicateField = (error) => {
    if (!error || error.code !== 11000) return null;
    if (error.keyPattern?.email) return 'email';
    if (error.keyPattern?.phone) return 'phone';
    return null;
};

const buildUserBootstrapPayload = ({ email, authUser = {} }) => {
    const safeEmail = normalizeEmail(email || authUser.email);
    const safeName = normalizeText(authUser.name || authUser.displayName) || safeEmail.split('@')[0] || 'Aura User';
    const safePhone = canonicalizePhone(authUser.phone || authUser.phoneNumber || authUser.phone_number || '');

    const setOnInsert = {
        email: safeEmail,
        name: safeName,
        isVerified: Boolean(authUser.isVerified ?? authUser.emailVerified),
    };

    if (safePhone) {
        setOnInsert.phone = safePhone;
    }

    return { safeEmail, setOnInsert };
};

const bootstrapUserRecord = async ({ email, authUser = {}, projection = PROFILE_PROJECTION, lean = true }) => {
    const { safeEmail, setOnInsert } = buildUserBootstrapPayload({ email, authUser });
    if (!safeEmail) return null;

    const queryOptions = {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
        projection,
        ...(lean ? { lean: true } : {}),
    };

    try {
        return await User.findOneAndUpdate(
            { email: safeEmail },
            { $setOnInsert: setOnInsert },
            queryOptions
        );
    } catch (error) {
        if (getDuplicateField(error) !== 'phone') {
            throw error;
        }
        const { phone, ...withoutPhone } = setOnInsert;
        return User.findOneAndUpdate(
            { email: safeEmail },
            { $setOnInsert: withoutPhone },
            queryOptions
        );
    }
};

const ensureUserLean = async ({ email, authUser = {}, projection = PROFILE_PROJECTION }) => {
    const safeEmail = normalizeEmail(email || authUser.email);
    if (!safeEmail) return null;

    const existing = await User.findOne({ email: safeEmail }, projection).lean();
    if (existing) return existing;

    return bootstrapUserRecord({
        email: safeEmail,
        authUser,
        projection,
        lean: true,
    });
};

const ensureUserDocument = async ({ email, authUser = {} }) => {
    const safeEmail = normalizeEmail(email || authUser.email);
    if (!safeEmail) return null;

    let user = await User.findOne({ email: safeEmail });
    if (user) return user;

    await bootstrapUserRecord({
        email: safeEmail,
        authUser,
        projection: '_id',
        lean: true,
    });

    user = await User.findOne({ email: safeEmail });
    return user;
};

const persistAuthSnapshot = async (user) => {
    if (!user?.email) return;
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
        isSeller: Boolean(user.isSeller),
    });
};

const toRoleState = (user = null) => ({
    isAdmin: Boolean(user?.isAdmin),
    isSeller: Boolean(user?.isSeller),
    isVerified: Boolean(user?.isVerified),
});

const toIsoOrNull = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toProfilePayload = (user = null, options = {}) => {
    if (!user) return null;

    const includeCollections = options.includeCollections === true;
    const payload = {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar || '',
        gender: user.gender || '',
        dob: user.dob || null,
        bio: user.bio || '',
        isAdmin: Boolean(user.isAdmin),
        isVerified: Boolean(user.isVerified),
        isSeller: Boolean(user.isSeller),
        sellerActivatedAt: user.sellerActivatedAt || null,
        accountState: user.accountState || 'active',
        moderation: {
            warningCount: Number(user.moderation?.warningCount || 0),
            lastWarningAt: user.moderation?.lastWarningAt || null,
            lastWarningReason: user.moderation?.lastWarningReason || '',
            suspensionCount: Number(user.moderation?.suspensionCount || 0),
            suspendedAt: user.moderation?.suspendedAt || null,
            suspendedUntil: user.moderation?.suspendedUntil || null,
            suspensionReason: user.moderation?.suspensionReason || '',
            reactivatedAt: user.moderation?.reactivatedAt || null,
            deletedAt: user.moderation?.deletedAt || null,
            deleteReason: user.moderation?.deleteReason || '',
        },
        loyalty: getRewardSnapshotFromUser(user),
        createdAt: user.createdAt || null,
    };

    if (includeCollections) {
        payload.addresses = user.addresses || [];
        payload.cart = options.cart || user.cart || [];
        payload.wishlist = user.wishlist || [];
    }

    return payload;
};

const buildSessionIdentity = ({ authUser = {}, authToken = null, authUid = '' } = {}) => {
    const email = normalizeEmail(authToken?.email || authUser.email);
    const phone = canonicalizePhone(authToken?.phone_number || authUser.phoneNumber || authUser.phone || '');
    const providerIds = Array.isArray(authUser?.providerData)
        ? authUser.providerData.map((entry) => normalizeText(entry?.providerId)).filter(Boolean)
        : [];

    const fallbackProvider = normalizeText(authToken?.firebase?.sign_in_provider);
    if (providerIds.length === 0 && fallbackProvider) {
        providerIds.push(fallbackProvider);
    }

    const toIso = (epochSeconds) => {
        const numeric = Number(epochSeconds || 0);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return new Date(numeric * 1000).toISOString();
    };

    return {
        uid: normalizeText(authUid || authUser.uid),
        email,
        emailVerified: Boolean(authToken?.email_verified ?? authUser.emailVerified),
        displayName: normalizeText(authToken?.name || authUser.displayName || authUser.name),
        phone: phone || '',
        providerIds,
        authTime: toIso(authToken?.auth_time),
        issuedAt: toIso(authToken?.iat),
        expiresAt: toIso(authToken?.exp),
    };
};

const toSessionIntelligence = (user = null, session = null) => {
    const assuranceLevel = normalizeText(user?.authAssurance) || 'none';
    const providerIds = Array.isArray(session?.providerIds) ? session.providerIds : [];
    const assuranceExpiresAt = toIsoOrNull(user?.loginOtpAssuranceExpiresAt);

    return {
        assurance: {
            level: assuranceLevel,
            label: assuranceLevel === 'password+otp'
                ? 'Strong verification'
                : assuranceLevel === 'otp'
                    ? 'OTP verified'
                    : assuranceLevel === 'password'
                        ? 'Password verified'
                        : 'Standard session',
            verifiedAt: toIsoOrNull(user?.authAssuranceAt),
            expiresAt: assuranceExpiresAt,
            isRecent: Boolean(
                assuranceExpiresAt
                    ? new Date(assuranceExpiresAt).getTime() > Date.now()
                    : user?.authAssuranceAt
            ),
        },
        readiness: {
            hasVerifiedEmail: Boolean(user?.isVerified || session?.emailVerified),
            hasPhone: Boolean(user?.phone || session?.phone),
            accountState: user?.accountState || 'active',
            isPrivileged: Boolean(user?.isAdmin || user?.isSeller),
        },
        acceleration: {
            suggestedRoute: providerIds.some((providerId) => /google|facebook|twitter|x\.com/i.test(providerId))
                ? 'social'
                : assuranceLevel === 'password+otp'
                    ? 'password+otp'
                    : 'password',
            rememberedIdentifier: Boolean(user?.phone || session?.phone) ? 'email+phone' : 'email',
            suggestedProvider: normalizeText(providerIds[0] || ''),
            providerIds,
        },
    };
};

const buildSessionPayload = ({
    authUser = {},
    authToken = null,
    authUid = '',
    user = null,
    status = 'authenticated',
    deviceChallenge = null,
    error = null,
} = {}) => {
    const session = buildSessionIdentity({ authUser, authToken, authUid });
    return {
        status,
        deviceChallenge: deviceChallenge || null,
        session,
        intelligence: toSessionIntelligence(user, session),
        profile: toProfilePayload(user),
        roles: toRoleState(user),
        error: error ? { message: String(error?.message || error) } : null,
    };
};

const resolveAuthTimeSeconds = (authToken = null) => {
    const authTime = Number(authToken?.auth_time || 0);
    return Number.isFinite(authTime) && authTime > 0 ? authTime : 0;
};

const applyLoginAssuranceToSession = async ({
    user = null,
    flowToken = '',
    authToken = null,
    phone = '',
}) => {
    if (!user?._id || !flowToken) {
        return user;
    }

    const verifiedFlow = verifyOtpFlowToken({
        token: flowToken,
        expectedPurpose: 'login',
        expectedSubject: user._id,
    });

    const authTimeSeconds = resolveAuthTimeSeconds(authToken);
    if (!authTimeSeconds) {
        throw new AppError('Fresh login is required before secure access can be granted.', 401);
    }

    const flowFactor = normalizeText(verifiedFlow.factor || 'otp');
    const verifiedPhone = canonicalizePhone(authToken?.phone_number || '');
    const requestedPhone = canonicalizePhone(phone || user.phone || '');

    if (flowFactor === 'email') {
        if (!verifiedPhone) {
            throw new AppError('Firebase phone verification is required before completing secure sign-in.', 403);
        }
        if (requestedPhone && verifiedPhone !== requestedPhone) {
            throw new AppError('Verified phone number does not match the requested login phone.', 403);
        }
    }

    const now = new Date();

    return User.findOneAndUpdate(
        { _id: user._id },
        {
            $set: {
                authAssurance: 'password+otp',
                authAssuranceAt: now,
                authAssuranceAuthTime: authTimeSeconds,
                loginEmailOtpVerifiedAt: null,
                loginOtpVerifiedAt: now,
                loginOtpAssuranceExpiresAt: new Date(now.getTime() + LOGIN_ASSURANCE_TTL_MS),
                ...(flowFactor === 'email' && verifiedPhone ? { phone: requestedPhone || verifiedPhone } : {}),
            },
        },
        {
            returnDocument: 'after',
            projection: AUTH_ONLY_PROJECTION,
            lean: true,
        }
    );
};

const syncAuthenticatedUser = async ({
    authUser = {},
    email: bodyEmail,
    name,
    phone,
    awardLoginPoints = true,
}) => {
    const tokenEmail = normalizeEmail(authUser?.email);
    const requestEmail = normalizeEmail(bodyEmail);
    const normalizedName = normalizeText(name);
    const hasPhoneInput = phone !== undefined && phone !== null && String(phone).trim() !== '';
    const emailVerified = Boolean(authUser?.emailVerified ?? authUser?.isVerified);

    if (!tokenEmail) {
        throw new AppError('Email is required', 400);
    }
    if (requestEmail && requestEmail !== tokenEmail) {
        throw new AppError('Email in request does not match authenticated account', 400);
    }
    if (!emailVerified) {
        throw new AppError('Email verification is required before session sync', 403);
    }

    let normalizedPhone = '';
    if (hasPhoneInput) {
        if (typeof phone !== 'string') {
            throw new AppError('Phone number must be a string', 400);
        }
        normalizedPhone = canonicalizePhone(phone);
        if (!normalizedPhone) {
            throw new AppError('Valid phone number is required', 400);
        }

        const phoneConflict = await User.findOne(
            {
                email: { $ne: tokenEmail },
                phone: { $in: buildPhoneLookupCandidates(normalizedPhone) },
            },
            'email phone'
        ).lean();

        if (phoneConflict) {
            throw new AppError('Phone number is already linked to another account', 409);
        }
    }

    let user;
    try {
        const fallbackName = normalizedName || normalizeText(authUser?.name || authUser?.displayName) || tokenEmail.split('@')[0] || 'Aura User';
        const setPayload = {
            name: fallbackName,
            isVerified: emailVerified,
        };

        if (hasPhoneInput) {
            setPayload.phone = normalizedPhone;
        }

        user = await User.findOneAndUpdate(
            { email: tokenEmail },
            { $set: setPayload, $setOnInsert: { email: tokenEmail } },
            {
                returnDocument: 'after',
                upsert: true,
                setDefaultsOnInsert: true,
                projection: AUTH_ONLY_PROJECTION,
                lean: true,
            }
        );
    } catch (error) {
        if (getDuplicateField(error) === 'phone') {
            throw new AppError('Phone number is already linked to another account', 409);
        }
        throw error;
    }

    if (!user) {
        throw new AppError('Unable to initialize user profile', 500);
    }

    if (awardLoginPoints) {
        try {
            await awardLoyaltyPoints({
                userId: user._id,
                action: 'daily_login',
            });
            user = await User.findById(user._id, AUTH_ONLY_PROJECTION).lean();
        } catch (rewardError) {
            logger.warn('loyalty.daily_login_award_failed', {
                email: tokenEmail,
                userId: String(user._id || ''),
                error: rewardError.message,
            });
        }
    }

    await persistAuthSnapshot(user);
    return user;
};

const resolveAuthenticatedSession = async ({
    authUser = {},
    authToken = null,
    authUid = '',
}) => {
    const email = normalizeEmail(authToken?.email || authUser?.email);
    if (!email) {
        throw new AppError('Authenticated account is missing email', 401);
    }

    const user = await ensureUserLean({
        email,
        authUser,
        projection: SESSION_PROFILE_PROJECTION,
    });

    if (!user) {
        throw new AppError('Unable to recover user session', 500);
    }

    await persistAuthSnapshot(user);

    return {
        user,
        payload: buildSessionPayload({
            authUser: {
                ...authUser,
                email,
            },
            authToken,
            authUid,
            user,
        }),
    };
};

module.exports = {
    PROFILE_PROJECTION,
    AUTH_ONLY_PROJECTION,
    SESSION_PROFILE_PROJECTION,
    PHONE_REGEX,
    normalizePhone,
    normalizeText,
    normalizeEmail,
    getDuplicateField,
    bootstrapUserRecord,
    ensureUserLean,
    ensureUserDocument,
    persistAuthSnapshot,
    toRoleState,
    toProfilePayload,
    toSessionIntelligence,
    buildSessionPayload,
    syncAuthenticatedUser,
    resolveAuthenticatedSession,
    applyLoginAssuranceToSession,
};
