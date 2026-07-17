const { __testables } = require('../services/recommendationService');

const recommendation = ({ id, category, price }) => ({
    product: { id, category, price },
    score: 1,
    source: 'test',
    reason: 'test',
});

describe('recommendationService assistant intent constraints', () => {
    test.each([
        ['recommend phones under ₹30k', 30000],
        ['recommend laptops below INR 75,000', 75000],
        ['suggest a phone within 1 lakh', 100000],
        ['show shoes under Rs. 4 thousand', 4000],
        ['recommend a car below 1.2 crore', 12000000],
        ['recommend phones at most 30k', 30000],
        ['recommend phones not more than 30k', 30000],
        ['phone budget 30k', 30000],
    ])('parses Indian shopping budgets from %s', (message, expected) => {
        expect(__testables.extractAssistantBudget(message)).toBe(expected);
    });

    test('does not fall back to over-budget or wrong-category recommendations', () => {
        const candidates = [
            recommendation({ id: 1, category: 'Mobiles', price: 45000 }),
            recommendation({ id: 2, category: 'Laptops', price: 25000 }),
            recommendation({ id: 3, category: '', price: 20000 }),
            recommendation({ id: 4, category: 'Mobiles', price: null }),
        ];

        expect(__testables.filterByAssistantIntent(candidates, {
            category: 'Mobiles',
            maxPrice: 30000,
        }, 5)).toEqual([]);
    });

    test('keeps unconstrained recommendation fallback behavior', () => {
        const candidates = [recommendation({ id: 3, category: 'Books', price: 800 })];

        expect(__testables.filterByAssistantIntent(candidates, {}, 5)).toEqual(candidates);
    });

    test('treats a product category as a seed rather than a hard constraint for add-ons', () => {
        const intent = __testables.getRecommendationIntent('laptop accessories under 5k');
        expect(intent).toMatchObject({
            category: '',
            seedCategory: 'Laptops',
            maxPrice: 5000,
            wantsAddOns: true,
        });
        expect(__testables.normalizeAssistantAddOnSearchQuery('laptop accessories under 5k', intent)).toBe('accessories');
        expect(__testables.buildAssistantSearchCandidateRequest({
            message: 'laptop accessories under 5k',
            intent,
            limit: 10,
        })).toEqual({
            query: 'accessories',
            category: '',
            maxPrice: 5000,
            limit: 10,
        });
        expect(__testables.filterByAssistantIntent([
            recommendation({ id: 8, category: 'Computer Accessories', price: 1299 }),
        ], intent, 5)).toHaveLength(1);
    });

    test('keeps specific add-on terms while removing the seed category and budget phrase', () => {
        const message = 'recommend a laptop sleeve accessory below ₹2k';
        const intent = __testables.getRecommendationIntent(message);

        expect(__testables.normalizeAssistantAddOnSearchQuery(message, intent)).toBe('sleeve accessories');
    });

    test('does not mistake a product specification introduced by "with" for an add-on', () => {
        expect(__testables.getRecommendationIntent('laptops with 16gb under 75k')).toMatchObject({
            category: 'Laptops',
            seedCategory: 'Laptops',
            maxPrice: 75000,
            wantsAddOns: false,
        });
    });
});
