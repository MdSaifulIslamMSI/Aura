const asyncHandler = require('express-async-handler');
const {
    buildSessionPayload,
    resolveAuthenticatedSession,
    syncAuthenticatedUser,
} = require('../services/authSessionService');
const { generateLatticeChallenge, verifyLatticeProof } = require('../services/latticeChallengeService');
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
    verifyLatticeChallenge,
    verifyQuantumChallenge,
};
