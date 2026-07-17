const {
    buildKnowledgeAnswerText,
    resolveAppCapabilityAnswer,
    retrieveCommerceKnowledge,
    __testables,
} = require('../services/ai/commerceKnowledgeRagService');

describe('commerceKnowledgeRagService', () => {
    test('retrieves return and refund policy guidance without external APIs', async () => {
        const result = await retrieveCommerceKnowledge({
            query: 'what is the return and refund policy',
            products: [],
        });

        expect(result.hitCount).toBeGreaterThan(0);
        expect(result.chunks[0]).toMatchObject({
            id: 'policy:return-refund',
            sourceType: 'policy',
        });
        expect(result.citations[0]).toMatchObject({
            type: 'policy',
            title: 'Return and refund policy',
        });
        expect(result.toolRun).toMatchObject({
            toolName: 'retrieve_knowledge',
            status: 'completed',
        });
    });

    test('adds product spec knowledge for manual-style questions', async () => {
        const product = {
            id: 101,
            title: 'AuraBook 14',
            brand: 'Aura',
            category: 'Laptops',
            description: 'Thin laptop for coding and study.',
            highlights: ['16GB RAM', '512GB SSD'],
            specifications: [{ key: 'Battery', value: '10 hours' }],
        };

        const result = await retrieveCommerceKnowledge({
            query: 'AuraBook battery specs manual',
            products: [product],
        });

        expect(result.chunks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'product-knowledge:101',
                sourceType: 'manual',
            }),
        ]));
        expect(buildKnowledgeAnswerText(result.chunks, { query: 'battery specs' })).toContain('AuraBook 14 product knowledge');
    });

    test('scores coupon questions against the live data guardrail chunk', () => {
        const score = __testables.scoreChunk('apply coupon discount', {
            policyType: 'pricing_inventory_coupon',
            sourceType: 'policy',
            title: 'Price, stock, and coupon accuracy',
            text: 'Coupon validation happens through checkout quote logic.',
            keywords: ['coupon', 'discount'],
        });

        expect(score).toBeGreaterThan(1);
    });

    test('answers contextual app help from the current route without a model', () => {
        const result = resolveAppCapabilityAnswer({
            query: 'what can I do here?',
            contextPath: '/cart',
        });

        expect(result.capability).toMatchObject({ id: 'cart', route: '/cart' });
        expect(result.answer).toContain('quantities');
        expect(result.answer).toContain('already on this app surface');
        expect(result.actions).toEqual([]);
    });

    test('returns a validated navigation action for a named app feature', () => {
        const result = resolveAppCapabilityAnswer({
            query: 'open price alerts',
            contextPath: '/assistant',
        });

        expect(result.answer).toContain('signed-in price alerts');
        expect(result.actions).toEqual([{
            type: 'navigate_to',
            page: 'price_alerts',
            params: {},
        }]);
    });

    test('explains navigation help without executing it and offers an explicit action', () => {
        const result = resolveAppCapabilityAnswer({
            query: 'How do I open price alerts?',
            contextPath: '/assistant',
        });

        expect(result.answer).toContain('signed-in price alerts');
        expect(result.actions).toEqual([]);
        expect(result.suggestedActions).toEqual([{
            type: 'navigate_to',
            page: 'price_alerts',
            params: {},
        }]);
    });

    test.each([
        'How to open price alerts?',
        'Can I open price alerts?',
        'What happens if I open price alerts?',
        'How can we open price alerts?',
    ])('does not auto-execute informational navigation phrasing: %s', (query) => {
        const result = resolveAppCapabilityAnswer({ query, contextPath: '/assistant' });

        expect(result.actions).toEqual([]);
        expect(result.suggestedActions).toEqual([
            expect.objectContaining({ type: 'navigate_to', page: 'price_alerts' }),
        ]);
    });

    test.each([
        'Please open price alerts',
        'Can you open price alerts?',
    ])('executes an explicit navigation request: %s', (query) => {
        const result = resolveAppCapabilityAnswer({ query, contextPath: '/assistant' });

        expect(result.actions).toEqual([
            expect.objectContaining({ type: 'navigate_to', page: 'price_alerts' }),
        ]);
        expect(result.suggestedActions).toEqual([]);
    });

    test('does not navigate to a dynamic route without its required id', () => {
        const result = resolveAppCapabilityAnswer({
            query: 'open seller profile',
            contextPath: '/assistant',
        });

        expect(result.capability).toMatchObject({ id: 'seller_profile' });
        expect(result.actions).toEqual([]);
        expect(result.answer).toContain('needs sellerId');
    });

    test('prefers an explicit feature over page context and ignores unrelated how-to questions', () => {
        const wishlist = resolveAppCapabilityAnswer({
            query: 'how do I use wishlist?',
            contextPath: '/product/101',
        });

        expect(wishlist.capability).toMatchObject({ id: 'wishlist' });
        expect(resolveAppCapabilityAnswer({
            query: 'how do I reset my password?',
            contextPath: '/product/101',
        })).toBeNull();
        expect(resolveAppCapabilityAnswer({
            query: 'how do I return a damaged item?',
            contextPath: '/product/101',
        })).toBeNull();
    });
});
