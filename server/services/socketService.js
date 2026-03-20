const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const firebaseAdmin = require('../config/firebase');
const { allowedOrigins } = require('../config/corsFlags');
const { getRedisClient } = require('../config/redis');
const User = require('../models/User');
const Listing = require('../models/Listing');
const logger = require('../utils/logger');
const {
    loadAdminTicketView,
    loadUserTicketView,
} = require('./supportTicketViews');
const {
    buildVideoCallSessionKey,
    closeVideoCallSessionsForUser,
    endVideoCallSession,
    getActiveVideoCallSession,
    markVideoCallSessionConnected,
    registerVideoCallSession,
    touchVideoCallSessionSignal,
} = require('./videoCallSessionService');
const {
    loadSupportTicketForVideo,
    markSupportTicketLiveCallConnected,
    markSupportTicketLiveCallEnded,
    markSupportTicketLiveCallStarted,
} = require('./supportVideoService');

let io;
// Map to track userId -> Set of socketIds (handles multiple tabs/devices)
const userSockets = new Map();
const activeCallSessions = new Map();
const ADMIN_ROOM = 'admins';
let socketAdapterPubClient = null;
let socketAdapterSubClient = null;

const socketHealth = {
    initialized: false,
    adapterMode: 'local',
    backplaneReady: false,
    lastAdapterError: '',
};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

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

const removeUserFromActiveCallSessions = (userId) => {
    const normalizedUserId = String(userId);

    for (const [sessionKey, session] of activeCallSessions.entries()) {
        if (session.participants.includes(normalizedUserId)) {
            activeCallSessions.delete(sessionKey);
        }
    }
};

const authorizeListingCallEvent = async ({ callerUserId, targetUserId, listingId }) => {
    const normalizedCallerId = String(callerUserId || '');
    const normalizedTargetId = String(targetUserId || '');
    const normalizedListingId = String(listingId || '');

    if (!normalizedListingId || !normalizedTargetId) {
        throw new Error('Missing call metadata');
    }

    const listing = await Listing.findById(normalizedListingId).lean();
    if (!listing) {
        throw new Error('Listing not found');
    }

    const sellerId = String(listing.seller || '');
    const buyerId = String(listing.escrow?.buyer || '');
    const isCallerSeller = normalizedCallerId === sellerId;
    const isCallerBuyer = normalizedCallerId === buyerId;

    if (!isCallerSeller && !isCallerBuyer) {
        throw new Error('Unauthorized call attempt');
    }

    const expectedTargetUserId = isCallerSeller ? buyerId : sellerId;

    if (!expectedTargetUserId || normalizedTargetId !== expectedTargetUserId) {
        throw new Error('Unauthorized call attempt');
    }

    return {
        channelType: 'listing',
        contextId: normalizedListingId,
        listingId: normalizedListingId,
        sellerId,
        buyerId,
        contextLabel: 'Marketplace live inspection',
    };
};

const authorizeSupportTicketCallEvent = async ({
    callerProfile,
    targetUserId,
    supportTicketId,
    eventType = 'signal',
}) => {
    const normalizedCallerId = String(callerProfile?.id || '');
    const normalizedTargetId = String(targetUserId || '');
    const normalizedTicketId = String(supportTicketId || '');

    if (!normalizedTicketId || !normalizedTargetId) {
        throw new Error('Missing call metadata');
    }

    const ticket = await loadSupportTicketForVideo(normalizedTicketId);
    const ticketOwnerId = String(ticket.user || '');
    const callerIsAdmin = Boolean(callerProfile?.isAdmin);
    const callerIsOwner = normalizedCallerId === ticketOwnerId;

    if (eventType === 'initiate') {
        if (String(ticket.status || '') === 'closed') {
            throw new Error('Closed tickets cannot start live calls');
        }
        if (!callerIsAdmin || normalizedTargetId !== ticketOwnerId) {
            throw new Error('Unauthorized call attempt');
        }
    } else if (callerIsAdmin) {
        if (normalizedTargetId !== ticketOwnerId) {
            throw new Error('Unauthorized call attempt');
        }
    } else {
        if (!callerIsOwner) {
            throw new Error('Unauthorized call attempt');
        }

        const adminUser = await User.findById(normalizedTargetId)
            .select('_id isAdmin')
            .lean();
        if (!adminUser?._id || !adminUser.isAdmin) {
            throw new Error('Unauthorized call attempt');
        }
    }

    return {
        channelType: 'support_ticket',
        contextId: normalizedTicketId,
        supportTicketId: normalizedTicketId,
        ticketOwnerId,
        ticketSubject: String(ticket.subject || 'Support ticket'),
        ticketStatus: String(ticket.status || 'open'),
        contextLabel: `Live support for ${String(ticket.subject || 'support ticket')}`,
    };
};

const authorizeVideoCallEvent = async ({
    callerProfile,
    targetUserId,
    listingId,
    channelType,
    contextId,
    eventType,
}) => {
    if (String(channelType || '') === 'support_ticket') {
        return authorizeSupportTicketCallEvent({
            callerProfile,
            targetUserId,
            supportTicketId: contextId,
            eventType,
        });
    }

    return authorizeListingCallEvent({
        callerUserId: callerProfile?.id,
        targetUserId,
        listingId: contextId || listingId,
    });
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
    activeCallSessions: activeCallSessions.size,
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

        logger.info('socket.client_connected', { userId, socketId: socket.id });

        // ── Video Calling Signaling ──────────────────────────────────
        // Initiate a call: peer A -> server -> peer B
        socket.on('video:call:initiate', async (payload) => {
            const { targetUserId, listingId, signalData, channelType, contextId } = payload || {};

            try {
                const authResult = await authorizeVideoCallEvent({
                    callerProfile: socket.user,
                    targetUserId,
                    listingId,
                    channelType,
                    contextId,
                    eventType: 'initiate',
                });

                const sessionKey = buildVideoCallSessionKey({
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    userA: userId,
                    userB: targetUserId,
                });

                const persistedSession = await registerVideoCallSession({
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    callerUserId: userId,
                    targetUserId,
                });

                activeCallSessions.set(sessionKey, {
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    participants: [String(userId), String(targetUserId)],
                    status: persistedSession?.status || 'ringing',
                });

                if (authResult.channelType === 'support_ticket') {
                    const supportCallUpdate = await markSupportTicketLiveCallStarted({
                        ticketId: authResult.supportTicketId,
                        startedByUserId: userId,
                        startedByRole: socket.user.isAdmin ? 'admin' : 'user',
                        sessionKey: persistedSession?.sessionKey || sessionKey,
                        contextLabel: socket.user.isAdmin
                            ? `Aura Support started a live call for "${authResult.ticketSubject}"`
                            : `Customer started a live call for "${authResult.ticketSubject}"`,
                    });
                    await emitSupportRealtimeUpdate({
                        ticketId: authResult.supportTicketId,
                        eventName: 'support:message:new',
                        message: supportCallUpdate?.message || null,
                    });
                }

                logger.info('video.call_initiated', {
                    from: userId,
                    to: targetUserId,
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                });

                sendMessageToUser(targetUserId, 'video:call:incoming', {
                    fromUserId: userId,
                    fromName: socket.user.name,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    contextLabel: authResult.contextLabel,
                    callId: persistedSession?.sessionKey || sessionKey,
                    signalData,
                });
            } catch (err) {
                logger.error('video.call_initiate_failed', {
                    error: err.message,
                    from: userId,
                    to: targetUserId,
                    listingId,
                    channelType,
                    contextId,
                });
                socket.emit('video:call:error', { message: err.message || 'Failed to initiate video call' });
            }
        });

        // Relay signaling data (Offer/Answer/ICE): peer A <-> server <-> peer B
        socket.on('video:call:signal', async (payload) => {
            const { targetUserId, listingId, signalData, channelType, contextId } = payload || {};

            try {
                const authResult = await authorizeVideoCallEvent({
                    callerProfile: socket.user,
                    targetUserId,
                    listingId,
                    channelType,
                    contextId,
                    eventType: 'signal',
                });

                const sessionKey = buildVideoCallSessionKey({
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    userA: userId,
                    userB: targetUserId,
                });

                let session = activeCallSessions.get(sessionKey);
                if (!session) {
                    session = await getActiveVideoCallSession({
                        channelType: authResult.channelType,
                        contextId: authResult.contextId,
                        listingId: authResult.listingId,
                        supportTicketId: authResult.supportTicketId,
                        userA: userId,
                        userB: targetUserId,
                    });
                    if (session) {
                        activeCallSessions.set(sessionKey, {
                            channelType: authResult.channelType,
                            contextId: authResult.contextId,
                            listingId: authResult.listingId,
                            supportTicketId: authResult.supportTicketId,
                            participants: [String(userId), String(targetUserId)],
                            status: session.status,
                        });
                    }
                }

                if (!session) {
                    throw new Error('No active call session');
                }

                if (String(signalData?.type || '') === 'answer') {
                    await markVideoCallSessionConnected({
                        channelType: authResult.channelType,
                        contextId: authResult.contextId,
                        listingId: authResult.listingId,
                        supportTicketId: authResult.supportTicketId,
                        userA: userId,
                        userB: targetUserId,
                    });
                    activeCallSessions.set(sessionKey, {
                        channelType: authResult.channelType,
                        contextId: authResult.contextId,
                        listingId: authResult.listingId,
                        supportTicketId: authResult.supportTicketId,
                        participants: [String(userId), String(targetUserId)],
                        status: 'connected',
                    });

                    if (authResult.channelType === 'support_ticket') {
                        await markSupportTicketLiveCallConnected({
                            ticketId: authResult.supportTicketId,
                            sessionKey,
                        });
                        await emitSupportRealtimeUpdate({
                            ticketId: authResult.supportTicketId,
                        });
                    }
                } else {
                    await touchVideoCallSessionSignal({
                        channelType: authResult.channelType,
                        contextId: authResult.contextId,
                        listingId: authResult.listingId,
                        supportTicketId: authResult.supportTicketId,
                        userA: userId,
                        userB: targetUserId,
                    });
                }

                sendMessageToUser(targetUserId, 'video:call:signal', {
                    fromUserId: userId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    signalData,
                });
            } catch (err) {
                logger.warn('video.call_signal_rejected', {
                    error: err.message,
                    from: userId,
                    to: targetUserId,
                    listingId,
                    channelType,
                    contextId,
                });
                socket.emit('video:call:error', { message: err.message || 'Failed to relay call signal' });
            }
        });

        // Terminate call: peer A -> server -> peer B
        socket.on('video:call:hangup', async (payload) => {
            const { targetUserId, listingId, channelType, contextId } = payload || {};

            try {
                const authResult = await authorizeVideoCallEvent({
                    callerProfile: socket.user,
                    targetUserId,
                    listingId,
                    channelType,
                    contextId,
                    eventType: 'hangup',
                });

                const sessionKey = buildVideoCallSessionKey({
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    userA: userId,
                    userB: targetUserId,
                });

                const activeSession = activeCallSessions.get(sessionKey) || await getActiveVideoCallSession({
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    userA: userId,
                    userB: targetUserId,
                });

                if (!activeSession) {
                    throw new Error('No active call session');
                }

                await endVideoCallSession({
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    userA: userId,
                    userB: targetUserId,
                    reason: 'hangup',
                });
                activeCallSessions.delete(sessionKey);

                if (authResult.channelType === 'support_ticket') {
                    const supportCallUpdate = await markSupportTicketLiveCallEnded({
                        ticketId: authResult.supportTicketId,
                        endedByRole: socket.user.isAdmin ? 'admin' : 'user',
                        sessionKey,
                        reason: 'hangup',
                    });
                    await emitSupportRealtimeUpdate({
                        ticketId: authResult.supportTicketId,
                        eventName: 'support:message:new',
                        message: supportCallUpdate?.message || null,
                    });
                }

                logger.info('video.call_terminated', {
                    from: userId,
                    to: targetUserId,
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                });
                sendMessageToUser(targetUserId, 'video:call:terminated', {
                    fromUserId: userId,
                    listingId: authResult.listingId,
                    supportTicketId: authResult.supportTicketId,
                    channelType: authResult.channelType,
                    contextId: authResult.contextId,
                });
            } catch (err) {
                logger.warn('video.call_hangup_rejected', {
                    error: err.message,
                    from: userId,
                    to: targetUserId,
                    listingId,
                    channelType,
                    contextId,
                });
                socket.emit('video:call:error', { message: err.message || 'Failed to hang up call' });
            }
        });

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
                const endedSessions = await closeVideoCallSessionsForUser({
                    userId,
                    reason: 'participant_disconnect',
                }).catch(() => []);
                removeUserFromActiveCallSessions(userId);

                for (const session of endedSessions) {
                    const counterpartyUserId = session.participants.find((participantId) => participantId !== String(userId));
                    if (session.channelType === 'support_ticket' && session.supportTicketId) {
                        const supportCallUpdate = await markSupportTicketLiveCallEnded({
                            ticketId: session.supportTicketId,
                            endedByRole: 'system',
                            sessionKey: session.sessionKey,
                            reason: 'participant_disconnect',
                        }).catch(() => null);
                        if (supportCallUpdate) {
                            await emitSupportRealtimeUpdate({
                                ticketId: session.supportTicketId,
                                eventName: 'support:message:new',
                                message: supportCallUpdate?.message || null,
                            }).catch(() => null);
                        }
                    }
                    if (counterpartyUserId) {
                        sendMessageToUser(counterpartyUserId, 'video:call:terminated', {
                            fromUserId: userId,
                            listingId: session.listingId,
                            supportTicketId: session.supportTicketId,
                            channelType: session.channelType,
                            contextId: session.contextId,
                            reason: 'participant_disconnect',
                        });
                    }
                }
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
    getSocketHealth,
    initializeSocket,
    getIo,
    sendMessageToUser,
    sendMessageToAdmins,
};
