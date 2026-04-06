const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    archiveSession,
    createSession,
    getSession,
    listSessions,
    resetSession,
} = require('../services/ai/commerceAssistantService');

const ensureAuthenticatedUser = (req) => {
    if (!req.user?._id) {
        throw new AppError('Not authorized', 401);
    }
    return req.user;
};

const listAiSessions = asyncHandler(async (req, res) => {
    const user = ensureAuthenticatedUser(req);
    const sessions = await listSessions({ user });
    return res.json({ sessions });
});

const getAiSession = asyncHandler(async (req, res, next) => {
    const user = ensureAuthenticatedUser(req);
    const payload = await getSession({ user, sessionId: req.params.sessionId });
    if (!payload) {
        return next(new AppError('Assistant session not found', 404));
    }
    return res.json(payload);
});

const createAiSession = asyncHandler(async (req, res, next) => {
    const user = ensureAuthenticatedUser(req);
    const payload = await createSession({
        user,
        sessionId: req.body?.sessionId || '',
        assistantMode: req.body?.assistantMode || 'chat',
        originPath: req.body?.originPath || '/',
    });
    if (!payload) {
        return next(new AppError('Unable to create assistant session', 500));
    }
    return res.status(201).json(payload);
});

const resetAiSession = asyncHandler(async (req, res, next) => {
    const user = ensureAuthenticatedUser(req);
    const session = await resetSession({ user, sessionId: req.params.sessionId });
    if (!session) {
        return next(new AppError('Assistant session not found', 404));
    }
    return res.json({ session });
});

const archiveAiSession = asyncHandler(async (req, res, next) => {
    const user = ensureAuthenticatedUser(req);
    const session = await archiveSession({ user, sessionId: req.params.sessionId });
    if (!session) {
        return next(new AppError('Assistant session not found', 404));
    }
    return res.json({ session });
});

module.exports = {
    archiveAiSession,
    createAiSession,
    getAiSession,
    listAiSessions,
    resetAiSession,
};
