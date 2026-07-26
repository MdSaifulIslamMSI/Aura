jest.mock('../models/User');
jest.mock('../services/authProfileVault');
jest.mock('../middleware/authMiddleware');
jest.mock('../services/authSecurityTelemetryService');

const User = require('../models/User');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const { updateUserProfile } = require('../controllers/userController');

const buildResponse = () => ({
    json: jest.fn().mockReturnThis(),
});

describe('account profile optimistic concurrency', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('normalizes safe fields, increments the version, and records a value-free audit event', async () => {
        User.findOneAndUpdate.mockResolvedValue({
            _id: '507f1f77bcf86cd799439221',
            email: 'profile-version@example.com',
            name: 'Updated Name',
            phone: '+919876543210',
            bio: 'Updated bio',
            dob: new Date('1990-01-02T00:00:00.000Z'),
            accountState: 'active',
            addresses: [],
            __v: 5,
        });
        const req = {
            body: {
                name: '  Updated Name  ',
                bio: '  Updated bio  ',
                dob: '1990-01-02',
                version: 4,
            },
            user: {
                _id: '507f1f77bcf86cd799439221',
                email: 'profile-version@example.com',
            },
            authUid: 'profile-version-auth-uid',
        };
        const res = buildResponse();
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            {
                email: 'profile-version@example.com',
                __v: 4,
            },
            {
                $set: {
                    name: 'Updated Name',
                    bio: 'Updated bio',
                    dob: new Date('1990-01-02T00:00:00.000Z'),
                },
                $inc: { __v: 1 },
            },
            {
                returnDocument: 'after',
                projection: expect.any(String),
                lean: true,
            }
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Updated Name',
            bio: 'Updated bio',
            version: 5,
        }));
        expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'account.profile.updated',
            meta: {
                fields: ['bio', 'dob', 'name'],
                optimisticConcurrency: true,
            },
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('returns a conflict instead of overwriting a newer profile version', async () => {
        User.findOneAndUpdate.mockResolvedValue(null);
        User.exists.mockResolvedValue(true);
        const req = {
            body: {
                bio: 'Stale update',
                version: 2,
            },
            user: {
                _id: '507f1f77bcf86cd799439222',
                email: 'profile-conflict@example.com',
            },
        };
        const res = buildResponse();
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 409,
            code: 'ACCOUNT_PROFILE_VERSION_CONFLICT',
        }));
        expect(recordAuthSecurityEvent).not.toHaveBeenCalled();
    });
});
