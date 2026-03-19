const VideoCallSession = require('../models/VideoCallSession');

const ACTIVE_SESSION_TTL_MS = Number(process.env.VIDEO_CALL_ACTIVE_TTL_MS || (30 * 60 * 1000));
const ENDED_SESSION_RETENTION_MS = Number(process.env.VIDEO_CALL_RETAIN_MS || (7 * 24 * 60 * 60 * 1000));

const toIdString = (value) => String(value === undefined || value === null ? '' : value).trim();

const buildVideoCallSessionKey = ({ listingId, userA, userB }) => {
    const [firstUserId, secondUserId] = [toIdString(userA), toIdString(userB)].sort();
    return `${toIdString(listingId)}:${firstUserId}:${secondUserId}`;
};

const activeExpiry = () => new Date(Date.now() + ACTIVE_SESSION_TTL_MS);
const endedExpiry = () => new Date(Date.now() + ENDED_SESSION_RETENTION_MS);

const toLeanSession = (session) => {
    if (!session) return null;
    return {
        sessionKey: toIdString(session.sessionKey),
        listingId: toIdString(session.listing),
        initiator: toIdString(session.initiator),
        recipient: toIdString(session.recipient),
        participants: Array.isArray(session.participants) ? session.participants.map((entry) => toIdString(entry)) : [],
        status: toIdString(session.status || 'ringing'),
        startedAt: session.startedAt || null,
        connectedAt: session.connectedAt || null,
        endedAt: session.endedAt || null,
        lastSignalAt: session.lastSignalAt || null,
        lastEventAt: session.lastEventAt || null,
        endReason: toIdString(session.endReason || ''),
        expiresAt: session.expiresAt || null,
    };
};

const registerVideoCallSession = async ({
    listingId,
    callerUserId,
    targetUserId,
}) => {
    const sessionKey = buildVideoCallSessionKey({
        listingId,
        userA: callerUserId,
        userB: targetUserId,
    });

    const now = new Date();
    const session = await VideoCallSession.findOneAndUpdate(
        { sessionKey },
        {
            $setOnInsert: {
                sessionKey,
                listing: toIdString(listingId),
                participants: [toIdString(callerUserId), toIdString(targetUserId)].sort(),
                startedAt: now,
            },
            $set: {
                initiator: toIdString(callerUserId),
                recipient: toIdString(targetUserId),
                status: 'ringing',
                connectedAt: null,
                endedAt: null,
                endReason: '',
                lastEventAt: now,
                expiresAt: activeExpiry(),
            },
        },
        {
            upsert: true,
            setDefaultsOnInsert: true,
            returnDocument: 'after',
        }
    ).lean();

    return toLeanSession(session);
};

const getActiveVideoCallSession = async ({
    listingId,
    userA,
    userB,
}) => {
    const session = await VideoCallSession.findOne({
        sessionKey: buildVideoCallSessionKey({ listingId, userA, userB }),
        status: { $in: ['ringing', 'connected'] },
        expiresAt: { $gt: new Date() },
    }).lean();

    return toLeanSession(session);
};

const touchVideoCallSessionSignal = async ({
    listingId,
    userA,
    userB,
}) => {
    const session = await VideoCallSession.findOneAndUpdate(
        {
            sessionKey: buildVideoCallSessionKey({ listingId, userA, userB }),
            status: { $in: ['ringing', 'connected'] },
        },
        {
            $set: {
                lastSignalAt: new Date(),
                lastEventAt: new Date(),
                expiresAt: activeExpiry(),
            },
        },
        {
            returnDocument: 'after',
        }
    ).lean();

    return toLeanSession(session);
};

const markVideoCallSessionConnected = async ({
    listingId,
    userA,
    userB,
}) => {
    const now = new Date();
    const session = await VideoCallSession.findOneAndUpdate(
        {
            sessionKey: buildVideoCallSessionKey({ listingId, userA, userB }),
            status: { $in: ['ringing', 'connected'] },
        },
        {
            $set: {
                status: 'connected',
                connectedAt: now,
                lastSignalAt: now,
                lastEventAt: now,
                expiresAt: activeExpiry(),
            },
        },
        {
            returnDocument: 'after',
        }
    ).lean();

    return toLeanSession(session);
};

const endVideoCallSession = async ({
    listingId,
    userA,
    userB,
    reason = 'hangup',
}) => {
    const now = new Date();
    const session = await VideoCallSession.findOneAndUpdate(
        {
            sessionKey: buildVideoCallSessionKey({ listingId, userA, userB }),
            status: { $in: ['ringing', 'connected'] },
        },
        {
            $set: {
                status: 'ended',
                endedAt: now,
                lastEventAt: now,
                endReason: toIdString(reason).slice(0, 80),
                expiresAt: endedExpiry(),
            },
        },
        {
            returnDocument: 'after',
        }
    ).lean();

    return toLeanSession(session);
};

const closeVideoCallSessionsForUser = async ({
    userId,
    reason = 'participant_disconnect',
}) => {
    const now = new Date();
    const sessions = await VideoCallSession.find({
        participants: toIdString(userId),
        status: { $in: ['ringing', 'connected'] },
    }).lean();

    if (sessions.length === 0) return [];

    await VideoCallSession.updateMany(
        {
            _id: { $in: sessions.map((entry) => entry._id) },
        },
        {
            $set: {
                status: 'ended',
                endedAt: now,
                lastEventAt: now,
                endReason: toIdString(reason).slice(0, 80),
                expiresAt: endedExpiry(),
            },
        }
    );

    return sessions.map((entry) => toLeanSession({
        ...entry,
        status: 'ended',
        endedAt: now,
        lastEventAt: now,
        endReason: toIdString(reason).slice(0, 80),
        expiresAt: endedExpiry(),
    }));
};

const getVideoCallSessionMetrics = async () => {
    const [ringing, connected, endedRecently] = await Promise.all([
        VideoCallSession.countDocuments({ status: 'ringing', expiresAt: { $gt: new Date() } }),
        VideoCallSession.countDocuments({ status: 'connected', expiresAt: { $gt: new Date() } }),
        VideoCallSession.countDocuments({ status: 'ended', endedAt: { $gte: new Date(Date.now() - ENDED_SESSION_RETENTION_MS) } }),
    ]);

    return {
        activeRinging: ringing,
        activeConnected: connected,
        endedRecently,
        activeTtlMs: ACTIVE_SESSION_TTL_MS,
        retentionMs: ENDED_SESSION_RETENTION_MS,
    };
};

module.exports = {
    buildVideoCallSessionKey,
    closeVideoCallSessionsForUser,
    endVideoCallSession,
    getActiveVideoCallSession,
    getVideoCallSessionMetrics,
    markVideoCallSessionConnected,
    registerVideoCallSession,
    touchVideoCallSessionSignal,
};
