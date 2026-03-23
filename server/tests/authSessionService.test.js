jest.mock('../services/loyaltyService', () => ({
    awardLoyaltyPoints: jest.fn().mockResolvedValue(undefined),
    getRewardSnapshotFromUser: jest.fn().mockReturnValue({}),
}));

require('../index');

const User = require('../models/User');
const { syncAuthenticatedUser } = require('../services/authSessionService');

let counter = 0;
const stamp = Date.now();

const uniqueEmail = (label) => {
    counter += 1;
    return `auth_session_${label}_${stamp}_${counter}@test.com`;
};

describe('authSessionService phone conflict guard', () => {
    test('blocks sync when the same real phone already exists under another account format', async () => {
        const newEmail = uniqueEmail('new');

        await User.create({
            name: 'Existing User',
            email: uniqueEmail('existing'),
            phone: '9876543210',
            isVerified: true,
        });

        await expect(syncAuthenticatedUser({
            authUser: {
                email: newEmail,
                emailVerified: true,
                displayName: 'New User',
            },
            email: newEmail,
            name: 'New User',
            phone: '+919876543210',
            awardLoginPoints: false,
        })).rejects.toMatchObject({
            message: 'Phone number is already linked to another account',
            statusCode: 409,
        });
    });
});
