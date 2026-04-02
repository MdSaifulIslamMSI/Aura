const AppError = require('../utils/AppError');
const {
    getPaymentMarketCatalog,
    resolvePaymentMarketContext,
} = require('../services/payments/paymentMarketCatalog');
const { MARKET_RULES } = require('../services/markets/marketCatalog');

describe('Payment market catalog', () => {
    test('builds domestic and international rail coverage from capabilities', () => {
        const catalog = getPaymentMarketCatalog({
            capabilities: {
                rails: {
                    upi: { available: true },
                    card: { available: true },
                    wallet: { available: true },
                    netbanking: { available: true },
                },
            },
        });

        expect(catalog).toMatchObject({
            settlementCurrency: 'INR',
            railMatrix: {
                UPI: expect.objectContaining({ crossBorder: false }),
                CARD: expect.objectContaining({ crossBorder: true }),
            },
        });
        expect(catalog.railMatrix.CARD.currencies).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'USD' })])
        );
    });

    test('includes every configured market currency in the default card presentment matrix', () => {
        const catalog = getPaymentMarketCatalog({
            capabilities: {
                rails: {
                    card: { available: true },
                },
            },
        });

        const cardCurrencyCodes = catalog.railMatrix.CARD.currencies.map((entry) => entry.code);
        const configuredMarketCurrencies = Array.from(new Set(
            Object.values(MARKET_RULES)
                .map((rule) => rule?.currency)
                .filter(Boolean)
        ));

        expect(cardCurrencyCodes).toEqual(expect.arrayContaining(configuredMarketCurrencies));
    });

    test('rejects non-domestic use of domestic-only rails and allows international card markets', () => {
        const capabilities = {
            rails: {
                upi: { available: true },
                card: { available: true },
                wallet: { available: true },
                netbanking: { available: true },
            },
        };

        expect(() => resolvePaymentMarketContext({
            paymentMethod: 'UPI',
            paymentContext: {
                market: { countryCode: 'US', currency: 'USD' },
            },
            capabilities,
        })).toThrow(AppError);

        const cardMarket = resolvePaymentMarketContext({
            paymentMethod: 'CARD',
            paymentContext: {
                market: { countryCode: 'US', currency: 'USD' },
            },
            capabilities,
        });

        expect(cardMarket.market).toMatchObject({
            countryCode: 'US',
            currency: 'USD',
            settlementCurrency: 'INR',
            isInternational: true,
            settlementDiffersFromRequestedCurrency: true,
            crossBorder: true,
        });
    });

    test('allows card presentment for configured international market currencies', () => {
        const capabilities = {
            rails: {
                card: { available: true },
            },
        };

        expect(resolvePaymentMarketContext({
            paymentMethod: 'CARD',
            paymentContext: {
                market: { countryCode: 'BR', currency: 'BRL' },
            },
            capabilities,
        }).market.currency).toBe('BRL');

        expect(resolvePaymentMarketContext({
            paymentMethod: 'CARD',
            paymentContext: {
                market: { countryCode: 'MX', currency: 'MXN' },
            },
            capabilities,
        }).market.currency).toBe('MXN');

        expect(resolvePaymentMarketContext({
            paymentMethod: 'CARD',
            paymentContext: {
                market: { countryCode: 'CN', currency: 'CNY' },
            },
            capabilities,
        }).market.currency).toBe('CNY');
    });
});
