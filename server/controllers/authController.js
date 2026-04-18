const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const {
    buildSessionPayload,
    persistAuthSnapshot,
    resolveAuthenticatedSession,
    syncAuthenticatedUser,
    applyLoginAssuranceToSession,
} = require('../services/authSessionService');
const { normalizePhoneE164 } = require('../services/sms');
const { invalidateUserCache, invalidateUserCacheByEmail } = require('../middleware/authMiddleware');
const { validatePasswordPolicy, detectWeakPasswordPatterns } = require('../utils/passwordValidator');
const AppError = require('../utils/AppError');
const {
    TRUSTED_DEVICE_SESSION_HEADER,
    extractTrustedDeviceContext,
    issueTrustedDeviceChallenge,
    verifyTrustedDeviceChallenge,
    verifyTrustedDeviceSession,
} = require('../services/trustedDeviceChallengeService');
const {
    clearBrowserSessionCookie,
    getBrowserSessionFromRequest,
    refreshBrowserSession,
    revokeBrowserSession,
} = require('../services/browserSessionService');
const {
    resolveProviderIds,
    resolveEmailVerifiedState,
} = require('../utils/authIdentity');
const { shouldRequireTrustedDevice } = require('../config/authTrustedDeviceFlags');
const LOGIN_ASSURANCE_TTL_MS = 10 * 60 * 1000;
const PHONE_FACTOR_ASSURANCE_TTL_MS = 10 * 60 * 1000;

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const canonicalizePhone = (value) => {
    try {
        return normalizePhoneE164(value);
    } catch {
        return '';
    }
};

const normalizePhoneFactorPurpose = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['signup', 'forgot-password'].includes(normalized)) {
        return normalized;
    }
    return '';
};

const resolveVerifiedAtMillis = (value) => {
    if (!value) return 0;
    const resolved = new Date(value).getTime();
    return Number.isFinite(resolved) ? resolved : 0;
};

const resolveTrustedDeviceSessionToken = (req = {}) => String(
    req.get?.(TRUSTED_DEVICE_SESSION_HEADER)
    || req.headers?.[TRUSTED_DEVICE_SESSION_HEADER]
    || ''
).trim();

const hasSessionTrustedDeviceState = (req = {}, deviceId = '') => {
    const normalizedDeviceId = String(deviceId || '').trim();
    const sessionDeviceId = String(req.authSession?.deviceId || '').trim();
    const sessionDeviceMethod = String(req.authSession?.deviceMethod || '').trim().toLowerCase();
    const sessionAmr = Array.isArray(req.authSession?.amr)
        ? req.authSession.amr.map((entry) => String(entry || '').trim().toLowerCase())
        : [];

    if (!normalizedDeviceId || !sessionDeviceId || normalizedDeviceId !== sessionDeviceId) {
        return false;
    }

    if (sessionDeviceMethod === 'webauthn' || sessionDeviceMethod === 'browser_key') {
        return true;
    }

    return sessionAmr.includes('webauthn') || sessionAmr.includes('trusted_device');
};

const persistBrowserSessionForUser = async ({
    req,
    res,
    user,
    rotate = false,
    deviceMethod = '',
    stepUpUntil = null,
    additionalAmr = [],
} = {}) => {
    if (!user?._id) {
        return null;
    }

    const nextSession = await refreshBrowserSession({
        req,
        res,
        currentSession: req.authSession || null,
        user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceMethod,
        stepUpUntil,
        additionalAmr,
        rotate,
    });

    req.authSession = nextSession;
    return nextSession;
};

const establishSessionCookie = asyncHandler(async (req, res, next) => {
    if (req.authSession?.sessionId || !req.user?._id || !req.authToken) {
        return next();
    }

    await persistBrowserSessionForUser({
        req,
        res,
        user: req.user,
        rotate: false,
    });

    return next();
});

const resolveDeviceChallengeState = async ({
    req,
    authUser = {},
    authToken = null,
    authUid = '',
    user = null,
}) => {
    if (!shouldRequireTrustedDevice({ user })) {
        return { status: 'authenticated', deviceChallenge: null };
    }

    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) {
        throw new AppError('Trusted device identity is required for this account. Refresh and try again.', 400);
    }

    const trustedDeviceSession = verifyTrustedDeviceSession({
        user,
        authUid,
        authToken,
        deviceId,
        deviceSessionToken: resolveTrustedDeviceSessionToken(req),
    });

    if (trustedDeviceSession.success) {
        return { status: 'authenticated', deviceChallenge: null };
    }

    if (hasSessionTrustedDeviceState(req, deviceId)) {
        return { status: 'authenticated', deviceChallenge: null };
    }

    const deviceChallenge = await issueTrustedDeviceChallenge({
        req,
        user,
        authUid,
        authToken,
        deviceId,
        deviceLabel,
    });

    return {
        status: 'device_challenge_required',
        deviceChallenge,
    };
};

const buildRequestAuthUser = (req) => ({
    ...req.user,
    uid: req.authUid || req.authIdentity?.uid || '',
    email: req.authIdentity?.email || req.authToken?.email || req.user?.email || '',
    displayName: req.authIdentity?.displayName || req.authToken?.name || req.user?.name || '',
    phoneNumber: req.authIdentity?.phoneNumber || req.authToken?.phone_number || req.user?.phone || '',
    emailVerified: resolveEmailVerifiedState({
        authUser: req.authIdentity || {},
        authToken: req.authToken || null,
        authSession: req.authSession || null,
        authUid: req.authUid || '',
        user: req.user || null,
    }),
    signInProvider: req.authToken?.firebase?.sign_in_provider || '',
    providerIds: resolveProviderIds({
        authUser: req.authIdentity || {},
        authToken: req.authToken || null,
        authSession: req.authSession || null,
    }),
});

const getSession = asyncHandler(async (req, res) => {
    const resolved = await resolveAuthenticatedSession({
        authUser: buildRequestAuthUser(req),
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
    });

    const { status, deviceChallenge } = await resolveDeviceChallengeState({
        req,
        authUser: buildRequestAuthUser(req),
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        user: resolved.user,
    });

    res.json({
        ...resolved.payload,
        status,
        deviceChallenge,
    });
});

const syncSession = asyncHandler(async (req, res) => {
    const authUser = buildRequestAuthUser(req);
    const flowToken = typeof req.body?.flowToken === 'string'
        ? req.body.flowToken.trim()
        : '';

    let user = await syncAuthenticatedUser({
        authUser,
        email: req.body?.email,
        name: req.body?.name,
        phone: req.body?.phone,
        awardLoginPoints: true,
    });

    if (flowToken) {
        user = await applyLoginAssuranceToSession({
            user,
            flowToken,
            authToken: req.authToken || null,
            phone: req.body?.phone,
        });
    }

    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(user?.email || authUser.email || '');

    const { status, deviceChallenge } = await resolveDeviceChallengeState({
        req,
        authUser,
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        user,
    });

    await persistBrowserSessionForUser({
        req,
        res,
        user,
        rotate: Boolean(req.authSession?.sessionId),
        stepUpUntil: user?.loginOtpAssuranceExpiresAt || null,
        additionalAmr: String(user?.authAssurance || '').trim() === 'password+otp' ? ['otp'] : [],
    });

    res.json(buildSessionPayload({
        authUser,
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
        user,
        status,
        deviceChallenge,
    }));
});

const completePhoneFactorLogin = asyncHandler(async (req, res) => {
    const authUser = buildRequestAuthUser(req);
    const tokenEmail = normalizeEmail(req.authToken?.email || authUser.email);
    const requestEmail = normalizeEmail(req.body?.email);
    const requestPhone = canonicalizePhone(req.body?.phone);
    const verifiedTokenPhone = canonicalizePhone(req.authToken?.phone_number || authUser.phoneNumber);

    if (!requestEmail) {
        throw new AppError('Email is required', 400);
    }
    if (!requestPhone) {
        throw new AppError('Valid phone number is required', 400);
    }
    if (!tokenEmail || tokenEmail !== requestEmail) {
        throw new AppError('Email in request does not match authenticated account', 400);
    }
    if (!verifiedTokenPhone) {
        throw new AppError('Firebase phone verification is required before completing login.', 403);
    }
    if (verifiedTokenPhone !== requestPhone) {
        throw new AppError('Verified phone number does not match the requested login phone.', 403);
    }

    const existingUser = await User.findOne(
        { email: tokenEmail },
        'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt'
    )
        .select('+loginEmailOtpVerifiedAt')
        .lean();

    if (!existingUser) {
        throw new AppError('User profile missing from login database. Please sign in again to recover your account.', 404);
    }

    const emailOtpVerifiedAt = existingUser.loginEmailOtpVerifiedAt
        ? new Date(existingUser.loginEmailOtpVerifiedAt).getTime()
        : 0;
    const emailOtpStillFresh = Number.isFinite(emailOtpVerifiedAt)
        && emailOtpVerifiedAt > 0
        && (Date.now() - emailOtpVerifiedAt) <= LOGIN_ASSURANCE_TTL_MS;

    if (!emailOtpStillFresh) {
        if (emailOtpVerifiedAt > 0) {
            await User.updateOne(
                { email: tokenEmail },
                { $set: { loginEmailOtpVerifiedAt: null } }
            );
        }
        throw new AppError(
            emailOtpVerifiedAt > 0
                ? 'Email OTP verification expired. Please restart secure sign-in.'
                : 'Email OTP verification is required before completing phone factor login.',
            403
        );
    }

    const storedPhone = canonicalizePhone(existingUser.phone || '');
    if (storedPhone && storedPhone !== requestPhone) {
        throw new AppError('Phone number does not match your registered account.', 403);
    }

    const updatedUser = await User.findOneAndUpdate(
        { email: tokenEmail },
        {
            $set: {
                phone: storedPhone || requestPhone,
                isVerified: Boolean(existingUser.isVerified || req.authToken?.email_verified),
                authAssurance: 'password+otp',
                authAssuranceAt: new Date(),
                authAssuranceAuthTime: Number(req.authToken?.auth_time || 0) || null,
                loginEmailOtpVerifiedAt: null,
                loginOtpVerifiedAt: new Date(),
                loginOtpAssuranceExpiresAt: new Date(Date.now() + LOGIN_ASSURANCE_TTL_MS),
            },
        },
        {
            returnDocument: 'after',
            projection: 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt',
            lean: true,
        }
    );

    await persistAuthSnapshot(updatedUser);
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(tokenEmail);

    await persistBrowserSessionForUser({
        req,
        res,
        user: updatedUser,
        rotate: Boolean(req.authSession?.sessionId),
        stepUpUntil: updatedUser?.loginOtpAssuranceExpiresAt || null,
        additionalAmr: ['otp'],
    });

    res.json(buildSessionPayload({
        authUser: {
            ...authUser,
            email: tokenEmail,
            phoneNumber: requestPhone,
            phone: requestPhone,
        },
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
        user: updatedUser,
    }));
});

const completePhoneFactorVerification = asyncHandler(async (req, res) => {
    const purpose = normalizePhoneFactorPurpose(req.body?.purpose);
    const requestEmail = normalizeEmail(req.body?.email);
    const requestPhone = canonicalizePhone(req.body?.phone);
    const verifiedTokenPhone = canonicalizePhone(req.authToken?.phone_number || '');

    if (!purpose) {
        throw new AppError('Invalid phone factor purpose. Must be signup or forgot-password.', 400);
    }
    if (!requestEmail) {
        throw new AppError('Email is required', 400);
    }
    if (!requestPhone) {
        throw new AppError('Valid phone number is required', 400);
    }
    if (!verifiedTokenPhone) {
        throw new AppError('Firebase phone verification is required before continuing.', 403);
    }
    if (verifiedTokenPhone !== requestPhone) {
        throw new AppError('Verified phone number does not match the requested phone.', 403);
    }

    if (purpose === 'signup') {
        const pendingUser = await User.findOne(
            { email: requestEmail },
            'name email phone avatar gender dob bio isAdmin isVerified'
        )
            .select('+signupEmailOtpVerifiedAt')
            .lean();

        if (!pendingUser) {
            throw new AppError('Signup email verification is required before completing phone verification.', 403);
        }
        if (pendingUser.isVerified) {
            throw new AppError('An account with this email already exists. Please sign in.', 409);
        }

        const emailOtpVerifiedAt = resolveVerifiedAtMillis(pendingUser.signupEmailOtpVerifiedAt);
        const emailOtpStillFresh = emailOtpVerifiedAt > 0
            && (Date.now() - emailOtpVerifiedAt) <= PHONE_FACTOR_ASSURANCE_TTL_MS;

        if (!emailOtpStillFresh) {
            if (emailOtpVerifiedAt > 0) {
                await User.updateOne(
                    { email: requestEmail, isVerified: false },
                    { $set: { signupEmailOtpVerifiedAt: null } }
                );
            }
            throw new AppError(
                emailOtpVerifiedAt > 0
                    ? 'Signup email verification expired. Please restart signup.'
                    : 'Signup email verification is required before completing phone verification.',
                403
            );
        }

        const storedPhone = canonicalizePhone(pendingUser.phone || '');
        if (storedPhone && storedPhone !== requestPhone) {
            throw new AppError('Phone number does not match your pending signup.', 403);
        }

        const updatedUser = await User.findOneAndUpdate(
            { email: requestEmail, isVerified: false },
            {
                $set: {
                phone: storedPhone || requestPhone,
                isVerified: true,
                authAssurance: 'otp',
                authAssuranceAt: new Date(),
                authAssuranceAuthTime: null,
                signupEmailOtpVerifiedAt: null,
            },
            },
            {
                returnDocument: 'after',
                projection: 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt',
                lean: true,
            }
        );

        if (!updatedUser) {
            throw new AppError('Signup session expired. Please restart signup.', 409);
        }

        await persistAuthSnapshot(updatedUser);
        await invalidateUserCacheByEmail(requestEmail);

        return res.json({
            success: true,
            message: 'Firebase phone verification completed for signup.',
            purpose,
            phone: updatedUser.phone,
        });
    }

    const existingUser = await User.findOne(
        { email: requestEmail, isVerified: true },
        'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt'
    )
        .select('+resetEmailOtpVerifiedAt')
        .lean();

    if (!existingUser) {
        throw new AppError('Password recovery email verification is required before completing phone verification.', 403);
    }

    const emailOtpVerifiedAt = resolveVerifiedAtMillis(existingUser.resetEmailOtpVerifiedAt);
    const emailOtpStillFresh = emailOtpVerifiedAt > 0
        && (Date.now() - emailOtpVerifiedAt) <= PHONE_FACTOR_ASSURANCE_TTL_MS;

    if (!emailOtpStillFresh) {
        if (emailOtpVerifiedAt > 0) {
            await User.updateOne(
                { email: requestEmail, isVerified: true },
                { $set: { resetEmailOtpVerifiedAt: null } }
            );
        }
        throw new AppError(
            emailOtpVerifiedAt > 0
                ? 'Password recovery email verification expired. Please restart recovery.'
                : 'Password recovery email verification is required before completing phone verification.',
            403
        );
    }

    const storedPhone = canonicalizePhone(existingUser.phone || '');
    if (storedPhone && storedPhone !== requestPhone) {
        throw new AppError('Phone number does not match your registered account.', 403);
    }

    const updatedUser = await User.findOneAndUpdate(
        { email: requestEmail, isVerified: true },
        {
            $set: {
                phone: storedPhone || requestPhone,
                authAssurance: 'otp',
                authAssuranceAt: new Date(),
                authAssuranceAuthTime: null,
                resetEmailOtpVerifiedAt: null,
                resetOtpVerifiedAt: new Date(),
            },
        },
        {
            returnDocument: 'after',
            projection: 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt',
            lean: true,
        }
    );

    await persistAuthSnapshot(updatedUser);
    await invalidateUserCacheByEmail(requestEmail);

    return res.json({
        success: true,
        message: 'Firebase phone verification completed for password recovery.',
        purpose,
        phone: updatedUser.phone,
    });
});

// @desc    Verify trusted device proof
// @route   POST /api/auth/verify-device
// @access  Private
const verifyDeviceChallenge = asyncHandler(async (req, res) => {
    const {
        token,
        method,
        proof,
        publicKeySpkiBase64,
        credential,
    } = req.body;
    if (!token || (!proof && !credential)) {
        throw new AppError('Trusted device token and proof or passkey credential are required', 400);
    }

    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) {
        throw new AppError('Trusted device identity is missing', 400);
    }

    const verification = await verifyTrustedDeviceChallenge({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        token,
        method,
        proof,
        deviceId,
        deviceLabel,
        publicKeySpkiBase64,
        credential,
    });

    if (!verification.success) {
        throw new AppError(`Trusted device verification failed: ${verification.reason}`, 403);
    }

    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');

    await persistBrowserSessionForUser({
        req,
        res,
        user: req.user,
        rotate: Boolean(req.authSession?.sessionId),
        deviceMethod: verification.method === 'webauthn' ? 'webauthn' : 'browser_key',
        stepUpUntil: verification.expiresAt || null,
        additionalAmr: [verification.method === 'webauthn' ? 'webauthn' : 'trusted_device'],
    });

    const sessionPayload = buildSessionPayload({
        authUser: buildRequestAuthUser(req),
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
        user: req.user,
        status: 'authenticated',
        deviceChallenge: null,
    });

    res.json({
        success: true,
        message: verification.mode === 'enroll'
            ? 'Trusted device registered and verified'
            : 'Trusted device verified',
        ...sessionPayload,
        ...verification,
        status: 'authenticated',
        deviceChallenge: null,
    });
});

const logoutSession = asyncHandler(async (req, res) => {
    let existingSession = req.authSession?.sessionId
        ? req.authSession
        : null;

    if (!existingSession) {
        try {
            existingSession = await getBrowserSessionFromRequest(req);
        } catch (error) {
            if (!(error instanceof AppError) || error.statusCode !== 503) {
                throw error;
            }
        }
    }

    if (existingSession?.sessionId) {
        await revokeBrowserSession(existingSession.sessionId);
    }
    clearBrowserSessionCookie(res, req);
    res.json({
        success: true,
        status: 'signed_out',
    });
});

module.exports = {
    establishSessionCookie,
    getSession,
    syncSession,
    logoutSession,
    completePhoneFactorLogin,
    completePhoneFactorVerification,
    verifyDeviceChallenge,
};
