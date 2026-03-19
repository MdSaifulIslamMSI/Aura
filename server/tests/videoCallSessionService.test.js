const VideoCallSession = require('../models/VideoCallSession');
const {
    buildVideoCallSessionKey,
    closeVideoCallSessionsForUser,
    endVideoCallSession,
    getActiveVideoCallSession,
    markVideoCallSessionConnected,
    registerVideoCallSession,
    touchVideoCallSessionSignal,
} = require('../services/videoCallSessionService');

describe('videoCallSessionService', () => {
    const listingId = '507f191e810c19729de860aa';
    const sellerId = '507f191e810c19729de860ab';
    const buyerId = '507f191e810c19729de860ac';

    test('creates and progresses a durable call session', async () => {
        const registered = await registerVideoCallSession({
            listingId,
            callerUserId: sellerId,
            targetUserId: buyerId,
        });

        expect(registered).toMatchObject({
            listingId,
            initiator: sellerId,
            recipient: buyerId,
            status: 'ringing',
        });
        expect(registered.sessionKey).toBe(buildVideoCallSessionKey({
            listingId,
            userA: sellerId,
            userB: buyerId,
        }));

        const active = await getActiveVideoCallSession({
            listingId,
            userA: sellerId,
            userB: buyerId,
        });
        expect(active?.status).toBe('ringing');

        const touched = await touchVideoCallSessionSignal({
            listingId,
            userA: sellerId,
            userB: buyerId,
        });
        expect(touched?.lastSignalAt).toBeTruthy();

        const connected = await markVideoCallSessionConnected({
            listingId,
            userA: sellerId,
            userB: buyerId,
        });
        expect(connected?.status).toBe('connected');
        expect(connected?.connectedAt).toBeTruthy();

        const ended = await endVideoCallSession({
            listingId,
            userA: sellerId,
            userB: buyerId,
            reason: 'hangup',
        });
        expect(ended?.status).toBe('ended');
        expect(ended?.endReason).toBe('hangup');

        const noLongerActive = await getActiveVideoCallSession({
            listingId,
            userA: sellerId,
            userB: buyerId,
        });
        expect(noLongerActive).toBeNull();
    });

    test('closes all active sessions for a disconnected participant', async () => {
        await registerVideoCallSession({
            listingId,
            callerUserId: sellerId,
            targetUserId: buyerId,
        });
        await registerVideoCallSession({
            listingId: '507f191e810c19729de860ad',
            callerUserId: sellerId,
            targetUserId: '507f191e810c19729de860ae',
        });

        const closed = await closeVideoCallSessionsForUser({
            userId: sellerId,
            reason: 'participant_disconnect',
        });

        expect(closed).toHaveLength(2);

        const persisted = await VideoCallSession.find({ initiator: sellerId }).lean();
        expect(persisted.every((entry) => entry.status === 'ended')).toBe(true);
        expect(persisted.every((entry) => entry.endReason === 'participant_disconnect')).toBe(true);
    });
});
