describe('market browse FX service', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('builds browse FX rates relative to the configured base currency', async () => {
        let getBrowseFxPayload;

        jest.isolateModules(() => {
            jest.doMock('../services/payments/fxRateService', () => ({
                getFxRates: jest.fn().mockResolvedValue({
                    source: 'ecb_reference_rates',
                    provider: 'ecb',
                    referenceBaseCurrency: 'EUR',
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
            currencies: ['INR', 'USD', 'JPY'],
        });

        expect(payload).toMatchObject({
            baseCurrency: 'INR',
            rates: {
                INR: 1,
                USD: 0.012,
                JPY: 1.8,
            },
            source: 'ecb_reference_rates',
            provider: 'ecb',
            asOfDate: '2026-03-27',
            stale: false,
        });
    });
});
