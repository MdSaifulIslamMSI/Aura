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
            confidence: 0.9,
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

    test('returns clarify for ambiguous inputs instead of guessing', () => {
        expect(compileIntentCommand({
            input: 'hello there',
        })).toEqual({
            intent: 'CLARIFY',
            category: null,
            query: null,
            filters: {
                priceMax: null,
                priceMin: null,
            },
            limit: null,
            target: null,
            confidence: 0.18,
        });
    });
});
