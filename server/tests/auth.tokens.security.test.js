const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockGetUser = jest.fn();
let mockGlobalSessionRevokedAfter = 0;

jest.mock('../config/firebase', () => ({
    auth: () => ({
        verifyIdToken: mockVerifyIdToken,
        getUser: mockGetUser,
    }),
}));

jest.mock('../services/browserSessionService', () => ({
    getBrowserSessionFromRequest: jest.fn().mockResolvedValue(null),
    resolveSessionIdFromRequest: jest.fn().mockReturnValue(''),
    revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
    touchBrowserSession: jest.fn().mockResolvedValue(null),
    getGlobalSessionRevokedAfter: jest.fn(async () => mockGlobalSessionRevokedAfter),
}));

const User = require('../models/User');
process.env.ADMIN_STRICT_ACCESS_ENABLED = 'false';
const { protect, admin } = require('../middleware/authMiddleware');
const {
    assertSafeStatus,
    buildBearer,
    createAdminUser,
    createDeletedUser,
    createTestUser,
} = require('./helpers/securityTestHelpers');

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.get('/protected', protect, (req, res) => {
        res.json({ userId: String(req.user._id), email: req.user.email });
    });
    app.get('/admin', protect, admin, (_req, res) => {
        res.json({ ok: true });
    });
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message || 'Internal Server Error',
            code: err.code,
        });
    });
    return app;
};

const decodedTokenFor = (user, overrides = {}) => ({
    uid: user.authUid || `uid-${user._id}`,
    email: user.email,
    email_verified: true,
    name: user.name,
    auth_time: Math.floor(Date.now() / 1000),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    firebase: {},
    ...overrides,
});

describe('auth token/session security', () => {
    let app;

    beforeEach(() => {
        app = buildApp();
        mockVerifyIdToken.mockReset();
        mockGetUser.mockReset();
        mockGlobalSessionRevokedAfter = 0;
    });

    test.each([
        ['missing token', ''],
        ['malformed token', 'malformed-token'],
        ['tampered signature', 'tampered-token'],
        ['expired token', 'expired-token'],
        ['wrong issuer or audience', 'wrong-audience-token'],
        ['alg none token', 'alg-none-token'],
        ['wrong signing secret', 'wrong-secret-token'],
    ])('%s is rejected and no user is created', async (_label, token) => {
        const beforeCount = await User.countDocuments();
        mockVerifyIdToken.mockRejectedValue(new Error('Firebase token rejected'));

        const req = request(app).get('/protected');
        if (token) req.set('Authorization', buildBearer(token));
        const response = await req;

        assertSafeStatus(response, [401]);
        await expect(User.countDocuments()).resolves.toBe(beforeCount);
    });

    test('valid Firebase bearer token resolves the matching local user', async () => {
        const user = await createTestUser({ authUid: 'uid-valid-token' });
        mockVerifyIdToken.mockResolvedValue(decodedTokenFor(user));

        const response = await request(app)
            .get('/protected')
            .set('Authorization', buildBearer('valid-token'));

        expect(response.statusCode).toBe(200);
        expect(response.body).toMatchObject({
            userId: String(user._id),
            email: user.email,
        });
        expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token', true);
    });

    test('blocked or deleted user token is rejected without reactivating the account', async () => {
        const deletedUser = await createDeletedUser({ authUid: 'uid-deleted-token' });
        const before = await User.findById(deletedUser._id).lean();
        mockVerifyIdToken.mockResolvedValue(decodedTokenFor(deletedUser));

        const response = await request(app)
            .get('/protected')
            .set('Authorization', buildBearer('deleted-user-token'));

        assertSafeStatus(response, [403]);
        const after = await User.findById(deletedUser._id).lean();
        expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
    });

    test('revoked password-change era tokens are rejected when Firebase revocation check fails', async () => {
        const user = await createTestUser({ authUid: 'uid-revoked-token' });
        const before = await User.findById(user._id).lean();
        mockVerifyIdToken.mockRejectedValue(new Error('auth/id-token-revoked'));

        const response = await request(app)
            .get('/protected')
            .set('Authorization', buildBearer('revoked-after-password-change'));

        assertSafeStatus(response, [401]);
        const after = await User.findById(user._id).lean();
        expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
    });

    test('global logout/session revocation rejects older bearer tokens', async () => {
        const issuedSeconds = Math.floor(Date.now() / 1000) - 3600;
        const user = await createTestUser({ authUid: 'uid-old-token' });
        mockGlobalSessionRevokedAfter = Date.now() - 1000;
        mockVerifyIdToken.mockResolvedValue(decodedTokenFor(user, {
            auth_time: issuedSeconds,
            iat: issuedSeconds,
        }));

        const response = await request(app)
            .get('/protected')
            .set('Authorization', buildBearer('old-token-after-logout'));

        assertSafeStatus(response, [401]);
    });

    test('old admin token loses admin power after the database role is downgraded', async () => {
        const adminUser = await createAdminUser({ authUid: 'uid-admin-downgrade' });
        mockVerifyIdToken.mockResolvedValue(decodedTokenFor(adminUser, {
            firebase: { sign_in_second_factor: 'phone' },
        }));

        const allowed = await request(app)
            .get('/admin')
            .set('Authorization', buildBearer('admin-token-before-downgrade'));
        expect(allowed.statusCode).toBe(200);

        await User.updateOne(
            { _id: adminUser._id },
            { $set: { isAdmin: false, adminRoles: [] } }
        );

        const denied = await request(app)
            .get('/admin')
            .set('Authorization', buildBearer('admin-token-before-downgrade'));

        assertSafeStatus(denied, [403]);
        const refreshed = await User.findById(adminUser._id).lean();
        expect(refreshed.isAdmin).toBe(false);
        expect(refreshed.adminRoles).toEqual([]);
    });
});
