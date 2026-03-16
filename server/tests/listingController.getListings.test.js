jest.mock('../models/Listing', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../services/marketplaceIntegrityService', () => ({
    normalizeListingInput: jest.fn(),
    getIntegrityIssue: jest.fn(),
    buildRealListingsFilter: jest.fn((filter) => filter),
    isRealListingDoc: jest.fn(() => true),
}));

jest.mock('../services/sellerTrustService', () => ({
    buildSellerTrustPassport: jest.fn(),
}));

jest.mock('../services/loyaltyService', () => ({
    awardLoyaltyPoints: jest.fn(),
}));

jest.mock('../services/listingService', () => ({
    serializeThreadForUser: jest.fn(),
    sendCounterpartyMessageEmail: jest.fn(),
    assertEscrowEligibility: jest.fn(),
    buildEscrowCheckoutPayload: jest.fn(),
    appendEscrowPaymentEvent: jest.fn(),
    SELLER_PUBLIC: 'name',
}));

jest.mock('../services/payments/providerFactory', () => ({
    getPaymentProvider: jest.fn(),
}));

jest.mock('../services/payments/riskEngine', () => ({
    evaluateRisk: jest.fn(),
}));

jest.mock('../services/payments/paymentService', () => ({
    captureIntentNow: jest.fn(),
}));

jest.mock('../services/socketService', () => ({
    sendMessageToUser: jest.fn(),
}));

jest.mock('../services/marketplaceOptimizers', () => ({
    solveAuraMatch: jest.fn((_config, listings) => listings),
}));

const Listing = require('../models/Listing');
const AppError = require('../utils/AppError');
const { getListings } = require('../controllers/listingController');

const createListingQueryChain = (result = []) => {
    const chain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(result),
    };
    return chain;
};

describe('listingController.getListings city filtering safety', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Listing.find.mockReturnValue(createListingQueryChain([]));
        Listing.countDocuments.mockResolvedValue(0);
    });

    test('rejects malicious regex payloads in city query', async () => {
        const req = {
            query: {
                city: '((a+)+)+$',
            },
        };
        const res = {
            json: jest.fn(),
        };
        const next = jest.fn();

        await getListings(req, res, next);

        expect(Listing.find).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        const [error] = next.mock.calls[0];
        expect(error).toBeInstanceOf(AppError);
        expect(error.statusCode).toBe(400);
        expect(error.message).toMatch(/City must be 1-80 characters/i);
    });

    test('uses anchored case-insensitive exact-match regex for safe city values', async () => {
        const req = {
            query: {
                city: 'New-Delhi',
                page: '1',
                limit: '12',
            },
        };
        const res = {
            json: jest.fn(),
        };
        const next = jest.fn();

        await getListings(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(Listing.find).toHaveBeenCalledTimes(1);
        const [filter] = Listing.find.mock.calls[0];
        expect(filter).toEqual(expect.objectContaining({ status: 'active' }));
        expect(filter['location.city']).toBeTruthy();
        expect(filter['location.city'].$regex).toBeInstanceOf(RegExp);
        expect(filter['location.city'].$regex.source).toBe('^New-Delhi$');
        expect(filter['location.city'].$regex.flags).toContain('i');
    });
});
