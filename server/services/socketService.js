const { Server } = require('socket.io');
const firebaseAdmin = require('../config/firebase');
const User = require('../models/User');
const logger = require('../utils/logger');

let io;
// Map to track userId -> Set of socketIds (handles multiple tabs/devices)
const userSockets = new Map();

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

        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);

        logger.info('socket.client_connected', { userId, socketId: socket.id });

        // ── Video Calling Signaling ──────────────────────────────────
        
const Listing = require('../models/Listing');

// ... (existing code)

        // Initiate a call: peer A -> server -> peer B
        socket.on('video:call:initiate', async (payload) => {
            const { targetUserId, listingId, signalData } = payload;
            
            try {
                // Defensive Security: Verify participants
                const listing = await Listing.findById(listingId).lean();
                if (!listing) {
                    throw new Error('Listing not found');
                }

                const sellerId = String(listing.seller);
                const isUserSeller = userId === sellerId;
                const isUserBuyer = userId === String(listing.escrow?.buyer);
                
                // Allow call only if the initiator is the buyer or seller
                // and the target is the other party.
                const isAuthorized = (isUserSeller && targetUserId === String(listing.escrow?.buyer)) ||
                                   (isUserBuyer && targetUserId === sellerId);

                if (!isAuthorized) {
                    logger.warn('video.call_unauthorized', { from: userId, to: targetUserId, listingId });
                    return socket.emit('video:call:error', { message: 'Unauthorized call attempt' });
                }

                logger.info('video.call_initiated', { from: userId, to: targetUserId, listingId });
                
                sendMessageToUser(targetUserId, 'video:call:incoming', {
                    fromUserId: userId,
                    fromName: socket.user.name,
                    listingId,
                    signalData
                });
            } catch (err) {
                logger.error('video.call_initiate_failed', { error: err.message });
                socket.emit('video:call:error', { message: 'Failed to initiate video call' });
            }
        });

        // Relay signaling data (Offer/Answer/ICE): peer A <-> server <-> peer B
        socket.on('video:call:signal', (payload) => {
            const { targetUserId, signalData } = payload;
            sendMessageToUser(targetUserId, 'video:call:signal', {
                fromUserId: userId,
                signalData
            });
        });

        // Terminate call: peer A -> server -> peer B
        socket.on('video:call:hangup', (payload) => {
            const { targetUserId } = payload;
            logger.info('video.call_terminated', { from: userId, to: targetUserId });
            sendMessageToUser(targetUserId, 'video:call:terminated', {
                fromUserId: userId
            });
        });

        socket.on('disconnect', (reason) => {
            const userSet = userSockets.get(userId);
            if (userSet) {
                userSet.delete(socket.id);
                if (userSet.size === 0) {
                    userSockets.delete(userId);
                }
            }
            socket.leave(`user:${userId}`);
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

module.exports = {
    initializeSocket,
    getIo,
    sendMessageToUser,
};
