const User = require('../models/User');
const { updateUserProfile } = require('../controllers/userController');
const { buildSessionPayload } = require('../services/authSessionService');

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
        const profilePayload = res.json.mock.calls[0][0];
        const sessionPayload = buildSessionPayload({
            authUser: {
                uid: 'uid-profile-safe',
                email: user.email,
                emailVerified: true,
                displayName: 'Safe User',
            },
            authUid: 'uid-profile-safe',
            user: profilePayload,
        });

        expect(profilePayload).toMatchObject({
            _id: sessionPayload.profile._id,
            name: sessionPayload.profile.name,
            email: sessionPayload.profile.email,
            phone: sessionPayload.profile.phone,
            avatar: sessionPayload.profile.avatar,
            gender: sessionPayload.profile.gender,
            dob: sessionPayload.profile.dob,
            bio: sessionPayload.profile.bio,
            isAdmin: sessionPayload.profile.isAdmin,
            isVerified: sessionPayload.profile.isVerified,
            isSeller: sessionPayload.profile.isSeller,
            sellerActivatedAt: sessionPayload.profile.sellerActivatedAt,
            accountState: sessionPayload.profile.accountState,
            moderation: sessionPayload.profile.moderation,
            loyalty: sessionPayload.profile.loyalty,
            createdAt: sessionPayload.profile.createdAt,
        });
        expect(profilePayload.addresses).toEqual([]);

        const refreshed = await User.findById(user._id).lean();
        expect(refreshed.bio).toBe('Updated bio');
    });

    test('rejects phone changes without fresh matching phone-factor proof', async () => {
        const user = await User.create({
            name: 'Phone Factor User',
            email: 'profile-phone-factor@test.com',
            phone: '9876500003',
            isAdmin: false,
            isVerified: true,
        });

        const req = {
            body: { phone: '9876500999' },
            user: { email: user.email },
            authToken: {
                email: user.email,
                email_verified: true,
                auth_time: Math.floor(Date.now() / 1000) - 60,
            },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(next).toHaveBeenCalled();
        const err = next.mock.calls[0][0];
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('Firebase phone verification is required');
        expect(res.json).not.toHaveBeenCalled();

        const refreshed = await User.findById(user._id).lean();
        expect(refreshed.phone).toBe('9876500003');
    });

    test('allows phone changes with fresh matching phone-factor proof', async () => {
        const user = await User.create({
            name: 'Phone Proof User',
            email: 'profile-phone-proof@test.com',
            phone: '9876500004',
            isAdmin: false,
            isVerified: true,
        });

        const req = {
            body: { phone: '9876500888' },
            user: { email: user.email },
            authToken: {
                email: user.email,
                email_verified: true,
                phone_number: '+919876500888',
                auth_time: Math.floor(Date.now() / 1000) - 60,
            },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalled();

        const refreshed = await User.findById(user._id).lean();
        expect(refreshed.phone).toBe('9876500888');
    });

    test('rejects phone changes with stale phone-factor proof', async () => {
        const user = await User.create({
            name: 'Stale Phone Proof User',
            email: 'profile-stale-phone-proof@test.com',
            phone: '9876500005',
            isAdmin: false,
            isVerified: true,
        });

        const req = {
            body: { phone: '9876500777' },
            user: { email: user.email },
            authToken: {
                email: user.email,
                email_verified: true,
                phone_number: '+919876500777',
                auth_time: Math.floor(Date.now() / 1000) - (15 * 60),
            },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(next).toHaveBeenCalled();
        const err = next.mock.calls[0][0];
        expect(err.statusCode).toBe(401);
        expect(err.message).toContain('Fresh phone verification is required');
        expect(res.json).not.toHaveBeenCalled();

        const refreshed = await User.findById(user._id).lean();
        expect(refreshed.phone).toBe('9876500005');
    });
});
