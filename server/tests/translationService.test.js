jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const logger = require('../utils/logger');
const {
    clearTranslationCache,
    translateTexts,
} = require('../services/i18n/translationService');

const originalEnv = { ...process.env };

const configureLibreTranslate = (overrides = {}) => {
    process.env = {
        ...originalEnv,
        NODE_ENV: 'test',
        I18N_RUNTIME_TRANSLATION_ENABLED: 'true',
        I18N_TRANSLATION_PROVIDER: 'libretranslate',
        LIBRETRANSLATE_BASE_URL: 'http://localhost:5000',
        ...overrides,
    };
    clearTranslationCache();
};

describe('translationService', () => {
    beforeEach(() => {
        configureLibreTranslate();
        fetch.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    afterAll(() => {
        process.env = { ...originalEnv };
        clearTranslationCache();
    });

    test('translates unique texts and reuses the cache for repeat lookups', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ translatedText: 'Agregar al carrito' }),
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

    test('falls back to the source text when provider translation fails without logging raw text', async () => {
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        fetch.mockRejectedValue(new Error('provider down'));

        const result = await translateTexts({
            texts: ['Private support message'],
            targetLanguage: 'fr',
        });

        expect(result['Private support message']).toBe('Private support message');
        expect(warnSpy).toHaveBeenCalledWith('i18n.translation_provider_failed', expect.objectContaining({
            provider: 'libretranslate',
            textHash: expect.any(String),
        }));
        expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('Private support message');
        warnSpy.mockRestore();
    });

    test('keeps cache entries isolated by source language', async () => {
        fetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ translatedText: 'Oferta' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ translatedText: 'Accord' }),
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
            json: async () => ({ translatedText: 'Agregar al carrito' }),
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

    test('short-circuits unsupported target locales to the safe English fallback', async () => {
        const result = await translateTexts({
            texts: ['Checkout'],
            targetLanguage: 'zz-unknown',
        });

        expect(result.Checkout).toBe('Checkout');
        expect(fetch).not.toHaveBeenCalled();
    });

    test('bounds oversized translation batches before provider calls', async () => {
        configureLibreTranslate({
            I18N_TRANSLATION_MAX_BATCH_SIZE: '2',
        });
        fetch.mockImplementation(async (_url, options) => ({
            ok: true,
            json: async () => ({ translatedText: `${JSON.parse(options.body).q} translated` }),
        }));

        const result = await translateTexts({
            texts: ['One', 'Two', 'Three'],
            targetLanguage: 'es',
        });

        expect(result).toEqual({
            One: 'One translated',
            Two: 'Two translated',
        });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('falls back when the provider times out', async () => {
        jest.useFakeTimers();
        configureLibreTranslate({
            I18N_TRANSLATION_PROVIDER_TIMEOUT_MS: '500',
        });
        fetch.mockImplementation((_url, options = {}) => new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
                reject(new Error('provider timeout'));
            });
        }));

        const resultPromise = translateTexts({
            texts: ['Pay securely'],
            targetLanguage: 'es',
        });

        await jest.advanceTimersByTimeAsync(500);
        await expect(resultPromise).resolves.toEqual({
            'Pay securely': 'Pay securely',
        });
        jest.useRealTimers();
    });

    test('keeps concurrent provider work bounded', async () => {
        const pending = [];
        let activeRequests = 0;
        let maxActiveRequests = 0;
        fetch.mockImplementation((_url, options) => {
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            return new Promise((resolve) => {
                pending.push(() => {
                    activeRequests -= 1;
                    resolve({
                        ok: true,
                        json: async () => ({ translatedText: JSON.parse(options.body).q }),
                    });
                });
            });
        });

        const resultPromise = translateTexts({
            texts: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
            targetLanguage: 'es',
        });

        while (pending.length < 4) {
            await Promise.resolve();
        }
        expect(maxActiveRequests).toBeLessThanOrEqual(4);
        for (let releasedRequests = 0; releasedRequests < 6; releasedRequests += 1) {
            while (pending.length === 0) {
                await Promise.resolve();
            }
            pending.shift()();
            await Promise.resolve();
        }

        await expect(resultPromise).resolves.toMatchObject({
            One: 'One',
            Six: 'Six',
        });
        expect(maxActiveRequests).toBeLessThanOrEqual(4);
    });

    test('redacts PII before provider calls and restores it after translation', async () => {
        fetch.mockImplementation(async (_url, options) => ({
            ok: true,
            json: async () => ({ translatedText: JSON.parse(options.body).q }),
        }));

        const result = await translateTexts({
            texts: ['Email me at buyer@example.com'],
            targetLanguage: 'es',
        });

        const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
        expect(requestBody.q).not.toContain('buyer@example.com');
        expect(requestBody.q).toContain('<EMAIL_1>');
        expect(result['Email me at buyer@example.com']).toBe('Email me at buyer@example.com');
    });

    test('production defaults to the no-op provider even when a live provider is requested', async () => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'production',
            I18N_TRANSLATION_PROVIDER: 'libretranslate',
        };
        clearTranslationCache();

        const result = await translateTexts({
            texts: ['Orders'],
            targetLanguage: 'fr',
        });

        expect(result.Orders).toBe('Orders');
        expect(fetch).not.toHaveBeenCalled();
    });
});
