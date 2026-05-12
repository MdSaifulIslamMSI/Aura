const {
    buildKnowledgeAnswerText,
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
});
