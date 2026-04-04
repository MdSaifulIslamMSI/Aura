const { compileIntentCommand } = require('../services/ai/assistantIntentCompiler');

describe('assistantIntentCompiler', () => {
    test('extracts category and limit without leaking filler words into query', () => {
        expect(compileIntentCommand({
            input: 'give me 30 kitchen products',
        })).toEqual({
            intent: 'SEARCH_PRODUCTS',
            category: 'kitchen',
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: 30,
            target: null,
            confidence: 0.92,
        });
    });

    test('extracts price filters as structured parameters', () => {
        expect(compileIntentCommand({
            input: 'laptop under 5000',
        })).toEqual({
            intent: 'FILTER_PRODUCTS',
            category: 'laptops',
            query: null,
            filters: {
                priceMax: 5000,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.94,
        });
    });

    test('keeps only the brand token when category is present', () => {
        expect(compileIntentCommand({
            input: 'show oppo phones',
        })).toEqual({
            intent: 'SEARCH_PRODUCTS',
            category: 'phones',
            query: 'oppo',
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.92,
        });
    });

    test('uses session context for follow-up price filters', () => {
        expect(compileIntentCommand({
            input: 'then 10k price',
            sessionMemory: {
                lastQuery: 'oppo phones',
                activeProduct: null,
            },
            assistantSession: {
                lastEntities: {
                    query: 'oppo',
                    category: 'Mobiles',
                },
            },
        })).toEqual({
            intent: 'FILTER_PRODUCTS',
            category: 'phones',
            query: 'oppo',
            filters: {
                priceMax: 10000,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.9,
        });
    });

    test('does not leak the previous query when the user switches category in a filtered search', () => {
        expect(compileIntentCommand({
            input: 'show laptops under 70000',
            sessionMemory: {
                lastQuery: 'samsung phones',
                activeProduct: null,
            },
            assistantSession: {
                lastEntities: {
                    query: 'samsung',
                    category: 'Mobiles',
                },
            },
        })).toEqual({
            intent: 'FILTER_PRODUCTS',
            category: 'laptops',
            query: null,
            filters: {
                priceMax: 70000,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.94,
        });
    });

    test('resolves add this to the last resolved entity id', () => {
        expect(compileIntentCommand({
            input: 'add this',
            assistantSession: {
                lastResolvedEntityId: 'iphone-15',
            },
        })).toEqual({
            intent: 'ADD_TO_CART',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: 'iphone-15',
            confidence: 0.95,
        });
    });

    test('routes direct page requests like show my cart to navigation instead of product search', () => {
        expect(compileIntentCommand({
            input: 'show my cart',
        })).toEqual({
            intent: 'NAVIGATE',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: 'cart',
            confidence: 0.93,
        });
    });

    test('recognizes newer workspace and utility routes as navigation targets', () => {
        expect(compileIntentCommand({
            input: 'open visual search',
        })).toEqual({
            intent: 'NAVIGATE',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: 'visual_search',
            confidence: 0.93,
        });
    });

    test('treats price alerts as a route request instead of a product price filter', () => {
        expect(compileIntentCommand({
            input: 'show price alerts',
        })).toEqual({
            intent: 'NAVIGATE',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: 'price_alerts',
            confidence: 0.93,
        });
    });

    test('routes profile management questions to the right page target', () => {
        expect(compileIntentCommand({
            input: 'where do i manage payment methods',
        })).toEqual({
            intent: 'NAVIGATE',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: 'profile_payments',
            confidence: 0.93,
        });
    });

    test('keeps fashion deal discovery in product search instead of misrouting to the deals page', () => {
        expect(compileIntentCommand({
            input: 'show fashion deals for men',
        })).toEqual({
            intent: 'SEARCH_PRODUCTS',
            category: 'mens-fashion',
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.92,
        });
    });

    test('treats rating-only refinements as a continuation of the current product search', () => {
        expect(compileIntentCommand({
            input: 'only 4 star and above',
            sessionMemory: {
                lastQuery: 'samsung phones',
                activeProduct: null,
            },
            assistantSession: {
                lastEntities: {
                    query: 'samsung',
                    category: 'Mobiles',
                    maxPrice: 30000,
                },
            },
        })).toEqual({
            intent: 'SEARCH_PRODUCTS',
            category: 'phones',
            query: 'samsung',
            filters: {
                priceMax: 30000,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.89,
        });
    });

    test('does not leak the previous query into generic budget browsing requests', () => {
        expect(compileIntentCommand({
            input: 'show products below 1000',
            sessionMemory: {
                lastQuery: 'oneplus phones',
                activeProduct: null,
            },
            assistantSession: {
                lastEntities: {
                    query: 'oneplus',
                    category: 'Mobiles',
                },
            },
        })).toEqual({
            intent: 'FILTER_PRODUCTS',
            category: null,
            query: null,
            filters: {
                priceMax: 1000,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.84,
        });
    });

    test('treats supported payment capability questions as answerable knowledge requests', () => {
        expect(compileIntentCommand({
            input: 'can i pay with upi',
        })).toEqual({
            intent: 'GENERAL_KNOWLEDGE',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.84,
        });
    });

    test('routes simple greetings to the local knowledge responder', () => {
        expect(compileIntentCommand({
            input: 'hello there',
        })).toEqual({
            intent: 'GENERAL_KNOWLEDGE',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.96,
        });
    });
});
