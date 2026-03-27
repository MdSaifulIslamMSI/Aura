describe('market pricing service', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('locks display pricing from live FX quotes', async () => {
        let buildLockedPrice;

        jest.isolateModules(() => {
            jest.doMock('../services/payments/fxRateService', () => ({
                getFxQuote: jest.fn().mockResolvedValue({
                    rate: 0.0125,
                    amount: 12.5,
                    quotedAt: '2026-03-27T10:00:00.000Z',
                    provider: 'fx-feed',
                    source: 'unit-test',
                }),
            }));

            ({ buildLockedPrice } = require('../services/markets/marketPricing'));
        });

        const result = await buildLockedPrice({
            baseAmount: 1000,
            baseCurrency: 'INR',
            market: {
                countryCode: 'US',
                currency: 'USD',
                locale: 'en-US',
            },
        });

        expect(result).toMatchObject({
            baseAmount: 1000,
            baseCurrency: 'INR',
            displayAmount: 12.5,
            displayCurrency: 'USD',
            fxRateLocked: 0.0125,
            fxTimestamp: '2026-03-27T10:00:00.000Z',
            fallbackApplied: false,
        });
        expect(result.formattedPrice).toMatch(/\$12\.50/);
    });

    test('falls back to base currency when FX lookup fails', async () => {
        let buildLockedPrice;

        jest.isolateModules(() => {
            jest.doMock('../services/payments/fxRateService', () => ({
                getFxQuote: jest.fn().mockRejectedValue(new Error('feed unavailable')),
            }));

            ({ buildLockedPrice } = require('../services/markets/marketPricing'));
        });

        const result = await buildLockedPrice({
            baseAmount: 2500,
            baseCurrency: 'INR',
            market: {
                countryCode: 'US',
                currency: 'USD',
                locale: 'en-US',
            },
        });

        expect(result).toMatchObject({
            baseAmount: 2500,
            baseCurrency: 'INR',
            displayAmount: 2500,
            displayCurrency: 'INR',
            fxRateLocked: 1,
            fallbackApplied: true,
            fallbackMessage: 'Final price will be calculated at checkout',
        });
    });
});
