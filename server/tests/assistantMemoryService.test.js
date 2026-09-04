const { hasReferringExpression, resolveReferringExpression } = require('../services/ai/assistantMemoryService');

describe('assistantMemoryService', () => {
    const session = {
        activeProduct: { id: '101' },
        lastResults: [
            { id: '101', title: 'Aura Phone Pro', brand: 'Aura', category: 'Mobiles', price: 45000, rating: 4.2 },
            { id: '202', title: 'Prime Phone Lite', brand: 'Prime', category: 'Mobiles', price: 22000, rating: 4.6 },
            { id: '303', title: 'Aura Phone Max', brand: 'Aura', category: 'Mobiles', price: 68000, rating: 4.8 },
        ],
    };

    test('resolves ordinals against session results', () => {
        expect(resolveReferringExpression({ message: 'add the second one to cart', assistantSession: session }))
            .toMatchObject({ productId: '202', how: 'ordinal' });
        expect(resolveReferringExpression({ message: 'show the last one', assistantSession: session }))
            .toMatchObject({ productId: '303', how: 'ordinal' });
        expect(resolveReferringExpression({ message: 'option 1 please', assistantSession: session }))
            .toMatchObject({ productId: '101', how: 'ordinal' });
    });

    test('resolves pronouns to the active product, flags ambiguity otherwise', () => {
        expect(resolveReferringExpression({ message: 'add it to cart', assistantSession: session }))
            .toMatchObject({ productId: '101', how: 'pronoun_active' });
        const noActive = { ...session, activeProduct: null };
        expect(resolveReferringExpression({ message: 'add it to cart', assistantSession: noActive }))
            .toEqual({ ambiguous: true });
        const single = { activeProduct: null, lastResults: [session.lastResults[1]] };
        expect(resolveReferringExpression({ message: 'add it to cart', assistantSession: single }))
            .toMatchObject({ productId: '202', how: 'pronoun_single' });
    });

    test('resolves price/rating superlatives', () => {
        expect(resolveReferringExpression({ message: 'get the cheaper one', assistantSession: session }).productId).toBe('202');
        expect(resolveReferringExpression({ message: 'show the most expensive', assistantSession: session }).productId).toBe('303');
        expect(resolveReferringExpression({ message: 'which is top rated', assistantSession: session }).productId).toBe('303');
    });

    test('resolves unique attribute mentions, flags ambiguous ones', () => {
        expect(resolveReferringExpression({ message: 'add the prime one', assistantSession: session }))
            .toMatchObject({ productId: '202', how: 'attribute' });
        expect(resolveReferringExpression({ message: 'the aura one', assistantSession: session }))
            .toEqual({ ambiguous: true });
    });

    test('returns null without session state or references', () => {
        expect(resolveReferringExpression({ message: 'add it to cart', assistantSession: {} })).toBeNull();
        expect(resolveReferringExpression({ message: 'show me phones', assistantSession: session })).toBeNull();
        expect(hasReferringExpression({ message: 'the second one', assistantSession: session })).toBe(true);
        expect(hasReferringExpression({ message: 'hello', assistantSession: session })).toBe(false);
    });
});
