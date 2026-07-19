jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
}));

jest.mock('../config/firebase', () => {
    const verifyIdToken = jest.fn();
    return {
        auth: () => ({ verifyIdToken }),
        __verifyIdToken: verifyIdToken,
    };
});

jest.mock('../config/corsFlags', () => ({
    allowedOrigins: [],
}));

jest.mock('../config/redis', () => ({
    getRedisClient: jest.fn(),
    flags: { redisPrefix: 'test' },
}));

jest.mock('../models/User', () => ({
    findOne: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../services/browserSessionService', () => ({
    getBrowserSession: jest.fn(),
    getGlobalSessionRevokedAfter: jest.fn().mockResolvedValue(0),
    resolveSessionIdFromCookieHeader: jest.fn(),
    touchBrowserSession: jest.fn(),
}));

jest.mock('../services/supportTicketViews', () => ({
    loadAdminTicketView: jest.fn().mockResolvedValue(null),
    loadUserTicketView: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/supportVideoService', () => ({
    markSupportTicketLiveCallEnded: jest.fn().mockResolvedValue({
        ticket: { _id: 'ticket-1' },
        message: null,
    }),
}));

jest.mock('../services/livekitService', () => ({
    deleteSupportRoom: jest.fn().mockResolvedValue(),
}));

const {
    applySocketAuthentication,
    cancelPendingVideoSessionDisconnectCleanup,
    finishVideoSessionDisconnectCleanup,
    getSupportVideoSession,
    registerSupportVideoSession,
    resolveSocketAuthentication,
    revalidateSocketAuthentication,
    resetSocketStateForTests,
    scheduleVideoSessionDisconnectCleanup,
} = require('../services/socketService');
const firebaseAdmin = require('../config/firebase');
const User = require('../models/User');
const browserSessionService = require('../services/browserSessionService');
const { deleteSupportRoom } = require('../services/livekitService');
const { markSupportTicketLiveCallEnded } = require('../services/supportVideoService');

describe('socketService video disconnect cleanup', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        resetSocketStateForTests();
    });

    afterEach(() => {
        resetSocketStateForTests();
        jest.useRealTimers();
    });

    test('waits through the grace period before ending an active support session', async () => {
        registerSupportVideoSession({
            ticketId: 'ticket-1',
            sessionKey: 'room-1',
            roomName: 'room-1',
            userId: 'user-1',
            adminUserId: 'admin-1',
            contextLabel: 'Aura Support live call',
            status: 'connected',
        });

        scheduleVideoSessionDisconnectCleanup({
            userId: 'user-1',
            graceMs: 5000,
        });

        await jest.advanceTimersByTimeAsync(4999);
        expect(getSupportVideoSession('ticket-1')).not.toBeNull();
        expect(deleteSupportRoom).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(getSupportVideoSession('ticket-1')).toBeNull();
        expect(deleteSupportRoom).toHaveBeenCalledWith('room-1');
        expect(markSupportTicketLiveCallEnded).toHaveBeenCalledWith(expect.objectContaining({
            ticketId: 'ticket-1',
            sessionKey: 'room-1',
            reason: 'connection_lost',
        }));
    });

    test('cancels scheduled cleanup when the user reconnects before grace expires', async () => {
        registerSupportVideoSession({
            ticketId: 'ticket-1',
            sessionKey: 'room-1',
            roomName: 'room-1',
            userId: 'user-1',
            adminUserId: 'admin-1',
            contextLabel: 'Aura Support live call',
            status: 'connected',
        });

        scheduleVideoSessionDisconnectCleanup({
            userId: 'user-1',
            graceMs: 5000,
        });

        expect(cancelPendingVideoSessionDisconnectCleanup({
            userId: 'user-1',
        })).toBe(true);

        await jest.advanceTimersByTimeAsync(5000);
        expect(getSupportVideoSession('ticket-1')).not.toBeNull();
        expect(deleteSupportRoom).not.toHaveBeenCalled();
        expect(markSupportTicketLiveCallEnded).not.toHaveBeenCalled();
    });

    test('marks ringing sessions as failed when cleanup runs before the call connects', async () => {
        registerSupportVideoSession({
            ticketId: 'ticket-2',
            sessionKey: 'room-2',
            roomName: 'room-2',
            userId: 'user-2',
            adminUserId: 'admin-2',
            contextLabel: 'Aura Support live call',
            status: 'ringing',
        });

        await finishVideoSessionDisconnectCleanup({
            userId: 'user-2',
        });

        expect(getSupportVideoSession('ticket-2')).toBeNull();
        expect(markSupportTicketLiveCallEnded).toHaveBeenCalledWith(expect.objectContaining({
            ticketId: 'ticket-2',
            sessionKey: 'room-2',
            reason: 'failed',
        }));
    });
});

describe('socketService authentication lifecycle', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const primaryUser = {
        _id: '507f1f77bcf86cd799439011',
        authUid: 'firebase-user-1',
        email: 'socket-user@example.com',
        name: 'Socket User',
        isAdmin: false,
        isSeller: false,
        isVerified: true,
        authTokensRevokedAfter: null,
        accountState: 'active',
        softDeleted: false,
    };
    const decodedToken = {
        uid: 'firebase-user-1',
        email: 'socket-user@example.com',
        auth_time: nowSeconds - 30,
        iat: nowSeconds - 30,
        exp: nowSeconds + 3600,
    };
    const buildQuery = (value) => ({
        select: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue(value),
        })),
    });

    beforeEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
        resetSocketStateForTests();
        firebaseAdmin.__verifyIdToken.mockResolvedValue(decodedToken);
        User.findOne.mockReturnValue(buildQuery(primaryUser));
        User.findById.mockReturnValue(buildQuery(primaryUser));
        browserSessionService.getGlobalSessionRevokedAfter.mockResolvedValue(0);
        browserSessionService.resolveSessionIdFromCookieHeader.mockReturnValue('stale-session');
        browserSessionService.getBrowserSession.mockResolvedValue(null);
        browserSessionService.touchBrowserSession.mockImplementation(async (session) => session);
    });

    afterEach(() => {
        resetSocketStateForTests();
    });

    test('uses a fresh bearer when an attached browser-session cookie is expired', async () => {
        const authentication = await resolveSocketAuthentication({
            token: 'fresh-firebase-token',
            cookieHeader: 'aura_sid=stale-session',
        });

        expect(authentication.user.id).toBe(String(primaryUser._id));
        expect(authentication.credential.source).toBe('firebase_bearer');
        expect(firebaseAdmin.__verifyIdToken).toHaveBeenCalledWith('fresh-firebase-token', true);
    });

    test('uses a fresh bearer when stale-cookie validation throws', async () => {
        browserSessionService.getBrowserSession.mockRejectedValueOnce(
            Object.assign(new Error('Session was revoked'), { code: 'SOCKET_AUTH_REVOKED' })
        );

        const authentication = await resolveSocketAuthentication({
            token: 'fresh-firebase-token',
            cookieHeader: 'aura_sid=stale-session',
        });

        expect(authentication.user.id).toBe(String(primaryUser._id));
        expect(authentication.credential.source).toBe('firebase_bearer');
    });

    test('rejects a valid cookie and bearer that belong to different users', async () => {
        const otherUser = {
            ...primaryUser,
            _id: '507f1f77bcf86cd799439012',
            authUid: 'firebase-user-2',
            email: 'other@example.com',
        };
        const session = {
            sessionId: 'other-session',
            userId: otherUser._id,
            firebaseUid: otherUser.authUid,
            email: otherUser.email,
            issuedAtSeconds: nowSeconds - 30,
            authTimeSeconds: nowSeconds - 30,
            idleExpiresAt: new Date(Date.now() + 3600000).toISOString(),
            absoluteExpiresAt: new Date(Date.now() + 7200000).toISOString(),
        };
        browserSessionService.getBrowserSession.mockResolvedValue(session);
        browserSessionService.touchBrowserSession.mockResolvedValue(session);
        User.findById.mockReturnValue(buildQuery(otherUser));

        await expect(resolveSocketAuthentication({
            token: 'fresh-firebase-token',
            cookieHeader: 'aura_sid=other-session',
        })).rejects.toMatchObject({ code: 'SOCKET_AUTH_IDENTITY_MISMATCH' });
    });

    test('rejects deleted accounts and user-level token revocation', async () => {
        User.findOne.mockReturnValueOnce(buildQuery({
            ...primaryUser,
            softDeleted: true,
        }));
        await expect(resolveSocketAuthentication({
            token: 'fresh-firebase-token',
        })).rejects.toMatchObject({ code: 'SOCKET_ACCOUNT_INACTIVE' });

        User.findOne.mockReturnValueOnce(buildQuery({
            ...primaryUser,
            authTokensRevokedAfter: new Date((decodedToken.iat * 1000) + 1000),
        }));
        await expect(resolveSocketAuthentication({
            token: 'revoked-firebase-token',
        })).rejects.toMatchObject({ code: 'SOCKET_AUTH_REVOKED' });
    });

    test('revalidates revocation and preserves the authenticated user binding', async () => {
        const initial = await resolveSocketAuthentication({ token: 'fresh-firebase-token' });
        firebaseAdmin.__verifyIdToken.mockRejectedValueOnce(
            Object.assign(new Error('Firebase token revoked'), { code: 'auth/id-token-revoked' })
        );

        await expect(revalidateSocketAuthentication(
            initial.credential,
            initial.user.id
        )).rejects.toMatchObject({ code: 'SOCKET_AUTH_REVOKED' });
        expect(firebaseAdmin.__verifyIdToken).toHaveBeenLastCalledWith('fresh-firebase-token', true);
    });

    test('maps natural Firebase expiry to a retryable socket-auth expiry', async () => {
        firebaseAdmin.__verifyIdToken.mockRejectedValueOnce(
            Object.assign(new Error('Firebase token expired'), { code: 'auth/id-token-expired' })
        );

        await expect(resolveSocketAuthentication({
            token: 'expired-firebase-token',
        })).rejects.toMatchObject({ code: 'SOCKET_AUTH_EXPIRED' });
    });

    test('does not extend cookie-session idle expiry during periodic revalidation', async () => {
        const session = {
            sessionId: 'cookie-session-1',
            userId: primaryUser._id,
            firebaseUid: primaryUser.authUid,
            email: primaryUser.email,
            issuedAtSeconds: nowSeconds - 30,
            authTimeSeconds: nowSeconds - 30,
            idleExpiresAt: new Date(Date.now() + 3600000).toISOString(),
            absoluteExpiresAt: new Date(Date.now() + 7200000).toISOString(),
        };
        browserSessionService.getBrowserSession.mockResolvedValue(session);

        const authentication = await revalidateSocketAuthentication({
            source: 'browser_session',
            sessionId: session.sessionId,
        }, primaryUser._id);

        expect(authentication.credential.source).toBe('browser_session');
        expect(browserSessionService.touchBrowserSession).not.toHaveBeenCalled();
    });

    test('removes admin-room membership immediately after a role demotion', () => {
        jest.useFakeTimers();
        const socket = {
            user: { ...primaryUser, id: String(primaryUser._id), isAdmin: true },
            join: jest.fn(),
            leave: jest.fn(),
            emit: jest.fn(),
            disconnect: jest.fn(),
            connected: true,
        };

        applySocketAuthentication(socket, {
            user: { ...socket.user, isAdmin: false },
            credential: {
                source: 'firebase_bearer',
                token: 'fresh-firebase-token',
                expiresAtMs: Date.now() + 3600000,
            },
        });

        expect(socket.leave).toHaveBeenCalledWith('admins');
        expect(socket.join).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});
