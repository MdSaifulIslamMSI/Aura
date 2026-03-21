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
            query: 'phone',
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
});
