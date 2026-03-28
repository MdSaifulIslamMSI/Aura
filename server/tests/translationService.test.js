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

    test('keeps cache entries isolated by source language', async () => {
        fetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => [[['Oferta', 'Deal', null, null, 10]], null, 'en'],
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => [[['Accord', 'Deal', null, null, 10]], null, 'en'],
            });

        const spanishSourceResult = await translateTexts({
            texts: ['Deal'],
            targetLanguage: 'fr',
            sourceLanguage: 'es',
        });

        const englishSourceResult = await translateTexts({
            texts: ['Deal'],
            targetLanguage: 'fr',
            sourceLanguage: 'en',
        });

        expect(spanishSourceResult.Deal).toBe('Oferta');
        expect(englishSourceResult.Deal).toBe('Accord');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('deduplicates identical concurrent translations across inflight requests', async () => {
        let resolveFetch;
        fetch.mockImplementation(() => new Promise((resolve) => {
            resolveFetch = resolve;
        }));

        const firstRequest = translateTexts({
            texts: ['Add to cart'],
            targetLanguage: 'es',
        });
        const secondRequest = translateTexts({
            texts: ['Add to cart'],
            targetLanguage: 'es',
        });

        expect(fetch).toHaveBeenCalledTimes(1);

        resolveFetch({
            ok: true,
            json: async () => [[['Agregar al carrito', 'Add to cart', null, null, 10]], null, 'en'],
        });

        const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);

        expect(firstResult['Add to cart']).toBe('Agregar al carrito');
        expect(secondResult['Add to cart']).toBe('Agregar al carrito');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('short-circuits when source and target languages already match', async () => {
        const result = await translateTexts({
            texts: ['Pedidos'],
            targetLanguage: 'es',
            sourceLanguage: 'es',
        });

        expect(result.Pedidos).toBe('Pedidos');
        expect(fetch).not.toHaveBeenCalled();
    });
});
