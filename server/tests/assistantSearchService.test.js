jest.mock('../services/catalogService', () => ({
    queryProducts: jest.fn(),
}));

const { queryProducts } = require('../services/catalogService');
const { searchProducts } = require('../services/ai/assistantSearchService');

describe('assistantSearchService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('filters unrelated products out of a focused product search', async () => {
        queryProducts.mockResolvedValue({
            products: [
                {
                    id: 'iphone-15',
                    title: 'Apple iPhone 15',
                    brand: 'Apple',
                    category: 'Mobiles',
                    stock: 12,
                    rating: 4.7,
                    ratingCount: 4200,
                },
                {
                    id: 'dell-inspiron',
                    title: 'Dell Inspiron 15 Laptop',
                    brand: 'Dell',
                    category: 'Laptops',
                    stock: 8,
                    rating: 4.5,
                    ratingCount: 3100,
                },
            ],
        });

        const result = await searchProducts({
            query: 'search iphone',
        });

        expect(result.products.map((product) => product.id)).toEqual(['iphone-15']);
        expect(result.category).toBe('Mobiles');
    });

    test('respects excluded ids for follow-up show more queries', async () => {
        queryProducts.mockResolvedValue({
            products: [
                {
                    id: 'iphone-15',
                    title: 'Apple iPhone 15',
                    brand: 'Apple',
                    category: 'Mobiles',
                    stock: 12,
                    rating: 4.7,
                    ratingCount: 4200,
                },
                {
                    id: 'iphone-15-plus',
                    title: 'Apple iPhone 15 Plus',
                    brand: 'Apple',
                    category: 'Mobiles',
                    stock: 10,
                    rating: 4.6,
                    ratingCount: 2800,
                },
            ],
        });

        const result = await searchProducts({
            query: 'iphone',
            excludeIds: ['iphone-15'],
        });

        expect(result.products.map((product) => product.id)).toEqual(['iphone-15-plus']);
    });
});
