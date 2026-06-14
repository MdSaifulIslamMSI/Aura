const express = require('express');
const request = require('supertest');

const mockAuthUsers = new Map();
const mockSocketState = {
    supportSessions: new Map(),
    listingSessions: new Map(),
};

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const user = mockAuthUsers.get(token);
        if (!user) {
            const AppError = require('../utils/AppError');
            return next(new AppError('Not authorized', 401));
        }
        req.user = user;
        req.authUid = user.authUid || String(user._id);
        return next();
    },
    protectOptional: (_req, _res, next) => next(),
    admin: (req, _res, next) => {
        if (!req.user?.isAdmin) {
            const AppError = require('../utils/AppError');
            return next(new AppError('Admin access required', 403));
        }
        return next();
    },
    requireActiveAccount: (_req, _res, next) => next(),
    seller: (_req, _res, next) => next(),
}));

jest.mock('../middleware/routeSecurityGuards', () => ({
    authorizeListingOwner: () => (_req, _res, next) => next(),
    sensitiveActions: new Proxy({}, { get: () => (_req, _res, next) => next() }),
}));

jest.mock('../services/notificationService', () => ({
    sendPersistentNotification: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/supportTicketViews', () => ({
    loadAdminTicketView: jest.fn(async (ticketId) => ({ id: String(ticketId), view: 'admin' })),
    loadUserTicketView: jest.fn(async (ticketId) => ({ id: String(ticketId), view: 'user' })),
    serializeTicketForAdmin: jest.fn((ticket) => ticket),
    serializeTicketForUser: jest.fn((ticket) => ticket),
}));

jest.mock('../services/supportVideoService', () => ({
    markSupportTicketLiveCallConnected: jest.fn().mockResolvedValue({}),
    markSupportTicketLiveCallEnded: jest.fn().mockResolvedValue({ ticket: {}, message: null }),
    markSupportTicketLiveCallStarted: jest.fn().mockResolvedValue({ ticket: {}, message: null }),
    requestSupportTicketLiveCall: jest.fn().mockResolvedValue({ ticket: {}, message: null }),
}));

jest.mock('../services/socketService', () => ({
    clearListingVideoSession: jest.fn(({ listingId, sessionKey }) => {
        const key = String(listingId);
        const session = mockSocketState.listingSessions.get(key);
        if (session && (!sessionKey || session.sessionKey === sessionKey)) {
            mockSocketState.listingSessions.delete(key);
            return session;
        }
        return null;
    }),
    clearSupportVideoSession: jest.fn(({ ticketId, sessionKey }) => {
        const key = String(ticketId);
        const session = mockSocketState.supportSessions.get(key);
        if (session && (!sessionKey || session.sessionKey === sessionKey)) {
            mockSocketState.supportSessions.delete(key);
            return session;
        }
        return null;
    }),
    emitSupportRealtimeUpdate: jest.fn().mockResolvedValue(null),
    getListingVideoSession: jest.fn((listingId) => mockSocketState.listingSessions.get(String(listingId)) || null),
    getSupportVideoSession: jest.fn((ticketId) => mockSocketState.supportSessions.get(String(ticketId)) || null),
    markListingVideoSessionConnected: jest.fn(),
    markSupportVideoSessionConnected: jest.fn(),
    registerListingVideoSession: jest.fn((session) => {
        mockSocketState.listingSessions.set(String(session.listingId), session);
        return session;
    }),
    registerSupportVideoSession: jest.fn((session) => {
        mockSocketState.supportSessions.set(String(session.ticketId), session);
        return session;
    }),
    sendMessageToAdmins: jest.fn(),
    sendMessageToUser: jest.fn(),
}));

jest.mock('../services/livekitService', () => ({
    buildListingRoomName: jest.fn((listingId) => `aura-listing-${listingId}`),
    buildSupportRoomName: jest.fn((ticketId) => `aura-support-${ticketId}`),
    createSupportParticipantSession: jest.fn(async ({ roomName }) => ({
        accessToken: `token-for-${roomName}`,
        wsUrl: 'wss://livekit.test',
        roomName,
        sessionKey: roomName,
    })),
    deleteSupportRoom: jest.fn().mockResolvedValue(undefined),
    ensureSupportRoom: jest.fn(async (roomName) => roomName),
}));

const User = require('../models/User');
const Listing = require('../models/Listing');
const SupportTicket = require('../models/SupportTicket');
const listingRoutes = require('../routes/listingRoutes');
const supportRoutes = require('../routes/supportRoutes');
const { errorHandler } = require('../middleware/errorMiddleware');
const livekitService = require('../services/livekitService');

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/listings', listingRoutes);
    app.use('/api/support', supportRoutes);
    app.use(errorHandler);
    return app;
};

const bearer = (token) => `Bearer ${token}`;

const makeUser = async (overrides = {}) => User.create({
    name: 'Live Call User',
    email: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeListing = async ({ sellerId, buyerId }) => Listing.create({
    seller: sellerId,
    title: 'Inspection phone',
    description: 'A marketplace listing for live inspection',
    price: 25000,
    condition: 'good',
    category: 'mobiles',
    images: ['https://example.com/phone.png'],
    location: { city: 'Bengaluru', state: 'Karnataka' },
    status: 'active',
    source: 'user',
    escrow: {
        enabled: true,
        state: 'held',
        buyer: buyerId,
        amount: 25000,
        paymentIntentId: 'pi_live_call_escrow',
        paymentState: 'captured',
    },
});

describe('live call session key authorization', () => {
    let app;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockAuthUsers.clear();
        mockSocketState.supportSessions.clear();
        mockSocketState.listingSessions.clear();
        await User.deleteMany({});
        await Listing.deleteMany({});
        await SupportTicket.deleteMany({});
        app = buildApp();
    });

    test('support join rejects a foreign room key without minting a LiveKit token', async () => {
        const owner = await makeUser();
        const admin = await makeUser({ isAdmin: true, role: 'admin' });
        mockAuthUsers.set('owner-token', owner);
        const ticket = await SupportTicket.create({
            user: owner._id,
            subject: 'Need live help',
            category: 'order_issue',
            priority: 'high',
            liveCallLastStatus: 'ringing',
            liveCallLastSessionKey: 'support-ticket-canonical-room',
            liveCallStartedBy: admin._id,
        });
        mockSocketState.supportSessions.set(String(ticket._id), {
            ticketId: ticket._id,
            sessionKey: 'support-ticket-canonical-room',
            roomName: 'support-ticket-canonical-room',
            userId: String(owner._id),
            adminUserId: String(admin._id),
            status: 'ringing',
        });

        const response = await request(app)
            .post(`/api/support/${ticket._id}/video/join`)
            .set('Authorization', bearer('owner-token'))
            .send({ sessionKey: 'foreign-support-room' });

        expect([403, 409]).toContain(response.statusCode);
        expect(livekitService.ensureSupportRoom).not.toHaveBeenCalled();
        expect(livekitService.createSupportParticipantSession).not.toHaveBeenCalled();
    });

    test('support join token mint spam is throttled without minting after the limit', async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'rate-limit-test';
        const owner = await makeUser();
        const admin = await makeUser({ isAdmin: true, role: 'admin' });
        mockAuthUsers.set('owner-token', owner);
        const ticket = await SupportTicket.create({
            user: owner._id,
            subject: 'Need live help',
            category: 'order_issue',
            priority: 'high',
            liveCallLastStatus: 'ringing',
            liveCallLastSessionKey: 'support-ticket-canonical-room',
            liveCallStartedBy: admin._id,
        });
        mockSocketState.supportSessions.set(String(ticket._id), {
            ticketId: ticket._id,
            sessionKey: 'support-ticket-canonical-room',
            roomName: 'support-ticket-canonical-room',
            userId: String(owner._id),
            adminUserId: String(admin._id),
            status: 'ringing',
        });

        try {
            const responses = [];
            for (let attempt = 0; attempt < 21; attempt += 1) {
                responses.push(await request(app)
                    .post(`/api/support/${ticket._id}/video/join`)
                    .set('Authorization', bearer('owner-token'))
                    .send({ sessionKey: 'support-ticket-canonical-room' }));
            }

            expect(responses.slice(0, 20).every((response) => response.statusCode === 200)).toBe(true);
            expect(responses[20].statusCode).toBe(429);
            expect(livekitService.createSupportParticipantSession).toHaveBeenCalledTimes(20);
        } finally {
            if (previousNodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = previousNodeEnv;
            }
        }
    });

    test('support end rejects a foreign room key without deleting any room', async () => {
        const owner = await makeUser();
        const admin = await makeUser({ isAdmin: true, role: 'admin' });
        mockAuthUsers.set('owner-token', owner);
        const ticket = await SupportTicket.create({
            user: owner._id,
            subject: 'Need live help',
            category: 'order_issue',
            priority: 'high',
            liveCallLastStatus: 'connected',
            liveCallLastSessionKey: 'support-ticket-canonical-room',
            liveCallStartedBy: admin._id,
        });
        mockSocketState.supportSessions.set(String(ticket._id), {
            ticketId: ticket._id,
            sessionKey: 'support-ticket-canonical-room',
            roomName: 'support-ticket-canonical-room',
            userId: String(owner._id),
            adminUserId: String(admin._id),
            status: 'connected',
        });

        const response = await request(app)
            .post(`/api/support/${ticket._id}/video/end`)
            .set('Authorization', bearer('owner-token'))
            .send({ sessionKey: 'foreign-support-room', reason: 'hangup' });

        expect([403, 409]).toContain(response.statusCode);
        expect(livekitService.deleteSupportRoom).not.toHaveBeenCalled();
        expect(mockSocketState.supportSessions.get(String(ticket._id))?.sessionKey)
            .toBe('support-ticket-canonical-room');
    });

    test('listing join rejects a support room key without minting a listing token', async () => {
        const seller = await makeUser({ sellerProfile: { active: true } });
        const buyer = await makeUser();
        mockAuthUsers.set('seller-token', seller);
        const listing = await makeListing({ sellerId: seller._id, buyerId: buyer._id });
        mockSocketState.listingSessions.set(String(listing._id), {
            listingId: listing._id,
            sessionKey: 'aura-listing-canonical-room',
            roomName: 'aura-listing-canonical-room',
            sellerUserId: String(seller._id),
            buyerUserId: String(buyer._id),
            status: 'ringing',
        });

        const response = await request(app)
            .post(`/api/listings/${listing._id}/video/join`)
            .set('Authorization', bearer('seller-token'))
            .send({ sessionKey: 'aura-support-ticket-room' });

        expect([403, 409]).toContain(response.statusCode);
        expect(livekitService.ensureSupportRoom).not.toHaveBeenCalled();
        expect(livekitService.createSupportParticipantSession).not.toHaveBeenCalled();
    });

    test('listing end rejects a foreign room key without deleting any room', async () => {
        const seller = await makeUser({ sellerProfile: { active: true } });
        const buyer = await makeUser();
        mockAuthUsers.set('buyer-token', buyer);
        const listing = await makeListing({ sellerId: seller._id, buyerId: buyer._id });
        mockSocketState.listingSessions.set(String(listing._id), {
            listingId: listing._id,
            sessionKey: 'aura-listing-canonical-room',
            roomName: 'aura-listing-canonical-room',
            sellerUserId: String(seller._id),
            buyerUserId: String(buyer._id),
            status: 'connected',
        });

        const response = await request(app)
            .post(`/api/listings/${listing._id}/video/end`)
            .set('Authorization', bearer('buyer-token'))
            .send({ sessionKey: 'foreign-listing-room', reason: 'hangup' });

        expect([403, 409]).toContain(response.statusCode);
        expect(livekitService.deleteSupportRoom).not.toHaveBeenCalled();
        expect(mockSocketState.listingSessions.get(String(listing._id))?.sessionKey)
            .toBe('aura-listing-canonical-room');
    });
});
