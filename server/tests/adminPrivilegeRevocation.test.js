process.env.NODE_ENV = 'test';
process.env.ADMIN_STRICT_ACCESS_ENABLED = 'false';

const User = require('../models/User');
const { admin } = require('../middleware/authMiddleware');
const { createTestUser } = require('./helpers/securityTestHelpers');

jest.setTimeout(15000);

const buildCachedAdminRequest = (user, overrides = {}) => ({
    user: { ...user.toObject(), isAdmin: true },
    authUid: user.authUid || 'firebase-admin-revocation',
    authToken: {
        email: user.email,
        email_verified: true,
    },
    method: 'GET',
    originalUrl: '/api/admin/users',
    headers: {},
    get: () => '',
    ...overrides,
});

describe('admin privilege freshness', () => {
    test('a cached admin demoted in the database is denied on the next request', async () => {
        const user = await createTestUser({
            name: 'Demoted Admin',
            email: 'demoted-admin@example.com',
            isAdmin: true,
        });
        await User.updateOne({ _id: user._id }, { $set: { isAdmin: false } });

        const req = buildCachedAdminRequest(user);
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toMatchObject({
            statusCode: 403,
            message: expect.stringMatching(/not authorized as an admin/i),
        });
    });

    test('a cached admin whose account is suspended is denied', async () => {
        const user = await createTestUser({
            name: 'Suspended Admin',
            email: 'suspended-admin@example.com',
            isAdmin: true,
        });
        await User.updateOne(
            { _id: user._id },
            {
                $set: {
                    accountState: 'suspended',
                    'moderation.suspendedUntil': new Date(Date.now() + 60 * 60 * 1000),
                },
            }
        );

        const req = buildCachedAdminRequest(user);
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toMatchObject({
            statusCode: 403,
            message: expect.stringMatching(/not active/i),
        });
    });

    test('a cached admin whose database row was deleted is denied', async () => {
        const user = await createTestUser({
            name: 'Deleted Admin',
            email: 'deleted-admin@example.com',
            isAdmin: true,
        });
        await User.deleteOne({ _id: user._id });

        const req = buildCachedAdminRequest(user);
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toMatchObject({
            statusCode: 403,
            message: expect.stringMatching(/not active/i),
        });
    });
});
