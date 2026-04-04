jest.mock('../services/catalogService', () => ({
    queryProducts: jest.fn(),
}));

const { queryProducts } = require('../services/catalogService');
const { mergeSearchContext, searchProducts } = require('../services/ai/assistantSearchService');

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

    test('merges shorthand budget follow ups into the previous search context', () => {
        expect(mergeSearchContext({
            message: 'beautiful phone 4k price',
            lastQuery: '',
            category: '',
        })).toMatchObject({
            query: 'phones',
            category: 'Mobiles',
            maxPrice: 4000,
        });

        expect(mergeSearchContext({
            message: 'then 10k price',
            lastQuery: 'oppo phones',
            category: 'Mobiles',
        })).toMatchObject({
            query: 'oppo phones',
            category: 'Mobiles',
            maxPrice: 10000,
        });
    });

    test('starts a fresh search when the user switches product category', () => {
        expect(mergeSearchContext({
            message: 'show laptops under 70000',
            lastQuery: 'samsung phones',
            category: 'Mobiles',
        })).toMatchObject({
            query: 'laptops',
            category: 'Laptops',
            maxPrice: 70000,
            refinementOnly: false,
        });
    });

    test('falls back to closest matches when strict budget filtering finds nothing', async () => {
        queryProducts.mockImplementation(async ({ maxPrice }) => ({
            products: maxPrice
                ? []
                : [
                    {
                        id: 'oppo-a79',
                        title: 'OPPO A79 5G',
                        brand: 'OPPO',
                        category: 'Mobiles',
                        price: 17999,
                        stock: 12,
                        rating: 4.4,
                        ratingCount: 2400,
                    },
                    {
                        id: 'dell-inspiron',
                        title: 'Dell Inspiron 15 Laptop',
                        brand: 'Dell',
                        category: 'Laptops',
                        price: 54999,
                        stock: 8,
                        rating: 4.5,
                        ratingCount: 3100,
                    },
                ],
        }));

        const result = await searchProducts({
            query: 'oppo phones',
            maxPrice: 10000,
        });

        expect(result.usedClosestMatch).toBe(true);
        expect(result.products.map((product) => product.id)).toEqual(['oppo-a79']);
    });

    test('falls back to category browsing when a brand-like broad query has no catalog matches', async () => {
        const fallbackProducts = [
            {
                id: 'mobile-1',
                title: 'Galaxy S10',
                brand: 'Samsung',
                category: 'Mobiles',
                price: 24999,
                stock: 12,
                rating: 4.5,
                ratingCount: 4200,
            },
            {
                id: 'mobile-2',
                title: 'Pixel 8',
                brand: 'Google',
                category: 'Mobiles',
                price: 39999,
                stock: 8,
                rating: 4.6,
                ratingCount: 3100,
            },
        ];

        queryProducts.mockImplementation(async ({ keyword, category }) => {
            if (category === 'Mobiles' && /oneplus/i.test(String(keyword || ''))) {
                return { products: [] };
            }
            if (category === 'Mobiles') {
                return { products: fallbackProducts };
            }
            return { products: [] };
        });

        const result = await searchProducts({
            query: 'oneplus',
            category: 'Mobiles',
            limit: 2,
        });

        expect(result.usedClosestMatch).toBe(true);
        expect(result.products.map((product) => product.id)).toEqual(expect.arrayContaining(['mobile-1', 'mobile-2']));
        expect(result.products).toHaveLength(2);
    });

    test('supports generic budget browsing even when there is no explicit category or query', async () => {
        queryProducts.mockResolvedValue({
            products: [
                {
                    id: 'book-1',
                    title: 'Budget Book',
                    brand: 'Aura',
                    category: 'Books',
                    price: 799,
                    stock: 12,
                    rating: 4.4,
                    ratingCount: 1200,
                },
                {
                    id: 'book-2',
                    title: 'Another Budget Book',
                    brand: 'Aura',
                    category: 'Books',
                    price: 899,
                    stock: 9,
                    rating: 4.3,
                    ratingCount: 950,
                },
            ],
        });

        const result = await searchProducts({
            query: 'premium',
            maxPrice: 1000,
            limit: 2,
        });

        expect(result.usedClosestMatch).toBe(false);
        expect(result.products.map((product) => product.id)).toEqual(['book-1', 'book-2']);
    });
});
