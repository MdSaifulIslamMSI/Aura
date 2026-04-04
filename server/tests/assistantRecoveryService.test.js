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

    test('treats "find any laptops" as a category search instead of querying for "any"', async () => {
        queryProducts.mockResolvedValue({
            products: [
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
                {
                    id: 'lenovo-ideapad',
                    title: 'Lenovo IdeaPad Slim 5',
                    brand: 'Lenovo',
                    category: 'Laptops',
                    price: 62999,
                    stock: 11,
                    rating: 4.4,
                    ratingCount: 2600,
                },
            ],
        });

        const result = await processRecoveredAssistantTurn({
            message: 'find any laptops',
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
                category: 'Laptops',
            },
        });
        expect(result.products.map((product) => product.id)).toEqual(['dell-inspiron', 'lenovo-ideapad']);
        expect(result.answer).toContain('Laptops');
        expect(result.answer).not.toContain('for any');
    });

    test('answers general knowledge without product ui payload', async () => {
        generateStructuredResponse
            .mockResolvedValueOnce({
                payload: {
                    intent: 'general_knowledge',
                    confidence: 0.95,
                    response: 'Narendra Modi is the Prime Minister of India.',
                    entities: {
                        query: 'Narendra Modi',
                    },
                    meta: {},
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

    test('uses planner metadata to recover navigation targets the rules did not name cleanly', async () => {
        generateStructuredResponse.mockResolvedValueOnce({
            payload: {
                intent: 'navigation',
                confidence: 0.91,
                response: 'Opening visual search.',
                entities: {
                    query: '',
                    productId: '',
                    category: '',
                    maxPrice: 0,
                    quantity: 0,
                },
                meta: {
                    page: 'visual_search',
                    navigationParams: {},
                },
            },
            provider: 'groq',
        });

        const result = await processRecoveredAssistantTurn({
            message: 'take me to the camera lookup tool',
            context: {
                route: '/',
                routeLabel: 'Home feed',
                sessionMemory: {
                    lastQuery: '',
                    lastResults: [],
                    activeProduct: null,
                    currentIntent: '',
                },
            },
        });

        expect(generateStructuredResponse).toHaveBeenCalled();
        expect(result.assistantTurn).toMatchObject({
            intent: 'navigation',
            decision: 'act',
            actions: [
                {
                    type: 'navigate_to',
                    page: 'visual_search',
                },
            ],
            ui: {
                navigation: {
                    path: '/visual-search',
                },
            },
        });
        expect(result.answer).toBe('Opening Visual Search.');
    });

    test('responds to greetings locally instead of resurfacing product choices', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'hello',
            context: {
                sessionMemory: {
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
        expect(result.answer).toBe('Hi. I can help with shopping, navigation, and live app questions.');
    });

    test('treats bare non-commerce topics as knowledge requests instead of product clarification', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'trump',
            context: {
                sessionMemory: {
                    lastQuery: 'iphone',
                    lastResults: [
                        {
                            id: 'iphone-15',
                            title: 'Apple iPhone 15',
                            brand: 'Apple',
                            category: 'Mobiles',
                        },
                    ],
                    activeProduct: null,
                    currentIntent: 'product_search',
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
        expect(result.answer).toContain('The live knowledge service is unavailable right now');
        expect(result.answer).not.toContain('Choose one of these options');
    });

    test('opens the first visible product from a plain-language follow-up', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'open the first one',
            context: {
                sessionMemory: {
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
                },
            },
        });

        expect(generateStructuredResponse).toHaveBeenCalledTimes(1);
        expect(result.assistantTurn).toMatchObject({
            intent: 'navigation',
            decision: 'act',
            actions: [
                {
                    type: 'navigate_to',
                    page: 'product',
                    params: {
                        productId: 'iphone-15',
                    },
                },
            ],
            ui: {
                navigation: {
                    path: '/product/iphone-15',
                },
            },
        });
    });

    test('can open compare with the first two visible products', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'compare the first two',
            context: {
                sessionMemory: {
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
                },
            },
        });

        expect(result.assistantTurn).toMatchObject({
            intent: 'product_search',
            decision: 'act',
            actions: [
                {
                    type: 'navigate_to',
                    page: 'compare',
                    params: {
                        ids: 'iphone-15,iphone-15-plus',
                    },
                },
            ],
            ui: {
                surface: 'product_results',
                products: [
                    {
                        id: 'iphone-15',
                    },
                    {
                        id: 'iphone-15-plus',
                    },
                ],
                navigation: {
                    path: '/compare?ids=iphone-15%2Ciphone-15-plus',
                },
            },
        });
        expect(result.answer).toBe('Comparing the first two results.');
    });

    test('answers product-detail questions from the current product context', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'what warranty does this have',
            context: {
                currentProduct: {
                    id: 'laptop-1',
                    title: 'AuraBook Pro 14',
                    brand: 'Aura',
                    category: 'Laptops',
                    price: 89999,
                    stock: 7,
                    warranty: '2 year warranty',
                    deliveryTime: '2-3 days',
                },
                sessionMemory: {
                    lastQuery: '',
                    lastResults: [],
                    activeProduct: {
                        id: 'laptop-1',
                        title: 'AuraBook Pro 14',
                        brand: 'Aura',
                        category: 'Laptops',
                    },
                    currentIntent: 'product_search',
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
        expect(result.answer).toContain('2 year warranty');
        expect(result.products).toEqual([]);
    });

    test('falls back to grounded product detail answers when the planner is off-target', async () => {
        generateStructuredResponse.mockResolvedValueOnce({
            payload: {
                intent: 'general_knowledge',
                confidence: 0.96,
                response: 'Warranty depends on the seller and region.',
                entities: {
                    query: 'warranty',
                },
                meta: {},
            },
            provider: 'groq',
        });

        const result = await processRecoveredAssistantTurn({
            message: 'what warranty does this have',
            context: {
                currentProduct: {
                    id: 'laptop-1',
                    title: 'AuraBook Pro 14',
                    brand: 'Aura',
                    category: 'Laptops',
                    price: 89999,
                    stock: 7,
                    warranty: '2 year warranty',
                    deliveryTime: '2-3 days',
                },
                sessionMemory: {
                    lastQuery: '',
                    lastResults: [],
                    activeProduct: {
                        id: 'laptop-1',
                        title: 'AuraBook Pro 14',
                        brand: 'Aura',
                        category: 'Laptops',
                    },
                    currentIntent: 'product_search',
                },
            },
        });

        expect(generateStructuredResponse).toHaveBeenCalledTimes(1);
        expect(result.answer).toContain('2 year warranty');
        expect(result.answer).not.toBe('Warranty depends on the seller and region.');
        expect(result.products).toEqual([]);
    });

    test('does not hijack support warranty requests with stale product detail answers', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'i need warranty help',
            context: {
                route: '/orders',
                routeLabel: 'Orders',
                activeOrderId: 'ORD-12345',
                orderId: 'ORD-12345',
                sessionMemory: {
                    lastQuery: '',
                    lastResults: [],
                    activeProduct: {
                        id: 'iphone-15',
                        title: 'Apple iPhone 15',
                        brand: 'Apple',
                        category: 'Mobiles',
                        warranty: '1 year warranty',
                    },
                    currentIntent: 'support',
                },
            },
        });

        expect(result.assistantTurn).toMatchObject({
            intent: 'support',
            decision: 'act',
            ui: {
                surface: 'support_handoff',
            },
        });
        expect(result.answer).not.toContain('Apple iPhone 15 includes');
    });

    test('answers payment capability questions locally', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'can i pay with upi',
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
        expect(result.answer).toContain('UPI is supported');
    });

    test('navigates to saved payment settings when asked where to manage payment methods', async () => {
        const result = await processRecoveredAssistantTurn({
            message: 'where do i manage payment methods',
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
                    page: 'profile',
                    params: {
                        tab: 'settings',
                    },
                },
            ],
            ui: {
                navigation: {
                    path: '/profile?tab=settings',
                },
            },
        });
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
        expect(second.answer).toBe('Pick the matching product so I can continue.');
        expect(second.answer).not.toBe(first.answer);
        expect(second.products.map((product) => product.id)).toEqual(['iphone-15', 'iphone-15-plus']);
    });
});
