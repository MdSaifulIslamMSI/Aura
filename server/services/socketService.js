const { Server } = require('socket.io');
const firebaseAdmin = require('../config/firebase');
const User = require('../models/User');
const Listing = require('../models/Listing');
const logger = require('../utils/logger');

let io;
// Map to track userId -> Set of socketIds (handles multiple tabs/devices)
const userSockets = new Map();
const activeCallSessions = new Map();
const ADMIN_ROOM = 'admins';

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

const getActiveCallSessionKey = ({ listingId, userA, userB }) => {
    const [firstUserId, secondUserId] = [String(userA), String(userB)].sort();
    return `${String(listingId)}:${firstUserId}:${secondUserId}`;
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
        listingId: normalizedListingId,
        sellerId,
        buyerId,
    };
};

const initializeSocket = (httpServer) => {
    io = new Server(httpServer, {
        pingTimeout: 20000,
        pingInterval: 10000,
        connectTimeout: 10000,
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:5173',
            methods: ['GET', 'POST'],
            credentials: true,
        },
        maxHttpBufferSize: 1e6, // 1MB limit for handshakes/payloads
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
            const { targetUserId, listingId, signalData } = payload || {};
            
            try {
                const authResult = await authorizeListingCallEvent({
                    callerUserId: userId,
                    targetUserId,
                    listingId,
                });

                const sessionKey = getActiveCallSessionKey({
                    listingId: authResult.listingId,
                    userA: userId,
                    userB: targetUserId,
                });

                activeCallSessions.set(sessionKey, {
                    listingId: authResult.listingId,
                    participants: [String(userId), String(targetUserId)],
                });

                logger.info('video.call_initiated', { from: userId, to: targetUserId, listingId });
                
                sendMessageToUser(targetUserId, 'video:call:incoming', {
                    fromUserId: userId,
                    fromName: socket.user.name,
                    listingId: authResult.listingId,
                    signalData
                });
            } catch (err) {
                logger.error('video.call_initiate_failed', { error: err.message, from: userId, to: targetUserId, listingId });
                socket.emit('video:call:error', { message: err.message || 'Failed to initiate video call' });
            }
        });

        // Relay signaling data (Offer/Answer/ICE): peer A <-> server <-> peer B
        socket.on('video:call:signal', async (payload) => {
            const { targetUserId, listingId, signalData } = payload || {};

            try {
                const authResult = await authorizeListingCallEvent({
                    callerUserId: userId,
                    targetUserId,
                    listingId,
                });

                const sessionKey = getActiveCallSessionKey({
                    listingId: authResult.listingId,
                    userA: userId,
                    userB: targetUserId,
                });

                if (!activeCallSessions.has(sessionKey)) {
                    throw new Error('No active call session');
                }

                sendMessageToUser(targetUserId, 'video:call:signal', {
                    fromUserId: userId,
                    listingId: authResult.listingId,
                    signalData
                });
            } catch (err) {
                logger.warn('video.call_signal_rejected', {
                    error: err.message,
                    from: userId,
                    to: targetUserId,
                    listingId,
                });
                socket.emit('video:call:error', { message: err.message || 'Failed to relay call signal' });
            }
        });

        // Terminate call: peer A -> server -> peer B
        socket.on('video:call:hangup', async (payload) => {
            const { targetUserId, listingId } = payload || {};

            try {
                const authResult = await authorizeListingCallEvent({
                    callerUserId: userId,
                    targetUserId,
                    listingId,
                });

                const sessionKey = getActiveCallSessionKey({
                    listingId: authResult.listingId,
                    userA: userId,
                    userB: targetUserId,
                });

                if (!activeCallSessions.has(sessionKey)) {
                    throw new Error('No active call session');
                }

                activeCallSessions.delete(sessionKey);

                logger.info('video.call_terminated', { from: userId, to: targetUserId, listingId: authResult.listingId });
                sendMessageToUser(targetUserId, 'video:call:terminated', {
                    fromUserId: userId,
                    listingId: authResult.listingId,
                });
            } catch (err) {
                logger.warn('video.call_hangup_rejected', {
                    error: err.message,
                    from: userId,
                    to: targetUserId,
                    listingId,
                });
                socket.emit('video:call:error', { message: err.message || 'Failed to hang up call' });
            }
        });

        socket.on('disconnect', (reason) => {
            const userSet = userSockets.get(userId);
            if (userSet) {
                userSet.delete(socket.id);
                if (userSet.size === 0) {
                    userSockets.delete(userId);
                }
            }

            removeUserFromActiveCallSessions(userId);

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
    initializeSocket,
    getIo,
    sendMessageToUser,
    sendMessageToAdmins,
};
