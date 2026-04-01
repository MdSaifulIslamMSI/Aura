describe('market browse FX service', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('builds browse FX rates relative to the configured base currency and skips unavailable targets', async () => {
        let getBrowseFxPayload;

        jest.isolateModules(() => {
            jest.doMock('../services/payments/fxRateService', () => ({
                getFxRates: jest.fn().mockResolvedValue({
                    source: 'ecb_reference_rates',
                    provider: 'ecb',
                    referenceBaseCurrency: 'EUR',
                    cacheTtlMs: 60000,
                    fetchedAt: '2026-03-27T10:00:00.000Z',
                    asOfDate: '2026-03-27',
                    rates: {
                        EUR: 1,
                        INR: 90,
                        USD: 1.08,
                        JPY: 162,
                    },
                }),
            }));

            ({ getBrowseFxPayload } = require('../services/markets/marketFxService'));
        });

        const payload = await getBrowseFxPayload({
            baseCurrency: 'INR',
            currencies: ['INR', 'USD', 'JPY', 'AED'],
        });

        expect(payload.baseCurrency).toBe('INR');
        expect(payload.rates.INR).toBe(1);
        expect(payload.rates.USD).toBe(0.012);
        expect(payload.rates.JPY).toBe(1.8);
        expect(payload.rates.AED).toBeUndefined();
        expect(payload.unavailableCurrencies).toEqual(['AED']);
        expect(payload.cacheTtlMs).toBe(60000);
        expect(payload.source).toBe('ecb_reference_rates');
        expect(payload.provider).toBe('ecb');
        expect(payload.asOfDate).toBe('2026-03-27');
        expect(payload.stale).toBe(false);
    });
});
