jest.mock('../models/Listing', () => ({
    countDocuments: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    find: jest.fn(),
}));
jest.mock('../models/Conversation', () => ({}));
jest.mock('../models/Message', () => ({}));
jest.mock('../models/User', () => ({}));
jest.mock('../models/PaymentIntent', () => ({}));
jest.mock('../models/PaymentEvent', () => ({}));
jest.mock('../services/fraudDecisioningService', () => ({
    assessFraudDecision: jest.fn().mockResolvedValue({ blocked: false, reviewRequired: false }),
}));
jest.mock('../services/loyaltyService', () => ({
    awardLoyaltyPoints: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/sellerTrustService', () => ({
    buildSellerTrustPassport: jest.fn(),
}));
jest.mock('../services/listingService', () => ({
    serializeThreadForUser: jest.fn(),
    sendCounterpartyMessageEmail: jest.fn(),
    assertEscrowEligibility: jest.fn(),
    buildEscrowCheckoutPayload: jest.fn(),
    appendEscrowPaymentEvent: jest.fn(),
    SELLER_PUBLIC_STRICT: 'name email avatar isVerified',
    SELLER_PRIVATE_THREAD: 'name email avatar isVerified',
}));
jest.mock('../services/payments/providerFactory', () => ({
    getPaymentProvider: jest.fn(),
}));
jest.mock('../services/payments/paymentService', () => ({
    captureIntentNow: jest.fn(),
}));
jest.mock('../services/socketService', () => ({
    clearListingVideoSession: jest.fn(),
    getListingVideoSession: jest.fn(),
    markListingVideoSessionConnected: jest.fn(),
    registerListingVideoSession: jest.fn(),
    sendMessageToUser: jest.fn(),
}));
jest.mock('../services/marketplaceOptimizers', () => ({
    solveAuraMatch: jest.fn((_options, listings) => listings),
    solveAuraCluster: jest.fn(() => []),
}));
jest.mock('../services/livekitService', () => ({
    buildListingRoomName: jest.fn(),
    createSupportParticipantSession: jest.fn(),
    deleteSupportRoom: jest.fn(),
    ensureSupportRoom: jest.fn(),
}));
jest.mock('../services/payments/constants', () => ({
    DIGITAL_METHODS: ['UPI'],
    INTENT_EXPIRY_MINUTES: 15,
    PAYMENT_STATUSES: {
        CREATED: 'created',
        CHALLENGE_PENDING: 'challenge_pending',
        AUTHORIZED: 'authorized',
        CAPTURED: 'captured',
    },
}));
jest.mock('../services/payments/helpers', () => ({
    makeEventId: jest.fn(),
    makeIntentId: jest.fn(() => 'intent-1'),
    normalizeMethod: jest.fn((value) => value || 'UPI'),
    roundCurrency: jest.fn((value) => Number(value || 0)),
    mapProviderTypeToPaymentMethod: jest.fn(),
}));

const Listing = require('../models/Listing');
const { assessFraudDecision } = require('../services/fraudDecisioningService');
const { createListing } = require('../controllers/listingController');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('listingController image upload validation', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('rejects listing image data URI magic-byte mismatch before persistence', async () => {
        const req = {
            body: {
                title: 'Real marketplace item',
                description: 'A clean description for a real item.',
                price: 1200,
                negotiable: true,
                condition: 'good',
                category: 'electronics',
                images: [`data:image/jpeg;base64,${pngBase64}`],
                location: { city: 'Mumbai', state: 'Maharashtra' },
            },
            user: {
                _id: 'user-1',
                isVerified: true,
                phone: '+919876543210',
            },
            headers: {},
        };
        const res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        await createListing(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Listing image content does not match declared image type',
            statusCode: 400,
        }));
        expect(assessFraudDecision).not.toHaveBeenCalled();
        expect(Listing.create).not.toHaveBeenCalled();
    });
});
