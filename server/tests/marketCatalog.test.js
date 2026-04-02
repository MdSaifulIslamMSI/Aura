const { resolveMarketContext } = require('../services/markets/marketCatalog');

describe('market catalog', () => {
    test('falls back unsupported requested currencies to the market default currency', () => {
        const market = resolveMarketContext({
            country: 'US',
            currency: 'MXN',
            language: 'en',
        });

        expect(market).toMatchObject({
            countryCode: 'US',
            currency: 'USD',
            defaultCurrency: 'USD',
            language: 'en',
            fallbackBehavior: {
                currencyFallbackApplied: true,
                languageFallbackApplied: false,
            },
        });
    });

    test('preserves supported requested currencies for markets that explicitly allow them', () => {
        const market = resolveMarketContext({
            country: 'JP',
            currency: 'JPY',
            language: 'ja',
        });

        expect(market).toMatchObject({
            countryCode: 'JP',
            currency: 'JPY',
            defaultCurrency: 'JPY',
            language: 'ja',
            fallbackBehavior: {
                currencyFallbackApplied: false,
                languageFallbackApplied: false,
            },
        });
    });
});
