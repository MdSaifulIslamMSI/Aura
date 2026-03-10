const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

let io;
// Map to track userId -> Set of socketIds (handles multiple tabs/devices)
const userSockets = new Map();

const initializeSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:5173',
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    // JWT Authentication middleware for Socket.io
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('Authentication error: Token missing'));

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (!decoded || !decoded.id) return next(new Error('Authentication error: Invalid token'));
            
            socket.user = decoded;
            next();
        } catch (error) {
            next(new Error('Authentication error: ' + error.message));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user.id;
        
        // Track the socket for this user
        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);
        
        logger.info(`socket.client_connected`, { userId, socketId: socket.id });

        socket.on('disconnect', () => {
            const userSet = userSockets.get(userId);
            if (userSet) {
                userSet.delete(socket.id);
                if (userSet.size === 0) {
                    userSockets.delete(userId);
                }
            }
            logger.info(`socket.client_disconnected`, { userId, socketId: socket.id });
        });
    });

    return io;
};

const getIo = () => {
    if (!io) throw new Error('Socket.io has not been initialized');
    return io;
};

const sendMessageToUser = (userId, eventName, payload) => {
    if (!io) return; // Fail gracefully if socket is down, don't break HTTP API

    const targetSockets = userSockets.get(String(userId));
    if (targetSockets && targetSockets.size > 0) {
        targetSockets.forEach(socketId => {
            io.to(socketId).emit(eventName, payload);
        });
        logger.info(`socket.event_emitted`, { userId, eventName, socketCount: targetSockets.size });
    }
};

module.exports = {
    initializeSocket,
    getIo,
    sendMessageToUser
};
