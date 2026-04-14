const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { saveAuthProfileSnapshot } = require('./authProfileVault');
const { awardLoyaltyPoints, getRewardSnapshotFromUser } = require('./loyaltyService');
const { normalizePhoneE164 } = require('./sms');
const { verifyOtpFlowToken } = require('../utils/otpFlowToken');
const {
    normalizeEmail,
    normalizeUid,
    buildInternalAuthEmail,
    isInternalAuthEmail,
    buildIdentityQuery,
    resolvePublicEmail,
} = require('../utils/authIdentity');

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

const SOCIAL_PROVIDER_REGEX = /google|facebook|twitter|x\.com|github|apple/i;

const resolveProviderIds = ({ authUser = {}, authToken = null } = {}) => {
    const providerIds = Array.isArray(authUser?.providerIds)
        ? authUser.providerIds.map((providerId) => normalizeText(providerId)).filter(Boolean)
        : Array.isArray(authUser?.providerData)
        ? authUser.providerData.map((entry) => normalizeText(entry?.providerId)).filter(Boolean)
        : [];

    const fallbackProvider = normalizeText(
        authUser?.signInProvider || authToken?.firebase?.sign_in_provider
    );
    if (providerIds.length === 0 && fallbackProvider) {
        providerIds.push(fallbackProvider);
    }

    return providerIds;
};

const isTrustedSocialProvider = (providerId = '') => (
    SOCIAL_PROVIDER_REGEX.test(normalizeText(providerId))
);

const shouldTrustProviderVerification = ({ authUser = {}, authToken = null, authUid = '' } = {}) => {
    if (!normalizeUid(authUid || authUser?.uid || authUser?.authUid)) {
        return false;
    }

    return resolveProviderIds({ authUser, authToken }).some(isTrustedSocialProvider);
};

const getDuplicateField = (error) => {
    if (!error || error.code !== 11000) return null;
    if (error.keyPattern?.authUid) return 'authUid';
    if (error.keyPattern?.email) return 'email';
    if (error.keyPattern?.phone) return 'phone';
    return null;
};

const resolveAccountEmail = ({ email = '', authUid = '' } = {}) => (
    normalizeEmail(email) || buildInternalAuthEmail(authUid)
);

const buildUserBootstrapPayload = ({ email, authUid = '', authUser = {} }) => {
    const safeUid = normalizeUid(authUid || authUser.uid || authUser.authUid);
    const safeEmail = resolveAccountEmail({
        email: email || authUser.email,
        authUid: safeUid,
    });
    const safeName = normalizeText(authUser.name || authUser.displayName) || safeEmail.split('@')[0] || 'Aura User';
    const safePhone = canonicalizePhone(authUser.phone || authUser.phoneNumber || authUser.phone_number || '');

    const setOnInsert = {
        email: safeEmail,
        name: safeName,
        isVerified: safeUid
            ? Boolean(authUser.isVerified ?? authUser.emailVerified ?? true)
            : Boolean(authUser.isVerified ?? authUser.emailVerified),
    };

    if (safeUid) {
        setOnInsert.authUid = safeUid;
    }

    if (safePhone) {
        setOnInsert.phone = safePhone;
    }

    return { safeEmail, safeUid, setOnInsert };
};

const bootstrapUserRecord = async ({ email, authUid = '', authUser = {}, projection = PROFILE_PROJECTION, lean = true }) => {
    const { safeEmail, safeUid, setOnInsert } = buildUserBootstrapPayload({ email, authUid, authUser });
    const identityQuery = buildIdentityQuery({ email: safeEmail, authUid: safeUid });
    if (!identityQuery) return null;

    const queryOptions = {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
        projection,
        ...(lean ? { lean: true } : {}),
    };

    try {
        return await User.findOneAndUpdate(
            identityQuery,
            { $setOnInsert: setOnInsert },
            queryOptions
        );
    } catch (error) {
        if (getDuplicateField(error) !== 'phone') {
            throw error;
        }
        const { phone, ...withoutPhone } = setOnInsert;
        return User.findOneAndUpdate(
            identityQuery,
            { $setOnInsert: withoutPhone },
            queryOptions
        );
    }
};

const ensureUserLean = async ({ email, authUid = '', authUser = {}, projection = PROFILE_PROJECTION }) => {
    const safeUid = normalizeUid(authUid || authUser.uid || authUser.authUid);
    const safeEmail = resolveAccountEmail({
        email: email || authUser.email,
        authUid: safeUid,
    });
    const identityQuery = buildIdentityQuery({ email: safeEmail, authUid: safeUid });
    if (!identityQuery) return null;

    const existing = await User.findOne(identityQuery, projection).lean();
    if (existing) return existing;

    return bootstrapUserRecord({
        email: safeEmail,
        authUid: safeUid,
        authUser,
        projection,
        lean: true,
    });
};

const ensureUserDocument = async ({ email, authUid = '', authUser = {} }) => {
    const safeUid = normalizeUid(authUid || authUser.uid || authUser.authUid);
    const safeEmail = resolveAccountEmail({
        email: email || authUser.email,
        authUid: safeUid,
    });
    const identityQuery = buildIdentityQuery({ email: safeEmail, authUid: safeUid });
    if (!identityQuery) return null;

    let user = await User.findOne(identityQuery);
    if (user) return user;

    await bootstrapUserRecord({
        email: safeEmail,
        authUid: safeUid,
        authUser,
        projection: '_id',
        lean: true,
    });

    user = await User.findOne(identityQuery);
    return user;
};

const persistAuthSnapshot = async (user) => {
    const publicEmail = resolvePublicEmail(user?.email);
    if (!publicEmail) return;
    await saveAuthProfileSnapshot({
        name: user.name,
        email: publicEmail,
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

const parseIsoToMillis = (value) => {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const toProfilePayload = (user = null, options = {}) => {
    if (!user) return null;

    const includeCollections = options.includeCollections === true;
    const payload = {
        _id: user._id,
        name: user.name,
        email: resolvePublicEmail(user.email),
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

const buildSessionIdentity = ({ authUser = {}, authToken = null, authUid = '', authSession = null } = {}) => {
    const email = resolvePublicEmail(authToken?.email || authUser.email);
    const phone = canonicalizePhone(authToken?.phone_number || authUser.phoneNumber || authUser.phone || '');
    const providerIds = resolveProviderIds({ authUser, authToken });

    const toIso = (epochSeconds) => {
        const numeric = Number(epochSeconds || 0);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return new Date(numeric * 1000).toISOString();
    };

    if (authSession?.sessionId) {
        return {
            sessionId: normalizeText(authSession.sessionId),
            uid: normalizeText(authSession.firebaseUid || authUid || authUser.uid),
            email: resolvePublicEmail(authSession.email || authToken?.email || authUser.email),
            emailVerified: Boolean(authSession.emailVerified ?? authToken?.email_verified ?? authUser.emailVerified),
            displayName: normalizeText(authSession.displayName || authToken?.name || authUser.displayName || authUser.name),
            phone: canonicalizePhone(authSession.phoneNumber || authToken?.phone_number || authUser.phoneNumber || authUser.phone || ''),
            providerIds: Array.isArray(authSession.providerIds) && authSession.providerIds.length > 0
                ? authSession.providerIds
                : providerIds,
            authTime: toIsoOrNull(authSession.authTime) || toIso(authToken?.auth_time),
            issuedAt: toIsoOrNull(authSession.issuedAt) || toIso(authToken?.iat),
            expiresAt: toIsoOrNull(authSession.firebaseExpiresAt) || toIso(authToken?.exp),
            aal: normalizeText(authSession.aal) || 'aal1',
            amr: Array.isArray(authSession.amr) ? authSession.amr : [],
            deviceId: normalizeText(authSession.deviceId),
            deviceMethod: normalizeText(authSession.deviceMethod),
            riskState: normalizeText(authSession.riskState) || 'standard',
            stepUpUntil: toIsoOrNull(authSession.stepUpUntil),
        };
    }

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
    const authTimeMillis = parseIsoToMillis(session?.authTime);
    const stepUpUntilMillis = parseIsoToMillis(session?.stepUpUntil);
    const now = Date.now();
    const authAgeSeconds = authTimeMillis > 0
        ? Math.max(Math.floor((now - authTimeMillis) / 1000), 0)
        : null;
    const stepUpActive = stepUpUntilMillis > now;
    const deviceBound = Boolean(normalizeText(session?.deviceId));
    const strongDeviceBinding = deviceBound && ['browser_key', 'webauthn'].includes(normalizeText(session?.deviceMethod));
    const privilegedAccount = Boolean(user?.isAdmin || user?.isSeller);
    const elevatedAssurance = assuranceLevel === 'password+otp' || normalizeText(session?.aal) === 'aal2' || stepUpActive;
    const continuousAccess = Boolean(
        session?.sessionId
        && (!privilegedAccount || (elevatedAssurance && (strongDeviceBinding || normalizeText(session?.riskState) === 'standard')))
    );

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
        posture: {
            continuousAccess,
            trustedDeviceBound: strongDeviceBinding,
            device: {
                id: normalizeText(session?.deviceId),
                method: normalizeText(session?.deviceMethod) || 'none',
            },
            session: {
                cookieBound: Boolean(session?.sessionId),
                riskState: normalizeText(session?.riskState) || 'standard',
                aal: normalizeText(session?.aal) || 'aal1',
                authAgeSeconds,
                stepUpActive,
                stepUpUntil: session?.stepUpUntil || null,
            },
            policy: {
                privilegedAccount,
                elevatedAssurance,
                reauthRecommended: privilegedAccount && !elevatedAssurance,
            },
        },
    };
};

const buildSessionPayload = ({
    authUser = {},
    authToken = null,
    authUid = '',
    authSession = null,
    user = null,
    status = 'authenticated',
    deviceChallenge = null,
    error = null,
} = {}) => {
    const session = buildSessionIdentity({ authUser, authToken, authUid, authSession });
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
    const authUid = normalizeUid(authUser?.uid || authUser?.authUid);
    const tokenEmail = normalizeEmail(authUser?.email);
    const providerEmail = isInternalAuthEmail(tokenEmail) ? '' : tokenEmail;
    const requestEmail = normalizeEmail(bodyEmail);
    const normalizedName = normalizeText(name);
    const hasPhoneInput = phone !== undefined && phone !== null && String(phone).trim() !== '';
    const hasProviderEmail = Boolean(providerEmail);
    const accountEmail = resolveAccountEmail({ email: providerEmail, authUid });
    const trustProviderVerification = shouldTrustProviderVerification({ authUser, authUid });
    const emailVerified = trustProviderVerification
        ? true
        : hasProviderEmail
        ? Boolean(authUser?.emailVerified ?? authUser?.isVerified)
        : Boolean(authUid);

    if (!accountEmail) {
        throw new AppError('Authenticated account is missing identity', 400);
    }
    if (requestEmail && hasProviderEmail && requestEmail !== providerEmail) {
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
        const fallbackName = normalizedName || normalizeText(authUser?.name || authUser?.displayName) || accountEmail.split('@')[0] || 'Aura User';
        const setPayload = {
            name: fallbackName,
            isVerified: emailVerified,
        };

        if (hasPhoneInput) {
            setPayload.phone = normalizedPhone;
        }

        user = await User.findOneAndUpdate(
            buildIdentityQuery({ email: accountEmail, authUid }),
            { $set: setPayload, $setOnInsert: { email: accountEmail, ...(authUid ? { authUid } : {}) } },
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
        if (getDuplicateField(error) === 'authUid' || getDuplicateField(error) === 'email') {
            throw new AppError('This social account is already linked to another profile', 409);
        }
        throw error;
    }

    if (user && authUid && user.authUid !== authUid) {
        try {
            user = await User.findOneAndUpdate(
                { _id: user._id },
                { $set: { authUid } },
                {
                    returnDocument: 'after',
                    projection: AUTH_ONLY_PROJECTION,
                    lean: true,
                }
            );
        } catch (error) {
            if (getDuplicateField(error) === 'authUid') {
                throw new AppError('This social account is already linked to another profile', 409);
            }
            throw error;
        }
    }

    if (user && hasProviderEmail && user.email !== accountEmail) {
        try {
            user = await User.findOneAndUpdate(
                { _id: user._id },
                { $set: { email: accountEmail } },
                {
                    returnDocument: 'after',
                    projection: AUTH_ONLY_PROJECTION,
                    lean: true,
                }
            );
        } catch (error) {
            if (getDuplicateField(error) === 'email') {
                throw new AppError('This social account is already linked to another profile', 409);
            }
            throw error;
        }
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
                email: accountEmail,
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
    authSession = null,
}) => {
    const resolvedAuthUid = normalizeUid(authUid || authUser?.uid);
    const email = resolveAccountEmail({
        email: authToken?.email || authUser?.email,
        authUid: resolvedAuthUid,
    });
    if (!email && !resolvedAuthUid) {
        throw new AppError('Authenticated account is missing identity', 401);
    }

    const user = await ensureUserLean({
        email,
        authUid: resolvedAuthUid,
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
                email: resolvePublicEmail(email),
            },
            authToken,
            authUid: resolvedAuthUid,
            authSession,
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
