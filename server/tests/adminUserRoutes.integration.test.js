jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        return next();
    },
    admin: (req, res, next) => next(),
    invalidateUserCacheByEmail: jest.fn(),
}));

jest.mock('../models/User', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../models/Order', () => ({
    countDocuments: jest.fn(),
    updateMany: jest.fn(),
}));

jest.mock('../models/Listing', () => ({
    countDocuments: jest.fn(),
    updateMany: jest.fn(),
}));

jest.mock('../models/PaymentIntent', () => ({
    countDocuments: jest.fn(),
}));

jest.mock('../models/UserGovernanceLog', () => ({
    create: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../services/email/adminActionEmailService', () => ({
    notifyAdminActionToUser: jest.fn(),
}));

jest.mock('../services/notificationService', () => ({
    sendPersistentNotification: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminUserRoutes = require('../routes/adminUserRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const PaymentIntent = require('../models/PaymentIntent');
const UserGovernanceLog = require('../models/UserGovernanceLog');

const makeUserDoc = (overrides = {}) => ({
    _id: '69aa00000000000000000001',
    name: 'Target User',
    email: 'target@example.com',
    phone: '+919876543210',
    avatar: '',
    bio: '',
    addresses: [],
    cart: [],
    wishlist: [],
    isAdmin: false,
    isVerified: true,
    isSeller: true,
    sellerActivatedAt: new Date('2026-03-01T00:00:00.000Z'),
    accountState: 'active',
    softDeleted: false,
    moderation: {},
    save: jest.fn().mockResolvedValue(undefined),
    toObject() {
        return {
            _id: this._id,
            name: this.name,
            email: this.email,
            phone: this.phone,
            avatar: this.avatar,
            bio: this.bio,
            addresses: this.addresses,
            cart: this.cart,
            wishlist: this.wishlist,
            isAdmin: this.isAdmin,
            isVerified: this.isVerified,
            isSeller: this.isSeller,
            sellerActivatedAt: this.sellerActivatedAt,
            accountState: this.accountState,
            softDeleted: this.softDeleted,
            moderation: this.moderation,
        };
    },
    ...overrides,
});

const makeFindChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const makeFindByIdChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const makeGovernanceLogChain = (result) => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/users', adminUserRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin user routes integration', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();
        UserGovernanceLog.create.mockResolvedValue({ actionId: 'ugl_1' });
        UserGovernanceLog.find.mockReturnValue(makeGovernanceLogChain([]));
        Listing.updateMany.mockResolvedValue({ modifiedCount: 2 });
        Order.updateMany.mockResolvedValue({ modifiedCount: 1 });
        Order.countDocuments.mockResolvedValue(0);
        Listing.countDocuments.mockResolvedValue(0);
        PaymentIntent.countDocuments.mockResolvedValue(0);
        User.aggregate.mockResolvedValue([{ _id: 'active', count: 1 }]);
        User.countDocuments.mockResolvedValue(1);
    });

    test('GET /api/admin/users returns governance list with stats', async () => {
        User.find.mockReturnValue(makeFindChain([makeUserDoc()]));

        const res = await request(app).get('/api/admin/users?page=1&limit=20');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            total: 1,
            stats: {
                active: 1,
                warned: 0,
                suspended: 0,
                deleted: 0,
            },
        });
        expect(res.body.users).toHaveLength(1);
    });

    test('GET /api/admin/users/:id returns governance detail with metrics and logs', async () => {
        const user = makeUserDoc();
        User.findById.mockReturnValue(makeFindByIdChain(user));
        Order.countDocuments.mockResolvedValue(3);
        Listing.countDocuments
            .mockResolvedValueOnce(5)
            .mockResolvedValueOnce(2);
        PaymentIntent.countDocuments.mockResolvedValue(4);
        UserGovernanceLog.find.mockReturnValue(makeGovernanceLogChain([
            {
                actionId: 'ugl_1',
                actionType: 'warn',
                reason: 'Policy warning',
                actorEmail: 'admin@example.com',
                metadata: { warningCount: 1 },
                createdAt: new Date('2026-03-05T00:00:00.000Z'),
            },
        ]));

        const res = await request(app).get(`/api/admin/users/${user._id}`);

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            metrics: {
                orders: 3,
                listings: 5,
                activeListings: 2,
                paymentIntents: 4,
            },
        });
        expect(res.body.logs).toHaveLength(1);
    });

    test('POST /api/admin/users/:id/warn enforces schema validation', async () => {
        const res = await request(app)
            .post('/api/admin/users/69aa00000000000000000001/warn')
            .send({ reason: 'bad' });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });

    test('POST /api/admin/users/:id/warn issues a warning through the real route', async () => {
        const user = makeUserDoc();
        User.findById.mockResolvedValue(user);

        const res = await request(app)
            .post(`/api/admin/users/${user._id}/warn`)
            .send({ reason: 'Policy warning for repeated abusive messages' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            message: 'User warning issued successfully',
        });
        expect(user.accountState).toBe('warned');
        expect(user.moderation.warningCount).toBe(1);
    });

    test('POST /api/admin/users/:id/suspend suspends the user through the real route', async () => {
        const user = makeUserDoc();
        User.findById.mockResolvedValue(user);

        const res = await request(app)
            .post(`/api/admin/users/${user._id}/suspend`)
            .send({
                reason: 'Policy suspension for repeated marketplace abuse',
                durationHours: 24,
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('User suspended successfully');
        expect(user.accountState).toBe('suspended');
        expect(user.isSeller).toBe(false);
        expect(Listing.updateMany).toHaveBeenCalledWith(
            { seller: user._id, status: 'active' },
            { $set: { status: 'expired' } }
        );
    });

    test('POST /api/admin/users/:id/dismiss-warning rejects suspended users', async () => {
        const user = makeUserDoc({
            accountState: 'suspended',
            moderation: {
                suspendedUntil: new Date(Date.now() + 60 * 60 * 1000),
            },
        });
        User.findById.mockResolvedValue(user);

        const res = await request(app)
            .post(`/api/admin/users/${user._id}/dismiss-warning`)
            .send({ reason: 'Trying to clear warning while suspended' });

        expect(res.statusCode).toBe(409);
        expect(res.body.message).toBe('User is suspended. Reactivate first before dismissing warnings.');
    });

    test('POST /api/admin/users/:id/reactivate restores account access', async () => {
        const user = makeUserDoc({
            accountState: 'suspended',
            moderation: {
                suspendedAt: new Date('2026-03-04T00:00:00.000Z'),
                suspendedUntil: new Date('2026-03-10T00:00:00.000Z'),
                suspensionReason: 'test',
                suspendedBy: 'admin-id',
            },
        });
        User.findById.mockResolvedValue(user);

        const res = await request(app)
            .post(`/api/admin/users/${user._id}/reactivate`)
            .send({ reason: 'Appeal accepted' });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('User account reactivated');
        expect(user.accountState).toBe('active');
        expect(user.moderation.suspendedUntil).toBeNull();
    });

    test('POST /api/admin/users/:id/delete soft-deletes and scrubs PII', async () => {
        const user = makeUserDoc({
            avatar: 'https://example.com/avatar.png',
            bio: 'Seller bio',
            addresses: [{ city: 'Kolkata' }],
            cart: [{ product: '1' }],
            wishlist: [{ product: '2' }],
        });
        User.findById.mockResolvedValue(user);

        const res = await request(app)
            .post(`/api/admin/users/${user._id}/delete`)
            .send({
                reason: 'Permanent trust and safety removal',
                scrubPII: true,
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('User soft-deleted successfully');
        expect(user.accountState).toBe('deleted');
        expect(user.softDeleted).toBe(true);
        expect(user.phone).toBe('');
        expect(user.avatar).toBe('');
        expect(user.addresses).toEqual([]);
    });
});
