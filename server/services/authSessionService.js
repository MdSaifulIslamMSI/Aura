const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { saveAuthProfileSnapshot } = require('./authProfileVault');
const { awardLoyaltyPoints, getRewardSnapshotFromUser } = require('./loyaltyService');
const { normalizePhoneE164 } = require('./sms');

const PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation addresses cart wishlist loyalty createdAt';
const AUTH_ONLY_PROJECTION = 'name email phone isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt';
const SESSION_PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt';

const PHONE_REGEX = /^\+?\d{10,15}$/;

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

const buildSessionPayload = ({
    authUser = {},
    authToken = null,
    authUid = '',
    user = null,
    status = 'authenticated',
    latticeChallenge = null,
    error = null,
} = {}) => ({
    status,
    latticeChallenge: latticeChallenge || null,
    session: buildSessionIdentity({ authUser, authToken, authUid }),
    profile: toProfilePayload(user),
    roles: toRoleState(user),
    error: error ? { message: String(error?.message || error) } : null,
});

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

    return buildSessionPayload({
        authUser: {
            ...authUser,
            email,
        },
        authToken,
        authUid,
        user,
    });
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
    buildSessionPayload,
    syncAuthenticatedUser,
    resolveAuthenticatedSession,
};
