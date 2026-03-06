jest.mock('../models/User', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../models/Order', () => ({
    countDocuments: jest.fn(),
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

jest.mock('../middleware/authMiddleware', () => ({
    invalidateUserCacheByEmail: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const PaymentIntent = require('../models/PaymentIntent');
const UserGovernanceLog = require('../models/UserGovernanceLog');
const logger = require('../utils/logger');

const {
    listAdminUsers,
    getAdminUserById,
    suspendAdminUser,
    deleteAdminUser,
} = require('../controllers/adminUserController');

const makeUserDoc = (overrides = {}) => ({
    _id: '69aa00000000000000000001',
    name: 'Target User',
    email: 'target@example.com',
    phone: '+919876543210',
    avatar: 'https://example.com/avatar.png',
    bio: 'hello',
    addresses: [{ city: 'Kolkata' }],
    cart: [{ product: '1' }],
    wishlist: [{ product: '2' }],
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

const makeReqRes = ({
    params = { userId: '69aa00000000000000000001' },
    query = {},
    body = {},
    originalUrl = '/api/admin/users',
} = {}) => ({
    req: {
        params,
        query,
        body,
        user: {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        },
        requestId: 'req-admin-resilience',
        method: 'POST',
        originalUrl,
        ip: '127.0.0.1',
        headers: { 'user-agent': 'jest' },
    },
    res: {
        json: jest.fn(),
    },
    next: jest.fn(),
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

const makeGovernanceLogChain = (result, shouldReject = false) => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: shouldReject ? jest.fn().mockRejectedValue(new Error('cannot create a new collection -- already using 510 collections of 500')) : jest.fn().mockResolvedValue(result),
});

describe('Admin user controller resilience', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        UserGovernanceLog.create.mockResolvedValue({ actionId: 'ugl_1' });
        Listing.updateMany.mockResolvedValue({ modifiedCount: 2 });
    });

    test('listAdminUsers returns data even when state aggregation fails', async () => {
        const userList = [makeUserDoc(), makeUserDoc({ _id: '69aa00000000000000000002', email: 'two@example.com' })];
        User.find.mockReturnValue(makeFindChain(userList));
        User.countDocuments.mockResolvedValue(2);
        User.aggregate.mockRejectedValue(new Error('cannot create a new collection -- already using 510 collections of 500'));

        const { req, res, next } = makeReqRes({
            query: { page: '1', limit: '20' },
            originalUrl: '/api/admin/users',
        });
        req.method = 'GET';

        await listAdminUsers(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            total: 2,
            stats: {
                active: 0,
                warned: 0,
                suspended: 0,
                deleted: 0,
            },
        }));
        expect(logger.warn).toHaveBeenCalledWith('admin.user_state_stats_fallback', expect.objectContaining({
            requestId: 'req-admin-resilience',
            quotaLimited: true,
        }));
    });

    test('getAdminUserById falls back cleanly when governance log and metric reads fail', async () => {
        const targetUser = makeUserDoc();
        User.findById.mockReturnValue(makeFindByIdChain(targetUser));
        Order.countDocuments.mockRejectedValue(new Error('orders unavailable'));
        Listing.countDocuments
            .mockRejectedValueOnce(new Error('listings unavailable'))
            .mockRejectedValueOnce(new Error('active listings unavailable'));
        PaymentIntent.countDocuments.mockRejectedValue(new Error('payments unavailable'));
        UserGovernanceLog.find.mockReturnValue(makeGovernanceLogChain([], true));

        const { req, res, next } = makeReqRes({
            params: { userId: targetUser._id },
            originalUrl: `/api/admin/users/${targetUser._id}`,
        });
        req.method = 'GET';

        await getAdminUserById(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            metrics: {
                orders: 0,
                listings: 0,
                activeListings: 0,
                paymentIntents: 0,
            },
            logs: [],
        }));
        expect(logger.warn).toHaveBeenCalledWith('admin.user_metric_fallback', expect.objectContaining({
            label: 'orders',
        }));
        expect(logger.warn).toHaveBeenCalledWith('admin.user_governance_log_read_fallback', expect.objectContaining({
            targetUserId: targetUser._id,
            quotaLimited: true,
        }));
    });

    test('suspendAdminUser suspends seller accounts and expires active listings', async () => {
        const targetUser = makeUserDoc();
        User.findById.mockResolvedValue(targetUser);

        const { req, res, next } = makeReqRes({
            params: { userId: targetUser._id },
            body: {
                reason: 'Policy suspension for repeated abuse',
                durationHours: 72,
            },
            originalUrl: `/api/admin/users/${targetUser._id}/suspend`,
        });

        await suspendAdminUser(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(targetUser.accountState).toBe('suspended');
        expect(targetUser.isSeller).toBe(false);
        expect(targetUser.sellerActivatedAt).toBeNull();
        expect(Listing.updateMany).toHaveBeenCalledWith(
            { seller: targetUser._id, status: 'active' },
            { $set: { status: 'expired' } }
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            message: 'User suspended successfully',
        }));
    });

    test('deleteAdminUser soft-deletes and scrubs PII when requested', async () => {
        const targetUser = makeUserDoc({
            moderation: {
                warningCount: 2,
            },
        });
        User.findById.mockResolvedValue(targetUser);

        const { req, res, next } = makeReqRes({
            params: { userId: targetUser._id },
            body: {
                reason: 'Permanent trust and safety removal',
                scrubPII: true,
            },
            originalUrl: `/api/admin/users/${targetUser._id}/delete`,
        });

        await deleteAdminUser(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(targetUser.accountState).toBe('deleted');
        expect(targetUser.softDeleted).toBe(true);
        expect(targetUser.isSeller).toBe(false);
        expect(targetUser.phone).toBe('');
        expect(targetUser.avatar).toBe('');
        expect(targetUser.bio).toBe('');
        expect(targetUser.addresses).toEqual([]);
        expect(targetUser.cart).toEqual([]);
        expect(targetUser.wishlist).toEqual([]);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            message: 'User soft-deleted successfully',
        }));
    });
});
