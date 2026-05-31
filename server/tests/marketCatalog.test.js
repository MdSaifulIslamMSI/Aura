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

    test('preserves Bengali language selection for the India market', () => {
        const market = resolveMarketContext({
            country: 'IN',
            currency: 'INR',
            language: 'bn',
        });

        expect(market).toMatchObject({
            countryCode: 'IN',
            currency: 'INR',
            language: 'bn',
            languageLabel: 'Bengali',
            locale: 'bn-IN',
            direction: 'ltr',
            fallbackBehavior: {
                currencyFallbackApplied: false,
                languageFallbackApplied: false,
            },
        });
    });
});
