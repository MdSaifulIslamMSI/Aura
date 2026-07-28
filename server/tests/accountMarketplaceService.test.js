const chain = (value, methods) => {
    const query = {};
    methods.forEach((method) => {
        query[method] = jest.fn(() => query);
    });
    query.lean = jest.fn().mockResolvedValue(value);
    return query;
};

jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Product', () => ({ find: jest.fn() }));
jest.mock('../models/ProductReview', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));
jest.mock('../models/Listing', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));
jest.mock('../models/TradeIn', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));
jest.mock('../models/PriceAlert', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));

const User = require('../models/User');
const Product = require('../models/Product');
const ProductReview = require('../models/ProductReview');
const Listing = require('../models/Listing');
const TradeIn = require('../models/TradeIn');
const PriceAlert = require('../models/PriceAlert');
const { PREVIEW_LIMIT, buildAccountMarketplaceHub } = require('../services/accountMarketplaceService');

describe('account marketplace service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('bounds every preview and owner-scopes all marketplace queries', async () => {
        const ownerId = '507f1f77bcf86cd799439211';
        User.findById.mockReturnValue(chain({
            wishlist: [{ id: 9, title: 'Saved item', image: '/item.webp', price: 99, stock: 2 }],
            wishlistRevision: 4,
            wishlistSyncedAt: new Date('2026-07-25T10:00:00Z'),
        }, ['select']));
        Product.find.mockReturnValue(chain([
            { id: 9, title: 'Live title', image: '/live.webp', price: 89, stock: 3 },
        ], ['select']));
        Listing.find.mockReturnValue(chain([
            { _id: '507f1f77bcf86cd799439212', title: 'Owned listing', images: ['/listing.webp'], status: 'active' },
        ], ['select', 'sort', 'limit']));
        ProductReview.find.mockReturnValue(chain([
            {
                _id: '507f1f77bcf86cd799439213',
                product: { id: 9, title: 'Live title', image: '/live.webp' },
                rating: 5,
                comment: 'Excellent item',
                status: 'published',
            },
        ], ['select', 'populate', 'sort', 'limit']));
        TradeIn.find.mockReturnValue(chain([], ['select', 'sort', 'limit']));
        PriceAlert.find.mockReturnValue(chain([], ['select', 'sort', 'limit']));
        Listing.countDocuments.mockResolvedValue(1);
        ProductReview.countDocuments.mockResolvedValue(1);
        TradeIn.countDocuments.mockResolvedValue(0);
        PriceAlert.countDocuments.mockResolvedValue(0);

        const result = await buildAccountMarketplaceHub(ownerId);

        expect(User.findById).toHaveBeenCalledWith(ownerId);
        expect(Listing.find).toHaveBeenCalledWith({ seller: ownerId });
        expect(ProductReview.find).toHaveBeenCalledWith({ user: ownerId });
        expect(TradeIn.find).toHaveBeenCalledWith({ user: ownerId });
        expect(PriceAlert.find).toHaveBeenCalledWith({ user: ownerId });
        expect(Listing.countDocuments).toHaveBeenCalledWith({ seller: ownerId });
        expect(result.previewLimit).toBe(PREVIEW_LIMIT);
        expect(result.savedItems.items[0]).toEqual(expect.objectContaining({
            productId: 9,
            title: 'Live title',
            price: 89,
            href: '/product/9',
        }));
        expect(result.reviews.items[0]).not.toHaveProperty('user');
        expect(result.reviews.items[0]).not.toHaveProperty('riskSnapshot');
        expect(result.listings.items[0]).not.toHaveProperty('seller');
    });

    test('does not disclose a hub for a missing account', async () => {
        User.findById.mockReturnValue(chain(null, ['select']));
        Product.find.mockReturnValue(chain([], ['select']));
        Listing.find.mockReturnValue(chain([], ['select', 'sort', 'limit']));
        ProductReview.find.mockReturnValue(chain([], ['select', 'populate', 'sort', 'limit']));
        TradeIn.find.mockReturnValue(chain([], ['select', 'sort', 'limit']));
        PriceAlert.find.mockReturnValue(chain([], ['select', 'sort', 'limit']));
        Listing.countDocuments.mockResolvedValue(0);
        ProductReview.countDocuments.mockResolvedValue(0);
        TradeIn.countDocuments.mockResolvedValue(0);
        PriceAlert.countDocuments.mockResolvedValue(0);

        await expect(buildAccountMarketplaceHub('507f1f77bcf86cd799439299'))
            .rejects.toMatchObject({ code: 'ACCOUNT_PROFILE_NOT_FOUND' });
    });
});
