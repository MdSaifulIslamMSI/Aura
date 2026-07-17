const fs = require('fs');

const createLeanQuery = (result) => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

jest.mock('../models/Product', () => ({
    find: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('../services/ai/modelGatewayService', () => ({
    embedText: jest.fn(),
    getGatewayConfig: jest.fn(() => ({
        provider: 'disabled',
        embedModel: '',
    })),
    getModelGatewayHealth: jest.fn(() => ({
        provider: 'disabled',
        activeProvider: 'disabled',
        healthy: false,
        error: 'model_gateway_disabled',
        capabilities: {
            textInput: false,
            imageInput: false,
            audioInput: false,
            chat: false,
            embeddings: false,
        },
    })),
}));

const Product = require('../models/Product');
const modelGateway = require('../services/ai/modelGatewayService');
const {
    __testables,
    scheduleProductIndexRefreshById,
    searchProductVectorIndex,
} = require('../services/ai/localProductVectorIndexService');

describe('localProductVectorIndexService deterministic no-model path', () => {
    const product = {
        id: 101,
        isPublished: true,
        title: 'Portable Gaming Laptop',
        displayTitle: 'Aura Portable Gaming Laptop',
        brand: 'Aura',
        category: 'Electronics',
        subCategory: 'Laptops',
        description: 'A compact machine for gaming and development.',
        highlights: ['Dedicated graphics'],
        specifications: [{ key: 'Memory', value: '8GB' }],
        price: 49999,
        stock: 7,
        rating: 4.5,
        deliveryTime: 'Usually dispatches in 2 days',
        warranty: '1 year manufacturer warranty',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        Product.find.mockReset();
        __testables.resetIndexCacheForTests();
        jest.spyOn(fs.promises, 'mkdir').mockResolvedValue();
        jest.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify({
            version: 1,
            embeddingModel: '',
            updatedAt: '2026-07-16T00:00:00.000Z',
            entries: {},
        }));
        jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();
        Product.find.mockImplementation(() => createLeanQuery([product]));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('hydrates and ranks rich lexical fields without attempting an embedding', async () => {
        const result = await searchProductVectorIndex('portable gaming laptop 8 gb', {
            limit: 3,
            filters: {
                category: 'Electronics',
                requiredTerms: ['8 gb'],
                inStock: true,
            },
        });

        expect(modelGateway.embedText).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            provider: 'vector_store',
            fallbackUsed: true,
            fallbackReason: 'query_embedding_skipped',
            retrievalHitCount: 1,
        });
        expect(result.results[0].product).toMatchObject({
            id: 101,
            subCategory: 'Laptops',
            specifications: [{ key: 'Memory', value: '8GB' }],
            deliveryTime: 'Usually dispatches in 2 days',
            warranty: '1 year manufacturer warranty',
        });

        const hydrationQuery = Product.find.mock.calls.find(([query]) => Array.isArray(query?.$or))?.[0];
        const requiredTermClause = hydrationQuery.$and.find((clause) => Array.isArray(clause.$or));
        const requiredTermFields = requiredTermClause.$or.map((clause) => Object.keys(clause)[0]);
        const lexicalFields = hydrationQuery.$or.map((clause) => Object.keys(clause)[0]);

        expect(requiredTermFields).toEqual(expect.arrayContaining([
            'displayTitle',
            'subCategory',
            'highlights',
            'specifications.key',
            'specifications.value',
        ]));
        expect(lexicalFields).toEqual(expect.arrayContaining([
            'displayTitle',
            'subCategory',
            'highlights',
            'specifications.key',
            'specifications.value',
        ]));
        expect(requiredTermClause.$or.find((clause) => clause['specifications.value'])['specifications.value'].test('8GB')).toBe(true);
    });

    test('re-applies hard filters after hydrating canonical product state', async () => {
        fs.promises.readFile.mockResolvedValueOnce(JSON.stringify({
            version: 1,
            embeddingModel: '',
            updatedAt: '2026-07-16T00:00:00.000Z',
            entries: {
                101: {
                    productId: 101,
                    embedding: [],
                    summary: {
                        ...product,
                        price: 29999,
                        stock: 7,
                    },
                },
            },
        }));
        Product.find.mockImplementation((query) => createLeanQuery(query?.id?.$in ? [{
                ...product,
                price: 69999,
                stock: 0,
            }] : []));

        const result = await searchProductVectorIndex('portable gaming laptop', {
            limit: 3,
            filters: {
                maxPrice: 30000,
                inStock: true,
            },
        });

        expect(result.results).toEqual([]);
        expect(result.retrievalHitCount).toBe(0);
        expect(modelGateway.embedText).not.toHaveBeenCalled();
    });

    test('does not schedule incremental embedding work while models are disabled', () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

        scheduleProductIndexRefreshById(101);

        expect(setTimeoutSpy).not.toHaveBeenCalled();
        expect(modelGateway.embedText).not.toHaveBeenCalled();
    });

    test('drops conversational noise and deterministically ranks the relevant lexical candidate', async () => {
        const unrelated = {
            ...product,
            id: 202,
            title: 'Camera Strap',
            displayTitle: 'Camera Strap',
            description: 'A product you can recommend to me.',
            highlights: [],
            specifications: [],
            rating: 4.9,
        };
        Product.find.mockImplementation(() => createLeanQuery([unrelated, product]));

        const result = await searchProductVectorIndex('can you recommend me a portable gaming laptop', {
            limit: 3,
            filters: { inStock: true },
        });

        expect(result.results[0].product.id).toBe(101);
        const broadHydrationQuery = Product.find.mock.calls.find(([query]) => Array.isArray(query?.$or))?.[0];
        const lexicalRegexes = broadHydrationQuery.$or.map((clause) => Object.values(clause)[0]);
        expect(lexicalRegexes.some((regex) => regex.test('laptop'))).toBe(true);
        expect(lexicalRegexes.some((regex) => regex.test('recommend'))).toBe(false);
        expect(lexicalRegexes.some((regex) => regex.test('me'))).toBe(false);
    });

    test('keeps a strict lexical match even when the bounded broad lane is filled with higher-rated partial matches', async () => {
        const partialMatches = Array.from({ length: 10 }, (_, index) => ({
            ...product,
            id: 200 + index,
            title: `Portable Camera Strap ${index}`,
            displayTitle: `Portable Camera Strap ${index}`,
            description: 'A highly rated carrying accessory.',
            highlights: [],
            specifications: [],
            rating: 4.9,
        }));
        const productsById = new Map([product, ...partialMatches].map((entry) => [entry.id, entry]));
        Product.find.mockImplementation((query) => {
            if (query?.id?.$in) {
                return createLeanQuery(query.id.$in.map((id) => productsById.get(id)).filter(Boolean));
            }
            const hasStrictTokenClauses = Array.isArray(query?.$and)
                && query.$and.some((clause) => Array.isArray(clause?.$or));
            return createLeanQuery(hasStrictTokenClauses ? [product] : partialMatches);
        });

        const result = await searchProductVectorIndex('portable gaming laptop', {
            limit: 1,
            filters: { inStock: true },
        });

        expect(result.results).toHaveLength(1);
        expect(result.results[0].product.id).toBe(product.id);
        expect(Product.find.mock.calls.some(([query]) => (
            Array.isArray(query?.$and) && query.$and.some((clause) => Array.isArray(clause?.$or))
        ))).toBe(true);
        expect(Product.find.mock.calls.some(([query]) => Array.isArray(query?.$or))).toBe(true);
        expect(modelGateway.embedText).not.toHaveBeenCalled();
    });
});
