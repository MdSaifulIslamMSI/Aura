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

    test('navigates directly to category pages for open category commands', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'open electronics',
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
            intent: 'navigation',
            decision: 'act',
            actions: [
                {
                    type: 'navigate_to',
                    page: 'category',
                    params: {
                        category: 'electronics',
                    },
                },
            ],
            ui: {
                navigation: {
                    page: 'category',
                    path: '/category/electronics',
                },
            },
        });
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

    test('shows filtered oppo phones without unrelated catalog results', async () => {
        queryProducts.mockResolvedValue({
            products: [
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
                    id: 'oppo-reno',
                    title: 'OPPO Reno 11',
                    brand: 'OPPO',
                    category: 'Mobiles',
                    price: 28999,
                    stock: 9,
                    rating: 4.5,
                    ratingCount: 1800,
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
        });

        const result = await processRecoveredAssistantTurn({
            message: 'show oppo phones',
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
        expect(result.products.map((product) => product.id)).toEqual(expect.arrayContaining(['oppo-a79', 'oppo-reno']));
        expect(result.products).toHaveLength(2);
        expect(result.products.every((product) => product.brand === 'OPPO')).toBe(true);
    });

    test('refines the previous search for budget-only follow ups', async () => {
        const catalog = [
            {
                id: 'oppo-budget',
                title: 'OPPO A3x',
                brand: 'OPPO',
                category: 'Mobiles',
                price: 9999,
                stock: 12,
                rating: 4.2,
                ratingCount: 1600,
            },
            {
                id: 'oppo-premium',
                title: 'OPPO Reno 11',
                brand: 'OPPO',
                category: 'Mobiles',
                price: 15999,
                stock: 7,
                rating: 4.5,
                ratingCount: 2100,
            },
        ];

        queryProducts.mockImplementation(async ({ maxPrice }) => ({
            products: maxPrice
                ? catalog.filter((product) => product.price <= maxPrice)
                : catalog,
        }));

        const result = await processRecoveredAssistantTurn({
            message: 'then 10k price',
            context: {
                sessionMemory: {
                    lastQuery: 'oppo phones',
                    lastResults: [catalog[1]],
                    activeProduct: null,
                    currentIntent: 'product_search',
                    lastIntent: 'product_search',
                },
            },
        });

        expect(result.assistantTurn).toMatchObject({
            intent: 'product_search',
            decision: 'respond',
            entities: {
                query: 'oppo',
                category: 'Mobiles',
                maxPrice: 10000,
            },
            policy: {
                decision: 'EXECUTE',
                risk: 'LOW',
            },
        });
        expect(result.answer).toContain('Found 1 relevant result');
        expect(result.products.map((product) => product.id)).toEqual(['oppo-budget']);
    });

    test('uses compiled limit and category parameters for category-only searches', async () => {
        const kitchenProducts = Array.from({ length: 35 }, (_, index) => ({
            id: `kitchen-${index + 1}`,
            title: `Kitchen Product ${index + 1}`,
            brand: 'Aura Home',
            category: 'Home & Kitchen',
            price: 499 + index,
            stock: 20,
            rating: 4.2,
            ratingCount: 100 + index,
        }));

        queryProducts.mockResolvedValue({
            products: kitchenProducts,
        });

        const result = await processRecoveredAssistantTurn({
            message: 'give me 30 kitchen products',
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
            entities: {
                query: '',
                category: 'Home & Kitchen',
                limit: 30,
            },
        });
        expect(result.products).toHaveLength(30);
    });

    test('answers general knowledge without product ui payload', async () => {
        generateStructuredResponse
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

    test('requires confirmation before executing add this to cart', async () => {
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
            decision: 'clarify',
            entities: {
                productId: 'iphone-15',
                quantity: 1,
            },
            ui: {
                surface: 'confirmation_card',
                confirmation: {
                    action: {
                        type: 'add_to_cart',
                        productId: 'iphone-15',
                    },
                },
            },
            policy: {
                decision: 'CONFIRM',
                risk: 'HIGH',
            },
        });
        expect(result.answer).toContain('Add Apple iPhone 15 to your cart?');
    });

    test('escalates repeated cart clarification instead of looping the same question', async () => {
        const sessionMemory = {
            lastQuery: 'iphone',
            lastResults: [
                {
                    id: 'iphone-15',
                    title: 'Apple iPhone 15',
                    brand: 'Apple',
                    category: 'Mobiles',
                },
                {
                    id: 'iphone-15-plus',
                    title: 'Apple iPhone 15 Plus',
                    brand: 'Apple',
                    category: 'Mobiles',
                },
            ],
            activeProduct: null,
            currentIntent: 'product_search',
            lastIntent: 'product_search',
        };

        const first = await processRecoveredAssistantTurn({
            message: 'add this to cart',
            context: {
                sessionMemory,
            },
        });

        const second = await processRecoveredAssistantTurn({
            message: 'add this to cart',
            context: {
                sessionMemory: first.assistantTurn.sessionMemory,
            },
        });

        expect(first.assistantTurn.decision).toBe('clarify');
        expect(first.assistantTurn.ui.surface).toBe('product_results');
        expect(second.assistantTurn.decision).toBe('clarify');
        expect(second.answer).toBe('Choose one of these options so I can continue.');
        expect(second.answer).not.toBe(first.answer);
        expect(second.products.map((product) => product.id)).toEqual(['iphone-15', 'iphone-15-plus']);
    });
});
