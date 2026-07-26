jest.mock('../models/User');
jest.mock('../models/Order');
jest.mock('../models/Listing');
jest.mock('../models/SupportTicket');

const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const SupportTicket = require('../models/SupportTicket');
const { buildAccountOverview } = require('../services/accountOverviewService');

const buildQuery = (value) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
});

describe('account overview service', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        User.findById.mockReturnValue(buildQuery({
            _id: '507f1f77bcf86cd799439201',
            name: 'Overview User',
            email: 'overview@example.com',
            phone: '+919876543210',
            avatar: 'https://cdn.example/avatar.webp',
            dob: new Date('1990-01-01T00:00:00.000Z'),
            bio: 'A complete profile',
            isVerified: true,
            isSeller: true,
            accountState: 'active',
            addresses: [{ city: 'Delhi' }],
            wishlist: [{
                id: 42,
                title: 'Saved product',
                image: 'https://cdn.example/product.webp',
                price: 1200,
                internalNote: 'must-not-leak',
            }],
            createdAt: new Date('2025-01-02T00:00:00.000Z'),
        }));
        Order.countDocuments
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(1);
        Order.find.mockReturnValue(buildQuery([{
            _id: '507f1f77bcf86cd799439202',
            orderStatus: 'shipped',
            isPaid: true,
            isDelivered: false,
            presentmentTotalPrice: 1250,
            presentmentCurrency: 'INR',
            createdAt: new Date('2026-07-25T00:00:00.000Z'),
            orderItems: [{
                title: 'Display-safe product',
                image: 'https://cdn.example/order.webp',
                price: 999,
            }],
            paymentResult: { id: 'provider-secret' },
        }]));
        SupportTicket.countDocuments.mockResolvedValue(1);
        SupportTicket.findOne.mockReturnValue(buildQuery({
            _id: '507f1f77bcf86cd799439203',
            subject: 'Action needed',
            status: 'open',
            category: 'order_issue',
            lastMessageAt: new Date('2026-07-24T00:00:00.000Z'),
            liveCallLastSessionKey: 'must-not-leak',
        }));
        Listing.countDocuments
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(3);
        Listing.findOne.mockReturnValue(buildQuery({
            _id: '507f1f77bcf86cd799439204',
            title: 'Recent listing',
            images: ['https://cdn.example/listing.webp'],
            status: 'active',
            views: 9,
            createdAt: new Date('2026-07-23T00:00:00.000Z'),
            escrow: { paymentIntentId: 'must-not-leak' },
        }));
    });

    test('returns a bounded versioned projection from parallel owner-scoped sources', async () => {
        const result = await buildAccountOverview('507f1f77bcf86cd799439201');

        expect(result).toMatchObject({
            contractVersion: 1,
            identity: {
                name: 'Overview User',
                completion: 100,
                accountState: 'active',
            },
            orders: {
                activeCount: 2,
            },
            postPurchase: {
                pendingCount: 1,
            },
            savedItems: {
                count: 1,
            },
            support: {
                openCount: 1,
            },
            marketplace: {
                activeCount: 1,
                soldCount: 3,
            },
            meta: {
                partial: false,
                unavailable: [],
            },
        });

        expect(Order.find).toHaveBeenCalledWith({ user: '507f1f77bcf86cd799439201' });
        expect(SupportTicket.countDocuments).toHaveBeenCalledWith({
            user: '507f1f77bcf86cd799439201',
            status: 'open',
        });
        expect(Listing.countDocuments).toHaveBeenCalledWith({
            seller: '507f1f77bcf86cd799439201',
            status: 'active',
        });

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('must-not-leak');
        expect(serialized).not.toContain('provider-secret');
        expect(serialized).not.toContain('paymentResult');
        expect(serialized).not.toContain('escrow');
        expect(serialized).not.toContain('internalNote');
    });

    test('keeps identity and successful sections when an optional source fails', async () => {
        const orderQuery = buildQuery([]);
        orderQuery.lean.mockRejectedValue(new Error('orders unavailable'));
        Order.find.mockReturnValue(orderQuery);

        const result = await buildAccountOverview('507f1f77bcf86cd799439201');

        expect(result.identity.name).toBe('Overview User');
        expect(result.orders).toEqual({ activeCount: 0, recent: [] });
        expect(result.postPurchase.pendingCount).toBe(1);
        expect(result.meta).toEqual({
            partial: true,
            unavailable: ['orders'],
        });
    });

    test('fails when the authoritative identity source is unavailable', async () => {
        User.findById.mockReturnValue(buildQuery(null));

        await expect(buildAccountOverview('507f1f77bcf86cd799439201'))
            .rejects
            .toMatchObject({ code: 'ACCOUNT_PROFILE_NOT_FOUND' });
    });
});
