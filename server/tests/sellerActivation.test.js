jest.mock('../models/User');
jest.mock('../services/authProfileVault');
jest.mock('../middleware/authMiddleware');
jest.mock('../services/authSecurityTelemetryService');

const User = require('../models/User');
const { activateSellerAccount } = require('../controllers/userController');

const TEN_YEARS_MS = 10 * 365.2425 * 24 * 60 * 60 * 1000;
const THIRTY_YEARS_MS = 30 * 365.2425 * 24 * 60 * 60 * 1000;

const buildUser = (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439099',
    email: 'seller-candidate@example.com',
    name: 'Seller Candidate',
    phone: '+919876543210',
    isVerified: true,
    isSeller: false,
    sellerActivatedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

const buildRequest = () => ({
    body: { acceptTerms: true },
    authUid: 'seller-candidate-auth-uid',
    user: { email: 'seller-candidate@example.com' },
});

const buildResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
});

describe('seller activation age gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('blocks activation for an under-18 account without writing', async () => {
        const user = buildUser({ dob: new Date(Date.now() - TEN_YEARS_MS) });
        User.findOne.mockResolvedValue(user);
        const res = buildResponse();
        const next = jest.fn();

        await activateSellerAccount(buildRequest(), res, next);

        expect(user.save).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
        }));
        expect(res.json).not.toHaveBeenCalled();
    });

    test('activates an adult with a date of birth on file', async () => {
        const user = buildUser({ dob: new Date(Date.now() - THIRTY_YEARS_MS) });
        User.findOne.mockResolvedValue(user);
        const res = buildResponse();
        const next = jest.fn();

        await activateSellerAccount(buildRequest(), res, next);

        expect(user.isSeller).toBe(true);
        expect(user.save).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
        }));
    });

    test('still activates sellers with no date of birth on file', async () => {
        const user = buildUser({ dob: undefined });
        User.findOne.mockResolvedValue(user);
        const res = buildResponse();
        const next = jest.fn();

        await activateSellerAccount(buildRequest(), res, next);

        expect(user.isSeller).toBe(true);
        expect(user.save).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
