// Regression guard for the admin "delete user" PII scrub.
//
// The scrubPII branch of the admin delete flow cleared name, phone, avatar,
// bio, addresses and wishlist but left `email` — the primary identifier —
// intact, while the deletion notice told the user "PII scrubbed: yes".
//
// These tests assert:
//   1. The address on the record is replaced by a stable, non-routable
//      placeholder (not blanked: `email` is required and uniquely indexed).
//   2. The placeholder is stable for the same account and unique per account.
//   3. The deletion notice is still delivered to the ORIGINAL address, and
//      the cached session is still invalidated for the ORIGINAL address —
//      both are functionally required and would silently stop working if the
//      scrub simply overwrote the address.
//   4. Without scrubPII the address is left untouched.
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

jest.mock('../models/Cart', () => ({
    updateOne: jest.fn(),
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

jest.mock('../services/governanceSupportService', () => ({
    createGovernanceAppealTicket: jest.fn(),
    resolveLatestGovernanceAppealTicket: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    invalidateUserCacheByEmail: jest.fn(),
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

const User = require('../models/User');
const Cart = require('../models/Cart');
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const UserGovernanceLog = require('../models/UserGovernanceLog');
const { notifyAdminActionToUser } = require('../services/email/adminActionEmailService');
const { invalidateUserCacheByEmail } = require('../middleware/authMiddleware');
const { deleteAdminUser } = require('../controllers/adminUserController');

const makeUserDoc = (overrides = {}) => ({
    _id: '69aa00000000000000000001',
    name: 'Target User',
    email: 'target@example.com',
    phone: '+919876543210',
    avatar: 'https://example.com/avatar.png',
    bio: 'hello',
    addresses: [{ city: 'Kolkata' }],
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
    body = {},
} = {}) => ({
    req: {
        params,
        query: {},
        body,
        user: {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        },
        requestId: 'req-admin-scrub',
        method: 'POST',
        originalUrl: '/api/admin/users/69aa00000000000000000001/delete',
        ip: '127.0.0.1',
        headers: { 'user-agent': 'jest' },
    },
    res: { json: jest.fn() },
    next: jest.fn(),
});

describe('admin delete user PII scrub', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        UserGovernanceLog.create.mockResolvedValue({ actionId: 'ugl_1' });
        Cart.updateOne.mockResolvedValue({ modifiedCount: 1 });
        Listing.updateMany.mockResolvedValue({ modifiedCount: 2 });
        Order.updateMany.mockResolvedValue({ modifiedCount: 3 });
    });

    test('scrubs the email address into a non-routable placeholder', async () => {
        const targetUser = makeUserDoc();
        User.findById.mockResolvedValue(targetUser);

        const { req, res, next } = makeReqRes({
            body: { reason: 'Permanent trust and safety removal', scrubPII: true },
        });

        await deleteAdminUser(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(targetUser.email).not.toBe('target@example.com');
        expect(targetUser.email).toContain(String(targetUser._id));
        expect(targetUser.email.endsWith('@deleted.invalid')).toBe(true);
        expect(targetUser.email).not.toMatch(/@example\.com$/);
    });

    test('the placeholder keeps the field present and unique per account', async () => {
        const first = makeUserDoc();
        const second = makeUserDoc({ _id: '69aa00000000000000000002', email: 'other@example.com' });
        User.findById.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

        const firstCall = makeReqRes({ body: { scrubPII: true } });
        await deleteAdminUser(firstCall.req, firstCall.res, firstCall.next);

        const secondCall = makeReqRes({ body: { scrubPII: true } });
        await deleteAdminUser(secondCall.req, secondCall.res, secondCall.next);

        expect(first.email).toBeTruthy();
        expect(second.email).toBeTruthy();
        expect(first.email).not.toBe(second.email);
    });

    test('the deletion notice is still delivered to the original address', async () => {
        const targetUser = makeUserDoc();
        User.findById.mockResolvedValue(targetUser);

        const { req, res, next } = makeReqRes({ body: { scrubPII: true } });

        await deleteAdminUser(req, res, next);

        expect(notifyAdminActionToUser).toHaveBeenCalledTimes(1);
        expect(notifyAdminActionToUser.mock.calls[0][0].targetUser.email).toBe('target@example.com');
    });

    test('the cached session is still invalidated for the original address', async () => {
        const targetUser = makeUserDoc();
        User.findById.mockResolvedValue(targetUser);

        const { req, res, next } = makeReqRes({ body: { scrubPII: true } });

        await deleteAdminUser(req, res, next);

        expect(invalidateUserCacheByEmail).toHaveBeenCalledWith('target@example.com');
    });

    test('the admin response reports the scrubbed placeholder', async () => {
        const targetUser = makeUserDoc();
        User.findById.mockResolvedValue(targetUser);

        const { req, res, next } = makeReqRes({ body: { scrubPII: true } });

        await deleteAdminUser(req, res, next);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            user: expect.objectContaining({
                email: targetUser.email,
            }),
        }));
    });

    test('the address is left untouched when scrubPII is not requested', async () => {
        const targetUser = makeUserDoc();
        User.findById.mockResolvedValue(targetUser);

        const { req, res, next } = makeReqRes({ body: { reason: 'no scrub' } });

        await deleteAdminUser(req, res, next);

        expect(targetUser.email).toBe('target@example.com');
        expect(notifyAdminActionToUser.mock.calls[0][0].targetUser.email).toBe('target@example.com');
        expect(invalidateUserCacheByEmail).toHaveBeenCalledWith('target@example.com');
    });
});
