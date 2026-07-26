const sessionService = require('../services/browserSessionService');
const telemetryService = require('../services/authSecurityTelemetryService');
const {
    getAccountSessions,
    revokeAccountSession,
    revokeOtherAccountSessions,
} = require('../controllers/accountSecurityController');

jest.mock('../services/browserSessionService', () => ({
    clearBrowserSessionCookie: jest.fn(),
    listBrowserSessionsForUser: jest.fn(),
    revokeBrowserSessionForUserByPublicId: jest.fn(),
    revokeOtherBrowserSessionsForUser: jest.fn(),
}));

jest.mock('../services/authSecurityTelemetryService', () => ({
    recordAuthSecurityEvent: jest.fn(),
}));

const buildResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
});

const flushController = async (controller, req, res, next) => {
    controller(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
};

describe('account security controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('lists only the authenticated user sessions and marks the current browser internally', async () => {
        const req = {
            user: { _id: '507f1f77bcf86cd799439110' },
            authSession: { sessionId: 'private-current-session' },
            query: { limit: 10 },
        };
        const res = buildResponse();
        const next = jest.fn();
        sessionService.listBrowserSessionsForUser.mockResolvedValue([{
            id: 'a'.repeat(43),
            current: true,
            client: 'Chrome',
            os: 'Windows',
        }]);

        await flushController(getAccountSessions, req, res, next);

        expect(sessionService.listBrowserSessionsForUser).toHaveBeenCalledWith(
            req.user._id,
            { currentSessionId: 'private-current-session', limit: 10 }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            count: 1,
            data: [expect.objectContaining({ current: true })],
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('revokes an opaque alias only inside the authenticated user inventory', async () => {
        const alias = 'b'.repeat(43);
        const req = {
            user: { _id: '507f1f77bcf86cd799439111' },
            authSession: { sessionId: 'private-current-session' },
            params: { sessionAlias: alias },
        };
        const res = buildResponse();
        const next = jest.fn();
        sessionService.revokeBrowserSessionForUserByPublicId.mockResolvedValue({
            revoked: true,
            current: false,
        });

        await flushController(revokeAccountSession, req, res, next);

        expect(sessionService.revokeBrowserSessionForUserByPublicId).toHaveBeenCalledWith(
            req.user._id,
            alias,
            { currentSessionId: 'private-current-session' }
        );
        expect(sessionService.clearBrowserSessionCookie).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            status: 'session_revoked',
        });
        expect(telemetryService.recordAuthSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'auth.session.revoked_by_user',
                meta: { currentSession: false },
            })
        );
    });

    test('clears the browser cookie when the current session is revoked', async () => {
        const req = {
            user: { _id: '507f1f77bcf86cd799439112' },
            authSession: { sessionId: 'private-current-session' },
            params: { sessionAlias: 'c'.repeat(43) },
        };
        const res = buildResponse();
        const next = jest.fn();
        sessionService.revokeBrowserSessionForUserByPublicId.mockResolvedValue({
            revoked: true,
            current: true,
        });

        await flushController(revokeAccountSession, req, res, next);

        expect(sessionService.clearBrowserSessionCookie).toHaveBeenCalledWith(res, req);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            status: 'current_session_revoked',
        });
    });

    test('refuses revoke-others when no current browser session can be preserved', async () => {
        const req = {
            user: { _id: '507f1f77bcf86cd799439113' },
            authSession: null,
        };
        const res = buildResponse();
        const next = jest.fn();

        await flushController(revokeOtherAccountSessions, req, res, next);

        expect(sessionService.revokeOtherBrowserSessionsForUser).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 409,
            code: 'AUTH_CURRENT_SESSION_REQUIRED',
        }));
    });
});
