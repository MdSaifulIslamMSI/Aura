jest.mock('../models/User', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/Listing', () => ({
    updateMany: jest.fn(),
}));

jest.mock('../models/Order', () => ({}));
jest.mock('../models/PaymentIntent', () => ({}));

jest.mock('../models/UserGovernanceLog', () => ({
    create: jest.fn(),
}));

jest.mock('../services/email/adminActionEmailService', () => ({
    notifyAdminActionToUser: jest.fn(),
}));

jest.mock('../services/governanceSupportService', () => ({
    createGovernanceAppealTicket: jest.fn(),
    resolveLatestGovernanceAppealTicket: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    invalidateUserCacheByEmail: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
}));

const User = require('../models/User');
const Listing = require('../models/Listing');
const UserGovernanceLog = require('../models/UserGovernanceLog');
const { notifyAdminActionToUser } = require('../services/email/adminActionEmailService');
const {
    createGovernanceAppealTicket,
    resolveLatestGovernanceAppealTicket,
} = require('../services/governanceSupportService');
const {
    warnAdminUser,
    reactivateAdminUser,
} = require('../controllers/adminUserController');

const makeTargetUser = (overrides = {}) => ({
    _id: '69a8439bd9d5e7f7bf84855a',
    name: 'Target User',
    email: 'target@example.com',
    isAdmin: false,
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
            isAdmin: this.isAdmin,
            isSeller: this.isSeller,
            sellerActivatedAt: this.sellerActivatedAt,
            accountState: this.accountState,
            softDeleted: this.softDeleted,
            moderation: this.moderation,
        };
    },
    ...overrides,
});

const makeReqRes = (body = {}) => ({
    req: {
        params: { userId: '69a8439bd9d5e7f7bf84855a' },
        body,
        user: {
            _id: 'admin-1',
            email: 'admin@example.com',
            isAdmin: true,
        },
        requestId: 'req-admin-failsafe',
        method: 'POST',
        originalUrl: '/api/admin/users/69a8439bd9d5e7f7bf84855a/warn',
        ip: '127.0.0.1',
        headers: { 'user-agent': 'jest' },
    },
    res: {
        json: jest.fn(),
    },
    next: jest.fn(),
});

describe('adminUserController fail-safe moderation actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Listing.updateMany.mockResolvedValue({ modifiedCount: 0 });
        UserGovernanceLog.create.mockRejectedValue(
            new Error('cannot create a new collection -- already using 510 collections of 500')
        );
        notifyAdminActionToUser.mockRejectedValue(new Error('smtp quota exceeded'));
        createGovernanceAppealTicket.mockRejectedValue(new Error('support quota exceeded'));
        resolveLatestGovernanceAppealTicket.mockRejectedValue(new Error('support quota exceeded'));
    });

    test('warnAdminUser returns success when governance log/email side-effects fail', async () => {
        const targetUser = makeTargetUser();
        User.findById.mockResolvedValue(targetUser);
        const { req, res, next } = makeReqRes({ reason: 'Policy warning for abuse terms' });

        await warnAdminUser(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(targetUser.save).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledTimes(1);
        expect(res.json.mock.calls[0][0]).toMatchObject({
            success: true,
            message: 'User warning issued successfully',
        });
    });

    test('reactivateAdminUser returns success when governance log/email side-effects fail', async () => {
        const targetUser = makeTargetUser({
            accountState: 'suspended',
            moderation: {
                suspendedAt: new Date('2026-03-04T00:00:00.000Z'),
                suspendedUntil: new Date('2026-03-10T00:00:00.000Z'),
                suspensionReason: 'test',
                suspendedBy: 'admin-1',
            },
        });
        User.findById.mockResolvedValue(targetUser);
        const { req, res, next } = makeReqRes({ reason: 'Appeal approved' });
        req.originalUrl = '/api/admin/users/69a8439bd9d5e7f7bf84855a/reactivate';

        await reactivateAdminUser(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(targetUser.save).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledTimes(1);
        expect(res.json.mock.calls[0][0]).toMatchObject({
            success: true,
            message: 'User account reactivated',
        });
    });
});
