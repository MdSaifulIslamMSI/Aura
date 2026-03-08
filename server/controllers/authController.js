const asyncHandler = require('express-async-handler');
const {
    buildSessionPayload,
    resolveAuthenticatedSession,
    syncAuthenticatedUser,
} = require('../services/authSessionService');

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

    res.json(buildSessionPayload({
        authUser,
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        user,
        status: 'authenticated',
    }));
});

module.exports = {
    getSession,
    syncSession,
};
