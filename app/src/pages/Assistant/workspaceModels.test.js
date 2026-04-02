import {
    createWelcomeMessage,
    deriveOriginContext,
    extractCandidateProductIds,
} from './workspaceModels';

describe('assistant workspace models', () => {
    it('derives grounded launch context from product routes', () => {
        expect(deriveOriginContext('/product/sku-101?ref=home')).toEqual({
            path: '/product/sku-101?ref=home',
            label: 'Product detail',
            entityType: 'product',
            entityId: 'sku-101',
        });
    });

    it('extracts unique candidate products from cards and origin state', () => {
        expect(extractCandidateProductIds([
            {
                cards: [
                    {
                        type: 'product',
                        product: { id: 'p-2' },
                    },
                    {
                        type: 'comparison',
                        products: [{ id: 'p-3' }, { id: 'p-2' }],
                    },
                ],
            },
        ], 'p-1')).toEqual(['p-1', 'p-2', 'p-3']);
    });

    it('creates a welcome message tied to the launch context', () => {
        expect(createWelcomeMessage({
            label: 'Cart',
        }).text).toContain('You launched from Cart.');
    });
});
