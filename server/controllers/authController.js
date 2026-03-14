const asyncHandler = require('express-async-handler');
const {
    buildSessionPayload,
    resolveAuthenticatedSession,
    syncAuthenticatedUser,
} = require('../services/authSessionService');
const { generateLatticeChallenge, verifyLatticeProof } = require('../services/latticeChallengeService');
const AppError = require('../utils/AppError');

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

    // Lattice Risk Logic (Simulation)
    // If it's a new login or first time today, require a Lattice Challenge
    const requiresLatticeChallenge = true; // Triggering for all syncs in this demo phase
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

module.exports = {
    getSession,
    syncSession,
    verifyLatticeChallenge,
};
