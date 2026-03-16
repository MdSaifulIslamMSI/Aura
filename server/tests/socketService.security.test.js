const createListingLeanResult = (listing) => ({
    lean: jest.fn().mockResolvedValue(listing),
});

describe('socketService call security', () => {
    let fakeIo;
    let connectionHandler;
    let socketService;
    let Listing;

    const emittedEvents = [];

    const createSocket = ({ userId, name = 'User', socketId = `socket-${userId}` }) => {
        const handlers = new Map();
        const socket = {
            id: socketId,
            user: { id: userId, name },
            handshake: { auth: { token: `token-${userId}` } },
            join: jest.fn(),
            leave: jest.fn(),
            on: jest.fn((eventName, handler) => {
                handlers.set(eventName, handler);
            }),
            emit: jest.fn(),
            _handlers: handlers,
        };
        return socket;
    };

    const trigger = async (socket, eventName, payload) => {
        const handler = socket._handlers.get(eventName);
        if (!handler) throw new Error(`No handler registered for ${eventName}`);
        await handler(payload);
    };

    beforeEach(() => {
        jest.resetModules();
        emittedEvents.length = 0;

        fakeIo = {
            use: jest.fn(),
            on: jest.fn((eventName, handler) => {
                if (eventName === 'connection') {
                    connectionHandler = handler;
                }
            }),
            to: jest.fn((room) => ({
                emit: (eventName, payload) => {
                    emittedEvents.push({ room, eventName, payload });
                },
                volatile: {
                    emit: (eventName, payload) => {
                        emittedEvents.push({ room, eventName, payload, volatile: true });
                    },
                },
            })),
        };

        jest.doMock('socket.io', () => ({
            Server: jest.fn(() => fakeIo),
        }));

        jest.doMock('../config/firebase', () => ({
            auth: () => ({ verifyIdToken: jest.fn() }),
        }));

        jest.doMock('../models/User', () => ({
            findOne: jest.fn(),
        }));

        jest.doMock('../models/Listing', () => ({
            findById: jest.fn(),
        }));

        jest.doMock('../utils/logger', () => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        }));

        socketService = require('../services/socketService');
        Listing = require('../models/Listing');
        socketService.initializeSocket({});
    });

    test('rejects video:call:signal when caller targets arbitrary user', async () => {
        const sellerId = '507f191e810c19729de860ea';
        const buyerId = '507f191e810c19729de860eb';
        const attackerTarget = '507f191e810c19729de860ec';
        const listingId = '507f191e810c19729de860ed';

        Listing.findById.mockReturnValue(createListingLeanResult({
            _id: listingId,
            seller: sellerId,
            escrow: { buyer: buyerId },
        }));

        const sellerSocket = createSocket({ userId: sellerId, name: 'Seller' });
        connectionHandler(sellerSocket);

        await trigger(sellerSocket, 'video:call:signal', {
            listingId,
            targetUserId: attackerTarget,
            signalData: { type: 'offer' },
        });

        expect(sellerSocket.emit).toHaveBeenCalledWith('video:call:error', {
            message: 'Unauthorized call attempt',
        });
        expect(emittedEvents).toHaveLength(0);
    });

    test('rejects video:call:hangup without an active authorized call session', async () => {
        const sellerId = '507f191e810c19729de860fa';
        const buyerId = '507f191e810c19729de860fb';
        const listingId = '507f191e810c19729de860fc';

        Listing.findById.mockReturnValue(createListingLeanResult({
            _id: listingId,
            seller: sellerId,
            escrow: { buyer: buyerId },
        }));

        const sellerSocket = createSocket({ userId: sellerId, name: 'Seller' });
        connectionHandler(sellerSocket);

        await trigger(sellerSocket, 'video:call:hangup', {
            listingId,
            targetUserId: buyerId,
        });

        expect(sellerSocket.emit).toHaveBeenCalledWith('video:call:error', {
            message: 'No active call session',
        });

        const terminatedEvents = emittedEvents.filter((event) => event.eventName === 'video:call:terminated');
        expect(terminatedEvents).toHaveLength(0);
    });
});
