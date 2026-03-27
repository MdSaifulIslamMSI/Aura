jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const {
    clearTranslationCache,
    translateTexts,
} = require('../services/i18n/translationService');

describe('translationService', () => {
    beforeEach(() => {
        clearTranslationCache();
        fetch.mockReset();
    });

    test('translates unique texts and reuses the cache for repeat lookups', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => [[['Agregar al carrito', 'Add to cart', null, null, 10]], null, 'en'],
        });

        const first = await translateTexts({
            texts: ['Add to cart', 'Add to cart'],
            targetLanguage: 'es',
        });

        expect(first['Add to cart']).toBe('Agregar al carrito');
        expect(fetch).toHaveBeenCalledTimes(1);

        const second = await translateTexts({
            texts: ['Add to cart'],
            targetLanguage: 'es',
        });

        expect(second['Add to cart']).toBe('Agregar al carrito');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('falls back to the source text when upstream translation fails', async () => {
        fetch.mockRejectedValue(new Error('upstream down'));

        const result = await translateTexts({
            texts: ['Orders'],
            targetLanguage: 'fr',
        });

        expect(result.Orders).toBe('Orders');
    });
});
