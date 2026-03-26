const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const firebaseAdmin = require('../config/firebase');
const { allowedOrigins } = require('../config/corsFlags');
const { getRedisClient } = require('../config/redis');
const User = require('../models/User');
const logger = require('../utils/logger');
const {
    loadAdminTicketView,
    loadUserTicketView,
} = require('./supportTicketViews');
const {
    markSupportTicketLiveCallEnded,
} = require('./supportVideoService');
const { deleteSupportRoom } = require('./livekitService');

let io;
// Map to track userId -> Set of socketIds (handles multiple tabs/devices)
const userSockets = new Map();
const activeSupportVideoSessions = new Map();
const activeListingVideoSessions = new Map();
const pendingVideoSessionDisconnectCleanups = new Map();
const ADMIN_ROOM = 'admins';
let socketAdapterPubClient = null;
let socketAdapterSubClient = null;
const DEFAULT_VIDEO_SESSION_DISCONNECT_GRACE_MS = 15000;

const socketHealth = {
    initialized: false,
    adapterMode: 'local',
    backplaneReady: false,
    lastAdapterError: '',
};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizeId = (value) => String(value || '').trim();
const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeLiveCallMediaMode = (value) => (
    String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video'
);
const getVideoSessionDisconnectGraceMs = () => parsePositiveInteger(
    process.env.VIDEO_SESSION_DISCONNECT_GRACE_MS,
    DEFAULT_VIDEO_SESSION_DISCONNECT_GRACE_MS,
);

const resolveSocketUser = async (token) => {
    const decoded = await firebaseAdmin.auth().verifyIdToken(token);
    const email = normalizeEmail(decoded?.email);

    if (!email) {
        throw new Error('Authenticated socket account is missing email');
    }

    const user = await User.findOne({ email })
        .select('_id email name isAdmin isSeller isVerified')
        .lean();

    if (!user?._id) {
        throw new Error('Authenticated socket user profile was not found');
    }

    return {
        id: String(user._id),
        uid: String(decoded.uid || ''),
        email,
        name: String(user.name || ''),
        isAdmin: Boolean(user.isAdmin),
        isSeller: Boolean(user.isSeller),
        isVerified: Boolean(user.isVerified),
    };
};

const registerSupportVideoSession = ({
    ticketId,
    sessionKey,
    roomName,
    userId,
    adminUserId,
    contextLabel = '',
    status = 'ringing',
    mediaMode = 'video',
}) => {
    const normalizedTicketId = String(ticketId || '').trim();
    if (!normalizedTicketId) {
        return null;
    }

    const normalizedSession = {
        ticketId: normalizedTicketId,
        sessionKey: String(sessionKey || roomName || '').trim(),
        roomName: String(roomName || sessionKey || '').trim(),
        participants: [String(userId || '').trim(), String(adminUserId || '').trim()].filter(Boolean),
        userId: String(userId || '').trim(),
        adminUserId: String(adminUserId || '').trim(),
        contextLabel: String(contextLabel || '').trim(),
        status: String(status || 'ringing').trim() || 'ringing',
        mediaMode: normalizeLiveCallMediaMode(mediaMode),
        updatedAt: new Date().toISOString(),
    };

    activeSupportVideoSessions.set(normalizedTicketId, normalizedSession);
    return normalizedSession;
};

const getSupportVideoSession = (ticketId) => {
    const normalizedTicketId = String(ticketId || '').trim();
    return normalizedTicketId ? (activeSupportVideoSessions.get(normalizedTicketId) || null) : null;
};

const markSupportVideoSessionConnected = ({ ticketId, sessionKey }) => {
    const session = getSupportVideoSession(ticketId);
    if (!session) {
        return null;
    }

    if (sessionKey && String(session.sessionKey) !== String(sessionKey)) {
        return null;
    }

    const nextSession = {
        ...session,
        status: 'connected',
        updatedAt: new Date().toISOString(),
    };
    activeSupportVideoSessions.set(String(ticketId), nextSession);
    return nextSession;
};

const clearSupportVideoSession = ({ ticketId, sessionKey } = {}) => {
    const session = getSupportVideoSession(ticketId);
    if (!session) {
        return null;
    }

    if (sessionKey && String(session.sessionKey) !== String(sessionKey)) {
        return null;
    }

    activeSupportVideoSessions.delete(String(ticketId));
    return session;
};

const closeSupportVideoSessionsForUser = ({ userId }) => {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        return [];
    }

    const sessions = [];
    for (const [ticketId, session] of activeSupportVideoSessions.entries()) {
        if (Array.isArray(session?.participants) && session.participants.includes(normalizedUserId)) {
            activeSupportVideoSessions.delete(ticketId);
            sessions.push(session);
        }
    }

    return sessions;
};

const registerListingVideoSession = ({
    listingId,
    sessionKey,
    roomName,
    sellerUserId,
    buyerUserId,
    startedByUserId,
    contextLabel = '',
    status = 'ringing',
    mediaMode = 'video',
}) => {
    const normalizedListingId = String(listingId || '').trim();
    if (!normalizedListingId) {
        return null;
    }

    const normalizedSession = {
        listingId: normalizedListingId,
        sessionKey: String(sessionKey || roomName || '').trim(),
        roomName: String(roomName || sessionKey || '').trim(),
        participants: [String(sellerUserId || '').trim(), String(buyerUserId || '').trim()].filter(Boolean),
        sellerUserId: String(sellerUserId || '').trim(),
        buyerUserId: String(buyerUserId || '').trim(),
        startedByUserId: String(startedByUserId || '').trim(),
        contextLabel: String(contextLabel || '').trim(),
        status: String(status || 'ringing').trim() || 'ringing',
        mediaMode: normalizeLiveCallMediaMode(mediaMode),
        updatedAt: new Date().toISOString(),
    };

    activeListingVideoSessions.set(normalizedListingId, normalizedSession);
    return normalizedSession;
};

const getListingVideoSession = (listingId) => {
    const normalizedListingId = String(listingId || '').trim();
    return normalizedListingId ? (activeListingVideoSessions.get(normalizedListingId) || null) : null;
};

const markListingVideoSessionConnected = ({ listingId, sessionKey }) => {
    const session = getListingVideoSession(listingId);
    if (!session) {
        return null;
    }

    if (sessionKey && String(session.sessionKey) !== String(sessionKey)) {
        return null;
    }

    const nextSession = {
        ...session,
        status: 'connected',
        updatedAt: new Date().toISOString(),
    };
    activeListingVideoSessions.set(String(listingId), nextSession);
    return nextSession;
};

const clearListingVideoSession = ({ listingId, sessionKey } = {}) => {
    const session = getListingVideoSession(listingId);
    if (!session) {
        return null;
    }

    if (sessionKey && String(session.sessionKey) !== String(sessionKey)) {
        return null;
    }

    activeListingVideoSessions.delete(String(listingId));
    return session;
};

const closeListingVideoSessionsForUser = ({ userId }) => {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        return [];
    }

    const sessions = [];
    for (const [listingId, session] of activeListingVideoSessions.entries()) {
        if (Array.isArray(session?.participants) && session.participants.includes(normalizedUserId)) {
            activeListingVideoSessions.delete(listingId);
            sessions.push(session);
        }
    }

    return sessions;
};

const cancelPendingVideoSessionDisconnectCleanup = ({ userId }) => {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return false;
    }

    const pendingCleanup = pendingVideoSessionDisconnectCleanups.get(normalizedUserId);
    if (!pendingCleanup) {
        return false;
    }

    clearTimeout(pendingCleanup.timeoutId);
    pendingVideoSessionDisconnectCleanups.delete(normalizedUserId);
    logger.info('socket.video_cleanup_cancelled', {
        userId: normalizedUserId,
    });
    return true;
};

const finishVideoSessionDisconnectCleanup = async ({ userId, reason = 'participant_disconnect' }) => {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return {
            canceled: true,
            endedSupportSessions: [],
            endedListingSessions: [],
        };
    }

    pendingVideoSessionDisconnectCleanups.delete(normalizedUserId);

    const userSet = userSockets.get(normalizedUserId);
    if (userSet && userSet.size > 0) {
        logger.info('socket.video_cleanup_skipped_user_reconnected', {
            userId: normalizedUserId,
            activeSocketCount: userSet.size,
        });
        return {
            canceled: true,
            endedSupportSessions: [],
            endedListingSessions: [],
        };
    }

    const endedSupportSessions = closeSupportVideoSessionsForUser({ userId: normalizedUserId });
    const endedListingSessions = closeListingVideoSessionsForUser({ userId: normalizedUserId });

    for (const session of endedSupportSessions) {
        await deleteSupportRoom(session.roomName || session.sessionKey).catch(() => null);

        const supportCallUpdate = await markSupportTicketLiveCallEnded({
            ticketId: session.ticketId,
            endedByRole: 'system',
            sessionKey: session.sessionKey,
            reason,
        }).catch(() => null);

        if (supportCallUpdate) {
            await emitSupportRealtimeUpdate({
                ticketId: session.ticketId,
                eventName: 'support:message:new',
                message: supportCallUpdate?.message || null,
            }).catch(() => null);
        }

        const counterpartyUserId = session.participants.find((participantId) => participantId !== normalizedUserId);
        if (counterpartyUserId) {
            sendMessageToUser(counterpartyUserId, 'support:video:terminated', {
                supportTicketId: session.ticketId,
                channelType: 'support_ticket',
                contextId: session.ticketId,
                sessionKey: session.sessionKey,
                reason,
            });
        }
    }

    for (const session of endedListingSessions) {
        await deleteSupportRoom(session.roomName || session.sessionKey).catch(() => null);

        const counterpartyUserId = session.participants.find((participantId) => participantId !== normalizedUserId);
        if (counterpartyUserId) {
            sendMessageToUser(counterpartyUserId, 'listing:video:terminated', {
                listingId: session.listingId,
                channelType: 'listing',
                contextId: session.listingId,
                sessionKey: session.sessionKey,
                reason,
            });
        }
    }

    logger.info('socket.video_cleanup_completed', {
        userId: normalizedUserId,
        endedSupportSessions: endedSupportSessions.length,
        endedListingSessions: endedListingSessions.length,
    });

    return {
        canceled: false,
        endedSupportSessions,
        endedListingSessions,
    };
};

const scheduleVideoSessionDisconnectCleanup = ({
    userId,
    reason = 'participant_disconnect',
    graceMs = getVideoSessionDisconnectGraceMs(),
}) => {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return null;
    }

    cancelPendingVideoSessionDisconnectCleanup({ userId: normalizedUserId });

    const timeoutId = setTimeout(() => {
        void finishVideoSessionDisconnectCleanup({
            userId: normalizedUserId,
            reason,
        });
    }, graceMs);
    timeoutId.unref?.();

    pendingVideoSessionDisconnectCleanups.set(normalizedUserId, {
        timeoutId,
        graceMs,
        reason,
        scheduledAt: new Date().toISOString(),
    });

    logger.info('socket.video_cleanup_scheduled', {
        userId: normalizedUserId,
        graceMs,
        reason,
    });

    return {
        userId: normalizedUserId,
        graceMs,
        reason,
    };
};

const resetSocketStateForTests = () => {
    for (const pendingCleanup of pendingVideoSessionDisconnectCleanups.values()) {
        clearTimeout(pendingCleanup.timeoutId);
    }

    userSockets.clear();
    activeSupportVideoSessions.clear();
    activeListingVideoSessions.clear();
    pendingVideoSessionDisconnectCleanups.clear();
};

const countSessionStatus = (sessionsMap, status) => {
    let count = 0;
    for (const session of sessionsMap.values()) {
        if (String(session?.status || '').trim() === status) {
            count += 1;
        }
    }
    return count;
};

const emitSupportRealtimeUpdate = async ({
    ticketId,
    eventName = 'support:ticket:update',
    message = null,
}) => {
    const [adminTicket, userTicket] = await Promise.all([
        loadAdminTicketView(ticketId),
        loadUserTicketView(ticketId),
    ]);

    if (!adminTicket?._id || !userTicket?._id) {
        return;
    }

    const adminPayload = {
        ticketId: adminTicket._id,
        ticket: adminTicket,
        ...(message ? { message } : {}),
    };
    const userPayload = {
        ticketId: userTicket._id,
        ticket: userTicket,
        ...(message ? { message } : {}),
    };

    sendMessageToAdmins(eventName, adminPayload);
    sendMessageToUser(adminTicket.user?._id, eventName, userPayload);

    if (eventName !== 'support:ticket:update') {
        sendMessageToAdmins('support:ticket:update', {
            ticketId: adminTicket._id,
            ticket: adminTicket,
        });
        sendMessageToUser(adminTicket.user?._id, 'support:ticket:update', {
            ticketId: userTicket._id,
            ticket: userTicket,
        });
    }
};

const getSocketCorsOrigins = () => (
    Array.isArray(allowedOrigins) && allowedOrigins.length > 0
        ? allowedOrigins
        : [process.env.FRONTEND_URL || 'http://localhost:5173']
);

const updateSocketHealth = (partial = {}) => {
    Object.assign(socketHealth, partial);
};

const getSocketHealth = () => ({
    initialized: Boolean(io) && socketHealth.initialized,
    adapterMode: socketHealth.adapterMode,
    backplaneReady: socketHealth.backplaneReady,
    lastAdapterError: socketHealth.lastAdapterError || null,
    activeUsers: userSockets.size,
    activeCallSessions: activeSupportVideoSessions.size + activeListingVideoSessions.size,
    activeSupportVideoSessions: activeSupportVideoSessions.size,
    activeListingVideoSessions: activeListingVideoSessions.size,
    activeRingingVideoSessions: countSessionStatus(activeSupportVideoSessions, 'ringing') + countSessionStatus(activeListingVideoSessions, 'ringing'),
    activeConnectedVideoSessions: countSessionStatus(activeSupportVideoSessions, 'connected') + countSessionStatus(activeListingVideoSessions, 'connected'),
    adminRoom: ADMIN_ROOM,
});

const attachSocketBackplane = async () => {
    if (!io) {
        throw new Error('Socket.io has not been initialized');
    }

    if (socketHealth.backplaneReady && socketHealth.adapterMode === 'redis') {
        return getSocketHealth();
    }

    const redisClient = getRedisClient();
    if (!redisClient?.isOpen || typeof redisClient.duplicate !== 'function') {
        updateSocketHealth({
            adapterMode: 'local',
            backplaneReady: false,
            lastAdapterError: 'redis_backplane_unavailable',
        });
        logger.warn('socket.backplane_unavailable', { reason: 'redis_client_unavailable' });
        return getSocketHealth();
    }

    try {
        if (!socketAdapterPubClient?.isOpen) {
            socketAdapterPubClient = redisClient.duplicate();
            await socketAdapterPubClient.connect();
        }
        if (!socketAdapterSubClient?.isOpen) {
            socketAdapterSubClient = redisClient.duplicate();
            await socketAdapterSubClient.connect();
        }

        io.adapter(createAdapter(socketAdapterPubClient, socketAdapterSubClient));
        updateSocketHealth({
            adapterMode: 'redis',
            backplaneReady: true,
            lastAdapterError: '',
        });
        logger.info('socket.backplane_ready', { adapterMode: 'redis' });
    } catch (error) {
        updateSocketHealth({
            adapterMode: 'local',
            backplaneReady: false,
            lastAdapterError: error?.message || 'socket_backplane_failed',
        });
        logger.warn('socket.backplane_failed', { error: socketHealth.lastAdapterError });
    }

    return getSocketHealth();
};

const initializeSocket = (httpServer) => {
    io = new Server(httpServer, {
        pingTimeout: 20000,
        pingInterval: 10000,
        connectTimeout: 10000,
        cors: {
            origin: getSocketCorsOrigins(),
            methods: ['GET', 'POST'],
            credentials: true,
        },
        maxHttpBufferSize: 1e6, // 1MB limit for handshakes/payloads
    });
    updateSocketHealth({
        initialized: true,
        adapterMode: 'local',
        backplaneReady: false,
        lastAdapterError: '',
    });

    // Mirror the HTTP auth path by verifying Firebase bearer tokens.
    io.use(async (socket, next) => {
        const token = String(socket.handshake.auth?.token || '').trim();
        if (!token) return next(new Error('Authentication error: Token missing'));

        try {
            socket.user = await resolveSocketUser(token);
            next();
        } catch (error) {
            next(new Error(`Authentication error: ${error.message}`));
        }
    });

    io.on('connection', (socket) => {
        const userId = String(socket.user.id);

        // Join a private room for this user to simplify targeted messaging
        socket.join(`user:${userId}`);
        if (socket.user.isAdmin) {
            socket.join(ADMIN_ROOM);
        }

        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);
        cancelPendingVideoSessionDisconnectCleanup({ userId });

        logger.info('socket.client_connected', { userId, socketId: socket.id });

        // ── Video Calling Signaling ──────────────────────────────────
        // Initiate a call: peer A -> server -> peer B
        socket.on('disconnect', async (reason) => {
            const userSet = userSockets.get(userId);
            let userStillConnected = false;
            if (userSet) {
                userSet.delete(socket.id);
                if (userSet.size === 0) {
                    userSockets.delete(userId);
                } else {
                    userStillConnected = true;
                }
            }

            if (!userStillConnected) {
                scheduleVideoSessionDisconnectCleanup({ userId });
            }

            socket.leave(`user:${userId}`);
            if (socket.user.isAdmin) {
                socket.leave(ADMIN_ROOM);
            }
            logger.info('socket.client_disconnected', { userId, socketId: socket.id, reason });
        });
    });

    return io;
};

const getIo = () => {
    if (!io) throw new Error('Socket.io has not been initialized');
    return io;
};

const sendMessageToUser = (userId, eventName, payload, options = {}) => {
    if (!io) return;

    const normalizedUserId = String(userId);
    const room = `user:${normalizedUserId}`;

    // Use rooms for better scalability and cleaner targeted messaging
    const emitAction = options.volatile ? io.to(room).volatile : io.to(room);
    
    emitAction.emit(eventName, payload);
    
    logger.debug('socket.event_emitted', { 
        userId: normalizedUserId, 
        eventName,
        room 
    });
};

const sendMessageToAdmins = (eventName, payload, options = {}) => {
    if (!io) return;

    const emitAction = options.volatile ? io.to(ADMIN_ROOM).volatile : io.to(ADMIN_ROOM);
    emitAction.emit(eventName, payload);

    logger.debug('socket.admin_event_emitted', {
        eventName,
        room: ADMIN_ROOM,
    });
};

module.exports = {
    attachSocketBackplane,
    cancelPendingVideoSessionDisconnectCleanup,
    clearListingVideoSession,
    clearSupportVideoSession,
    emitSupportRealtimeUpdate,
    finishVideoSessionDisconnectCleanup,
    getSocketHealth,
    getListingVideoSession,
    getSupportVideoSession,
    initializeSocket,
    getIo,
    markListingVideoSessionConnected,
    markSupportVideoSessionConnected,
    registerListingVideoSession,
    registerSupportVideoSession,
    resetSocketStateForTests,
    scheduleVideoSessionDisconnectCleanup,
    sendMessageToUser,
    sendMessageToAdmins,
};
