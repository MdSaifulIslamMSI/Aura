const express = require('express');
const request = require('supertest');

const buildErrorHandlingApp = (routePath, user, handler) => {
    const app = express();
    app.use(express.json());
    app.post(routePath, (req, _res, next) => {
        req.user = user;
        next();
    }, handler);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({
            message: err.message,
        });
    });
    return app;
};

describe('live-call session key authorization', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('support ticket join rejects a client supplied session key for another room', async () => {
        let joinSupportLiveCallSession;
        let createSupportParticipantSession;

        jest.isolateModules(() => {
            const supportTicket = {
                _id: 'ticket-1',
                user: 'user-1',
                subject: 'Need help',
                status: 'open',
                liveCallLastStatus: 'ringing',
                liveCallLastSessionKey: 'support-room-ticket-1',
                liveCallLastMediaMode: 'video',
                liveCallLastContextLabel: 'Aura Support live call',
            };

            jest.doMock('../models/SupportTicket', () => ({
                findById: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(supportTicket),
                }),
            }));
            jest.doMock('../models/SupportMessage', () => ({
                create: jest.fn(),
                find: jest.fn(),
            }));
            jest.doMock('../services/socketService', () => ({
                clearSupportVideoSession: jest.fn(),
                emitSupportRealtimeUpdate: jest.fn(),
                getSupportVideoSession: jest.fn().mockReturnValue({
                    sessionKey: 'support-room-ticket-1',
                    mediaMode: 'video',
                    status: 'ringing',
                    contextLabel: 'Aura Support live call',
                }),
                markSupportVideoSessionConnected: jest.fn(),
                registerSupportVideoSession: jest.fn(),
                sendMessageToAdmins: jest.fn(),
                sendMessageToUser: jest.fn(),
            }));
            jest.doMock('../services/supportTicketViews', () => ({
                loadAdminTicketView: jest.fn().mockResolvedValue({ _id: 'ticket-1' }),
                loadUserTicketView: jest.fn().mockResolvedValue({ _id: 'ticket-1' }),
                serializeTicketForAdmin: jest.fn((ticket) => ticket),
                serializeTicketForUser: jest.fn((ticket) => ticket),
            }));
            jest.doMock('../services/supportVideoService', () => ({
                markSupportTicketLiveCallConnected: jest.fn(),
                markSupportTicketLiveCallEnded: jest.fn(),
                markSupportTicketLiveCallStarted: jest.fn(),
                requestSupportTicketLiveCall: jest.fn(),
            }));
            jest.doMock('../services/livekitService', () => {
                createSupportParticipantSession = jest.fn().mockResolvedValue({
                    accessToken: 'token-for-foreign-room',
                    roomName: 'foreign-support-room',
                    sessionKey: 'foreign-support-room',
                });
                return {
                    buildSupportRoomName: jest.fn().mockReturnValue('support-room-ticket-1'),
                    createSupportParticipantSession,
                    deleteSupportRoom: jest.fn(),
                    ensureSupportRoom: jest.fn().mockResolvedValue('foreign-support-room'),
                };
            });
            jest.doMock('../services/notificationService', () => ({
                sendPersistentNotification: jest.fn(),
            }));

            ({ joinSupportLiveCallSession } = require('../controllers/supportController'));
        });

        const app = buildErrorHandlingApp('/support/:id/video/join', {
            _id: 'user-1',
            name: 'Ticket Owner',
            isAdmin: false,
        }, joinSupportLiveCallSession);

        const res = await request(app)
            .post('/support/ticket-1/video/join')
            .send({ sessionKey: 'foreign-support-room' });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('session');
        expect(createSupportParticipantSession).not.toHaveBeenCalled();
    });

    test('listing live inspection join rejects a client supplied session key for another room', async () => {
        let joinListingVideoSession;
        let createSupportParticipantSession;

        jest.isolateModules(() => {
            const listing = {
                _id: 'listing-1',
                title: 'Gaming phone',
                status: 'active',
                seller: { _id: 'seller-1', name: 'Seller' },
                escrow: { buyer: 'buyer-1' },
            };

            jest.doMock('../models/Listing', () => ({
                findById: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(listing),
                }),
                find: jest.fn(),
                countDocuments: jest.fn(),
                updateOne: jest.fn(),
                aggregate: jest.fn(),
            }));
            jest.doMock('../models/Conversation', () => ({}));
            jest.doMock('../models/Message', () => ({}));
            jest.doMock('../models/User', () => ({}));
            jest.doMock('../models/PaymentIntent', () => ({}));
            jest.doMock('../services/marketplaceIntegrityService', () => ({
                normalizeListingInput: jest.fn((value) => value),
                buildRealListingsFilter: jest.fn((value) => value || {}),
                isRealListingDoc: jest.fn().mockReturnValue(true),
            }));
            jest.doMock('../services/listingService', () => ({
                sendCounterpartyMessageEmail: jest.fn().mockResolvedValue(undefined),
                assertEscrowEligibility: jest.fn(),
                buildEscrowCheckoutPayload: jest.fn(),
                appendEscrowPaymentEvent: jest.fn(),
                SELLER_PUBLIC_STRICT: 'name email avatar isVerified',
                SELLER_PRIVATE_THREAD: 'name email avatar isVerified',
            }));
            jest.doMock('../services/uploadSecurityPipeline', () => ({
                validateImageDataUriUpload: jest.fn(),
            }));
            jest.doMock('../services/sellerTrustService', () => ({
                buildSellerTrustPassport: jest.fn(),
            }));
            jest.doMock('../services/fraudDecisioningService', () => ({
                assessFraudDecision: jest.fn(),
            }));
            jest.doMock('../services/loyaltyService', () => ({
                awardLoyaltyPoints: jest.fn(),
            }));
            jest.doMock('../services/payments/providerFactory', () => ({
                getPaymentProvider: jest.fn(),
            }));
            jest.doMock('../services/payments/paymentService', () => ({
                captureIntentNow: jest.fn(),
            }));
            jest.doMock('../services/marketplaceOptimizers', () => ({
                solveAuraMatch: jest.fn((_criteria, listings) => listings),
                solveAuraCluster: jest.fn((value) => value),
            }));
            jest.doMock('../services/socketService', () => ({
                clearListingVideoSession: jest.fn(),
                getListingVideoSession: jest.fn().mockReturnValue({
                    sessionKey: 'listing-room-1',
                    mediaMode: 'video',
                    status: 'ringing',
                    contextLabel: 'Listing inspection',
                    startedByUserId: 'buyer-1',
                }),
                markListingVideoSessionConnected: jest.fn(),
                registerListingVideoSession: jest.fn(),
                sendMessageToUser: jest.fn(),
            }));
            jest.doMock('../services/livekitService', () => {
                createSupportParticipantSession = jest.fn().mockResolvedValue({
                    accessToken: 'token-for-foreign-listing-room',
                    roomName: 'foreign-listing-room',
                    sessionKey: 'foreign-listing-room',
                });
                return {
                    buildListingRoomName: jest.fn().mockReturnValue('listing-room-1'),
                    createSupportParticipantSession,
                    deleteSupportRoom: jest.fn(),
                    ensureSupportRoom: jest.fn().mockResolvedValue('foreign-listing-room'),
                };
            });

            ({ joinListingVideoSession } = require('../controllers/listingController'));
        });

        const app = buildErrorHandlingApp('/listings/:id/video/join', {
            _id: 'seller-1',
            name: 'Seller',
            isAdmin: false,
        }, joinListingVideoSession);

        const res = await request(app)
            .post('/listings/listing-1/video/join')
            .send({ sessionKey: 'foreign-listing-room' });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('session');
        expect(createSupportParticipantSession).not.toHaveBeenCalled();
    });

    test('support ticket end rejects a client supplied session key for another room', async () => {
        let endSupportLiveCallSession;
        let deleteSupportRoom;

        jest.isolateModules(() => {
            const supportTicket = {
                _id: 'ticket-1',
                user: 'user-1',
                subject: 'Need help',
                status: 'open',
                liveCallLastStatus: 'ringing',
                liveCallLastSessionKey: 'support-room-ticket-1',
                liveCallLastMediaMode: 'video',
                liveCallLastContextLabel: 'Aura Support live call',
            };

            jest.doMock('../models/SupportTicket', () => ({
                findById: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(supportTicket),
                }),
            }));
            jest.doMock('../models/SupportMessage', () => ({
                create: jest.fn(),
                find: jest.fn(),
            }));
            jest.doMock('../services/socketService', () => ({
                clearSupportVideoSession: jest.fn(),
                emitSupportRealtimeUpdate: jest.fn(),
                getSupportVideoSession: jest.fn().mockReturnValue({
                    sessionKey: 'support-room-ticket-1',
                    mediaMode: 'video',
                    status: 'ringing',
                    contextLabel: 'Aura Support live call',
                }),
                markSupportVideoSessionConnected: jest.fn(),
                registerSupportVideoSession: jest.fn(),
                sendMessageToAdmins: jest.fn(),
                sendMessageToUser: jest.fn(),
            }));
            jest.doMock('../services/supportTicketViews', () => ({
                loadAdminTicketView: jest.fn().mockResolvedValue({ _id: 'ticket-1' }),
                loadUserTicketView: jest.fn().mockResolvedValue({ _id: 'ticket-1' }),
                serializeTicketForAdmin: jest.fn((ticket) => ticket),
                serializeTicketForUser: jest.fn((ticket) => ticket),
            }));
            jest.doMock('../services/supportVideoService', () => ({
                markSupportTicketLiveCallConnected: jest.fn(),
                markSupportTicketLiveCallEnded: jest.fn(),
                markSupportTicketLiveCallStarted: jest.fn(),
                requestSupportTicketLiveCall: jest.fn(),
            }));
            jest.doMock('../services/livekitService', () => {
                deleteSupportRoom = jest.fn();
                return {
                    buildSupportRoomName: jest.fn().mockReturnValue('support-room-ticket-1'),
                    createSupportParticipantSession: jest.fn(),
                    deleteSupportRoom,
                    ensureSupportRoom: jest.fn(),
                };
            });
            jest.doMock('../services/notificationService', () => ({
                sendPersistentNotification: jest.fn(),
            }));

            ({ endSupportLiveCallSession } = require('../controllers/supportController'));
        });

        const app = buildErrorHandlingApp('/support/:id/video/end', {
            _id: 'user-1',
            name: 'Ticket Owner',
            isAdmin: false,
        }, endSupportLiveCallSession);

        const res = await request(app)
            .post('/support/ticket-1/video/end')
            .send({ sessionKey: 'foreign-support-room' });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('session');
        expect(deleteSupportRoom).not.toHaveBeenCalled();
    });

    test('listing live inspection end rejects a client supplied session key for another room', async () => {
        let endListingVideoSession;
        let deleteSupportRoom;

        jest.isolateModules(() => {
            const listing = {
                _id: 'listing-1',
                title: 'Gaming phone',
                status: 'active',
                seller: { _id: 'seller-1', name: 'Seller' },
                escrow: { buyer: 'buyer-1' },
            };

            jest.doMock('../models/Listing', () => ({
                findById: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(listing),
                }),
                find: jest.fn(),
                countDocuments: jest.fn(),
                updateOne: jest.fn(),
                aggregate: jest.fn(),
            }));
            jest.doMock('../models/Conversation', () => ({}));
            jest.doMock('../models/Message', () => ({}));
            jest.doMock('../models/User', () => ({}));
            jest.doMock('../models/PaymentIntent', () => ({}));
            jest.doMock('../services/marketplaceIntegrityService', () => ({
                normalizeListingInput: jest.fn((value) => value),
                buildRealListingsFilter: jest.fn((value) => value || {}),
                isRealListingDoc: jest.fn().mockReturnValue(true),
            }));
            jest.doMock('../services/listingService', () => ({
                sendCounterpartyMessageEmail: jest.fn().mockResolvedValue(undefined),
                assertEscrowEligibility: jest.fn(),
                buildEscrowCheckoutPayload: jest.fn(),
                appendEscrowPaymentEvent: jest.fn(),
                SELLER_PUBLIC_STRICT: 'name email avatar isVerified',
                SELLER_PRIVATE_THREAD: 'name email avatar isVerified',
            }));
            jest.doMock('../services/uploadSecurityPipeline', () => ({
                validateImageDataUriUpload: jest.fn(),
            }));
            jest.doMock('../services/sellerTrustService', () => ({
                buildSellerTrustPassport: jest.fn(),
            }));
            jest.doMock('../services/fraudDecisioningService', () => ({
                assessFraudDecision: jest.fn(),
            }));
            jest.doMock('../services/loyaltyService', () => ({
                awardLoyaltyPoints: jest.fn(),
            }));
            jest.doMock('../services/payments/providerFactory', () => ({
                getPaymentProvider: jest.fn(),
            }));
            jest.doMock('../services/payments/paymentService', () => ({
                captureIntentNow: jest.fn(),
            }));
            jest.doMock('../services/marketplaceOptimizers', () => ({
                solveAuraMatch: jest.fn((_criteria, listings) => listings),
                solveAuraCluster: jest.fn((value) => value),
            }));
            jest.doMock('../services/socketService', () => ({
                clearListingVideoSession: jest.fn(),
                getListingVideoSession: jest.fn().mockReturnValue({
                    sessionKey: 'listing-room-1',
                    mediaMode: 'video',
                    status: 'ringing',
                    contextLabel: 'Listing inspection',
                    startedByUserId: 'buyer-1',
                }),
                markListingVideoSessionConnected: jest.fn(),
                registerListingVideoSession: jest.fn(),
                sendMessageToUser: jest.fn(),
            }));
            jest.doMock('../services/livekitService', () => {
                deleteSupportRoom = jest.fn();
                return {
                    buildListingRoomName: jest.fn().mockReturnValue('listing-room-1'),
                    createSupportParticipantSession: jest.fn(),
                    deleteSupportRoom,
                    ensureSupportRoom: jest.fn(),
                };
            });

            ({ endListingVideoSession } = require('../controllers/listingController'));
        });

        const app = buildErrorHandlingApp('/listings/:id/video/end', {
            _id: 'seller-1',
            name: 'Seller',
            isAdmin: false,
        }, endListingVideoSession);

        const res = await request(app)
            .post('/listings/listing-1/video/end')
            .send({ sessionKey: 'foreign-listing-room' });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('session');
        expect(deleteSupportRoom).not.toHaveBeenCalled();
    });
});
