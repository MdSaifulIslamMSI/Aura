jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
}));

jest.mock('../config/firebase', () => ({
    auth: () => ({
        verifyIdToken: jest.fn(),
    }),
}));

jest.mock('../config/corsFlags', () => ({
    allowedOrigins: [],
}));

jest.mock('../config/redis', () => ({
    getRedisClient: jest.fn(),
}));

jest.mock('../models/User', () => ({
    findOne: jest.fn(),
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
    cancelPendingVideoSessionDisconnectCleanup,
    finishVideoSessionDisconnectCleanup,
    getSupportVideoSession,
    registerSupportVideoSession,
    resetSocketStateForTests,
    scheduleVideoSessionDisconnectCleanup,
} = require('../services/socketService');
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
