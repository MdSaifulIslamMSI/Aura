const User = require('../models/User');
const { updateUserProfile } = require('../controllers/userController');

describe('Profile Security', () => {
    test('blocks privilege field mutations from profile update payload', async () => {
        const user = await User.create({
            name: 'Normal User',
            email: 'profile-sec@test.com',
            phone: '9876500001',
            isAdmin: false,
            isVerified: true,
        });

        const req = {
            body: { isAdmin: true },
            user: { email: user.email },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(next).toHaveBeenCalled();
        const err = next.mock.calls[0][0];
        expect(err.statusCode).toBe(400);

        const refreshed = await User.findById(user._id).lean();
        expect(refreshed.isAdmin).toBe(false);
    });

    test('allows safe profile fields only', async () => {
        const user = await User.create({
            name: 'Safe User',
            email: 'profile-safe@test.com',
            phone: '9876500002',
            isAdmin: false,
            isVerified: true,
        });

        const req = {
            body: { bio: 'Updated bio' },
            user: { email: user.email },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalled();
        const refreshed = await User.findById(user._id).lean();
        expect(refreshed.bio).toBe('Updated bio');
    });
});
