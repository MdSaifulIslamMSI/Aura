jest.mock('../services/ai/providerRegistry', () => ({
    generateStructuredResponse: jest.fn(),
}));

jest.mock('../services/catalogService', () => ({
    getProductByIdentifier: jest.fn(),
    queryProducts: jest.fn(),
}));

const { generateStructuredResponse } = require('../services/ai/providerRegistry');
const { getProductByIdentifier, queryProducts } = require('../services/catalogService');
const { processRecoveredAssistantTurn } = require('../services/ai/assistantRecoveryService');

describe('assistantRecoveryService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns product search results without unrelated catalog bleed', async () => {
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

        const result = await processRecoveredAssistantTurn({
            message: 'search iphone',
            context: {
                sessionMemory: {
                    lastQuery: '',
                    lastResults: [],
                    activeProduct: null,
                    currentIntent: '',
                },
            },
        });

        expect(result.assistantTurn).toMatchObject({
            intent: 'product_search',
            decision: 'respond',
        });
        expect(result.products.map((product) => product.id)).toEqual(['iphone-15']);
        expect(result.answer).toContain('relevant result');
    });

    test('answers general knowledge without product ui payload', async () => {
        generateStructuredResponse
            .mockResolvedValueOnce({
                payload: {
                    intent: 'general_knowledge',
                    entities: {
                        query: 'who is narendra modi',
                        productId: '',
                        quantity: 0,
                    },
                    confidence: 0.94,
                    decision: 'respond',
                    response: 'Narendra Modi is the Prime Minister of India.',
                },
                provider: 'groq',
            })
            .mockResolvedValueOnce({
                payload: {
                    answer: 'Narendra Modi is the Prime Minister of India.',
                },
                provider: 'groq',
            });

        const result = await processRecoveredAssistantTurn({
            message: 'who is Narendra Modi',
            context: {
                sessionMemory: {
                    lastQuery: '',
                    lastResults: [],
                    activeProduct: null,
                    currentIntent: '',
                },
            },
        });

        expect(result.assistantTurn).toMatchObject({
            intent: 'general_knowledge',
            decision: 'respond',
            ui: {
                surface: 'plain_answer',
            },
        });
        expect(result.products).toEqual([]);
        expect(result.answer).toContain('Prime Minister of India');
    });

    test('uses session memory for add this to cart', async () => {
        getProductByIdentifier.mockResolvedValue({
            id: 'iphone-15',
            title: 'Apple iPhone 15',
            brand: 'Apple',
            category: 'Mobiles',
            price: 69999,
        });

        const result = await processRecoveredAssistantTurn({
            message: 'add this to cart',
            context: {
                sessionMemory: {
                    lastQuery: 'iphone',
                    lastResults: [{
                        id: 'iphone-15',
                        title: 'Apple iPhone 15',
                        brand: 'Apple',
                        category: 'Mobiles',
                    }],
                    activeProduct: {
                        id: 'iphone-15',
                        title: 'Apple iPhone 15',
                        brand: 'Apple',
                        category: 'Mobiles',
                    },
                    currentIntent: 'product_search',
                },
            },
        });

        expect(result.assistantTurn).toMatchObject({
            intent: 'cart_action',
            decision: 'act',
            entities: {
                productId: 'iphone-15',
                quantity: 1,
            },
        });
        expect(result.assistantTurn.actions[0]).toMatchObject({
            type: 'add_to_cart',
            productId: 'iphone-15',
        });
    });
});
