jest.mock('../services/catalogService', () => ({
    queryProducts: jest.fn(),
}));

const { queryProducts } = require('../services/catalogService');
const {
    buildGroundedCatalogContext,
    executeCatalogActions,
} = require('../services/assistantCommerceService');

describe('assistantCommerceService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('builds grounded context from catalog results and marks demo inventory clearly', async () => {
        queryProducts.mockResolvedValueOnce({
            products: [
                {
                    id: 101,
                    title: 'Builder Notes Paperback',
                    brand: 'Builder Notes',
                    category: 'Books',
                    price: 1999,
                    rating: 4.4,
                    ratingCount: 420,
                    stock: 12,
                    deliveryTime: '2-5 days',
                    provenance: { trustTier: 'unverified', sourceType: 'dev_seed' },
                    publishGate: { status: 'dev_only' },
                },
            ],
        });

        const result = await buildGroundedCatalogContext({
            message: 'best books under 3000',
        });

        expect(queryProducts).toHaveBeenCalledWith(expect.objectContaining({
            category: 'Books',
            maxPrice: 3000,
            includeSponsored: false,
            sort: 'relevance',
        }));
        expect(result.commerceIntent).toBe(true);
        expect(result.actionType).toBe('search');
        expect(result.products[0].assistantMeta.demoCatalog).toBe(true);
        expect(result.groundingPrompt).toContain('demo catalog');
        expect(result.groundingPrompt).toContain('[P1]');
    });

    test('executes compare actions through catalog-aware retrieval', async () => {
        queryProducts
            .mockResolvedValueOnce({
                products: [{
                    id: 201,
                    title: 'Phone Alpha',
                    brand: 'Nova',
                    category: 'Mobiles',
                    price: 24999,
                }],
            })
            .mockResolvedValueOnce({
                products: [{
                    id: 202,
                    title: 'Phone Beta',
                    brand: 'Aster',
                    category: 'Mobiles',
                    price: 25999,
                }],
            });

        const result = await executeCatalogActions([
            {
                type: 'compare',
                params: {
                    keyword1: 'phone alpha',
                    keyword2: 'phone beta',
                },
            },
        ]);

        expect(result.actionType).toBe('compare');
        expect(result.products.map((product) => product.id)).toEqual([201, 202]);
        expect(queryProducts).toHaveBeenNthCalledWith(1, expect.objectContaining({
            keyword: 'phone alpha',
            limit: 1,
            includeSponsored: false,
        }));
        expect(queryProducts).toHaveBeenNthCalledWith(2, expect.objectContaining({
            keyword: 'phone beta',
            limit: 1,
            includeSponsored: false,
        }));
    });

    test('skips grounded retrieval for non-commerce prompts', async () => {
        const result = await buildGroundedCatalogContext({
            message: 'write a formal leave email for tomorrow',
        });

        expect(result.commerceIntent).toBe(false);
        expect(result.products).toEqual([]);
        expect(result.groundingPrompt).toBe('');
        expect(queryProducts).not.toHaveBeenCalled();
    });
});
