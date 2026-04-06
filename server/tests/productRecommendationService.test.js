jest.mock('../services/catalogService', () => ({
    queryProducts: jest.fn(),
    getActiveCatalogVersion: jest.fn(),
}));

jest.mock('../models/Product', () => ({
    find: jest.fn(),
}));

jest.mock('../models/User', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/Cart', () => ({
    findOne: jest.fn(),
}));

const Product = require('../models/Product');
const User = require('../models/User');
const Cart = require('../models/Cart');
const { queryProducts, getActiveCatalogVersion } = require('../services/catalogService');
const { buildProductRecommendations } = require('../services/productRecommendationService');

const mockUserLookup = (payload) => {
    const lean = jest.fn().mockResolvedValue(payload);
    const select = jest.fn().mockReturnValue({ lean });
    User.findById.mockReturnValue({ select });
};

const mockCartLookup = (payload) => {
    const lean = jest.fn().mockResolvedValue(payload);
    const select = jest.fn().mockReturnValue({ lean });
    Cart.findOne.mockReturnValue({ select });
};

const mockProductLookup = (products) => {
    const lean = jest.fn().mockResolvedValue(products);
    Product.find.mockReturnValue({ lean });
};

describe('productRecommendationService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getActiveCatalogVersion.mockResolvedValue('legacy-v1');
        queryProducts.mockResolvedValue({ products: [] });
    });

    test('builds persistent recommendations from stored cart signals and excludes seed products', async () => {
        mockUserLookup({
            wishlist: [],
        });
        mockCartLookup({
            items: [{ productId: 101, quantity: 1 }],
        });
        mockProductLookup([
            {
                _id: '507f191e810c19729de860aa',
                id: 101,
                category: 'mobiles',
                brand: 'Apple',
                title: 'iPhone Seed',
            },
        ]);

        queryProducts
            .mockResolvedValueOnce({
                products: [
                    { id: 101, title: 'iPhone Seed' },
                    { id: 202, title: 'Candidate A' },
                ],
            })
            .mockResolvedValueOnce({
                products: [
                    { id: 203, title: 'Candidate B' },
                ],
            })
            .mockResolvedValueOnce({
                products: [
                    { id: 204, title: 'Candidate C' },
                ],
            });

        const result = await buildProductRecommendations({
            userId: '507f191e810c19729de860ab',
            input: {
                recentlyViewed: [{ id: 101, category: 'mobiles', brand: 'Apple' }],
                searchHistory: ['iphone 15'],
                limit: 6,
            },
        });

        expect(result.eyebrow).toBe('Persistent Cart Momentum');
        expect(result.primaryCategory).toBe('mobiles');
        expect(result.sourceLabels).toEqual(
            expect.arrayContaining(['persistent cart', 'recent browsing', 'search intent'])
        );
        expect(result.products.map((product) => product.id)).toEqual([202, 203, 204]);
        expect(queryProducts).toHaveBeenCalled();
    });

    test('falls back to cold-start picks when no durable or local signal exists', async () => {
        mockCartLookup(null);
        mockProductLookup([]);
        queryProducts.mockResolvedValueOnce({
            products: [{ id: 301, title: 'Cold Start Pick' }],
        });

        const result = await buildProductRecommendations({
            userId: null,
            input: {},
        });

        expect(User.findById).not.toHaveBeenCalled();
        expect(Cart.findOne).not.toHaveBeenCalled();
        expect(result.eyebrow).toBe('Account-Backed Picks');
        expect(result.products.map((product) => product.id)).toEqual([301]);
        expect(queryProducts).toHaveBeenCalledWith({ sort: 'rating', limit: 8 });
    });
});
