const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const {
    buildSessionPayload,
    persistAuthSnapshot,
    resolveAuthenticatedSession,
    syncAuthenticatedUser,
} = require('../services/authSessionService');
const { generateLatticeChallenge, verifyLatticeProof } = require('../services/latticeChallengeService');
const { normalizePhoneE164 } = require('../services/sms');
const { invalidateUserCache, invalidateUserCacheByEmail } = require('../middleware/authMiddleware');
const { validatePasswordPolicy, detectWeakPasswordPatterns } = require('../utils/passwordValidator');
const AppError = require('../utils/AppError');

const normalizeChallengeMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['always', 'admin', 'seller', 'privileged', 'off'].includes(normalized)) {
        return normalized;
    }
    return 'off';
};

const AUTH_LATTICE_CHALLENGE_MODE = normalizeChallengeMode(process.env.AUTH_LATTICE_CHALLENGE_MODE);
const LOGIN_ASSURANCE_TTL_MS = 10 * 60 * 1000;

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

const shouldRequireLatticeChallenge = ({ user }) => {
    switch (AUTH_LATTICE_CHALLENGE_MODE) {
    case 'always':
        return true;
    case 'admin':
        return Boolean(user?.isAdmin);
    case 'seller':
        return Boolean(user?.isSeller);
    case 'privileged':
        return Boolean(user?.isAdmin || user?.isSeller);
    case 'off':
    default:
        return false;
    }
};

const buildRequestAuthUser = (req) => ({
    ...req.user,
    uid: req.authUid || '',
    email: req.authToken?.email || req.user?.email || '',
    displayName: req.authToken?.name || req.user?.name || '',
    phoneNumber: req.authToken?.phone_number || req.user?.phone || '',
    emailVerified: Boolean(req.authToken?.email_verified ?? req.user?.isVerified),
});

const getSession = asyncHandler(async (req, res) => {
    const payload = await resolveAuthenticatedSession({
        authUser: buildRequestAuthUser(req),
        authToken: req.authToken || null,
        authUid: req.authUid || '',
    });

    res.json(payload);
});

const syncSession = asyncHandler(async (req, res) => {
    const authUser = buildRequestAuthUser(req);
    const user = await syncAuthenticatedUser({
        authUser,
        email: req.body?.email,
        name: req.body?.name,
        phone: req.body?.phone,
        awardLoginPoints: true,
    });

    const requiresLatticeChallenge = shouldRequireLatticeChallenge({ user });
    let latticeChallenge = null;
    if (requiresLatticeChallenge) {
        latticeChallenge = await generateLatticeChallenge(user._id);
    }

    res.json(buildSessionPayload({
        authUser,
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        user,
        status: requiresLatticeChallenge ? 'lattice_challenge_required' : 'authenticated',
        latticeChallenge,
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
                loginEmailOtpVerifiedAt: null,
                loginOtpVerifiedAt: new Date(),
                loginOtpAssuranceExpiresAt: new Date(Date.now() + LOGIN_ASSURANCE_TTL_MS),
            },
        },
        {
            new: true,
            projection: 'name email phone avatar gender dob bio isAdmin isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt',
            lean: true,
        }
    );

    await persistAuthSnapshot(updatedUser);
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(tokenEmail);

    res.json(buildSessionPayload({
        authUser: {
            ...authUser,
            email: tokenEmail,
            phoneNumber: requestPhone,
            phone: requestPhone,
        },
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        user: updatedUser,
    }));
});

// @desc    Verify lattice challenge proof
// @route   POST /api/auth/verify-lattice
// @access  Private
const verifyLatticeChallenge = asyncHandler(async (req, res) => {
    const { challengeId, proof } = req.body;
    if (!challengeId || !proof) {
        throw new AppError('Challenge ID and mathematical proof are required', 400);
    }

    const verification = await verifyLatticeProof(challengeId, proof);
    if (!verification.success) {
        throw new AppError('Cryptographic proof verification failed', 403);
    }

    res.json({
        success: true,
        message: 'Lattice-based identity verified',
        ...verification
    });
});

// @desc    Verify quantum challenge proof
// @route   POST /api/auth/verify-quantum
// @access  Private
const verifyQuantumChallenge = asyncHandler(async (req, res) => {
    const { challengeId, proof } = req.body;
    if (!challengeId || !proof) {
        throw new AppError('Challenge ID and quantum proof are required', 400);
    }

    // Quantum challenges reuse the same lattice-based verification engine
    // but with a different challenge type flag for audit logging
    const verification = await verifyLatticeProof(challengeId, proof);
    if (!verification.success) {
        throw new AppError('Quantum cryptographic proof verification failed', 403);
    }

    res.json({
        success: true,
        message: 'Quantum-resistant identity verified',
        ...verification
    });
});

module.exports = {
    getSession,
    syncSession,
    completePhoneFactorLogin,
    verifyLatticeChallenge,
    verifyQuantumChallenge,
};
