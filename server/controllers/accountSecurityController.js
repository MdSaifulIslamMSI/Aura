const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    clearBrowserSessionCookie,
    listBrowserSessionsForUser,
    revokeBrowserSessionForUserByPublicId,
    revokeOtherBrowserSessionsForUser,
    revokeBrowserSessionsForUser,
} = require('../services/browserSessionService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const { listAccountSecurityActivity } = require('../services/accountSecurityActivityService');

const getAuthenticatedUserId = (req = {}) => String(req.user?._id || '').trim();
const getCurrentSessionId = (req = {}) => String(req.authSession?.sessionId || '').trim();

const getAccountSessions = asyncHandler(async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const sessions = await listBrowserSessionsForUser(userId, {
        currentSessionId: getCurrentSessionId(req),
        limit: req.query?.limit,
    });

    res.status(200).json({
        success: true,
        count: sessions.length,
        data: sessions,
    });
});

const revokeAccountSession = asyncHandler(async (req, res, next) => {
    const result = await revokeBrowserSessionForUserByPublicId(
        getAuthenticatedUserId(req),
        req.params.sessionAlias,
        { currentSessionId: getCurrentSessionId(req) }
    );
    if (!result) {
        return next(new AppError('Session not found', 404));
    }

    if (result.current) {
        clearBrowserSessionCookie(res, req);
    }

    recordAuthSecurityEvent({
        event: 'auth.session.revoked_by_user',
        outcome: 'success',
        reason: result.current ? 'current_session' : 'other_session',
        surface: 'account_security',
        req,
        meta: { currentSession: result.current },
    });

    return res.status(200).json({
        success: true,
        status: result.current ? 'current_session_revoked' : 'session_revoked',
    });
});

const revokeOtherAccountSessions = asyncHandler(async (req, res, next) => {
    const currentSessionId = getCurrentSessionId(req);
    if (!currentSessionId) {
        const error = new AppError('A current browser session is required to preserve this device', 409);
        error.code = 'AUTH_CURRENT_SESSION_REQUIRED';
        return next(error);
    }

    const result = await revokeOtherBrowserSessionsForUser(
        getAuthenticatedUserId(req),
        currentSessionId
    );

    recordAuthSecurityEvent({
        event: 'auth.sessions.other_revoked_by_user',
        outcome: 'success',
        reason: 'user_requested',
        surface: 'account_security',
        req,
        meta: { revokedCount: result.revoked },
    });

    return res.status(200).json({
        success: true,
        status: 'other_sessions_revoked',
        revoked: result.revoked,
    });
});

const revokeAllAccountSessions = asyncHandler(async (req, res) => {
    const result = await revokeBrowserSessionsForUser(getAuthenticatedUserId(req));
    clearBrowserSessionCookie(res, req);

    recordAuthSecurityEvent({
        event: 'auth.sessions.all_revoked_by_user',
        outcome: 'success',
        reason: 'user_requested',
        surface: 'account_security',
        req,
        meta: { revokedCount: result.revoked },
    });

    return res.status(200).json({
        success: true,
        status: 'all_sessions_revoked',
        revoked: result.revoked,
    });
});

const getAccountSecurityActivity = asyncHandler(async (req, res) => {
    const result = await listAccountSecurityActivity({
        userId: getAuthenticatedUserId(req),
        limit: req.query?.limit,
        cursor: req.query?.cursor,
    });
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(result);
});

module.exports = {
    getAccountSessions,
    getAccountSecurityActivity,
    revokeAccountSession,
    revokeAllAccountSessions,
    revokeOtherAccountSessions,
};
