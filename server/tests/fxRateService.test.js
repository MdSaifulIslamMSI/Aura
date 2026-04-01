describe('FX rate service', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetModules();
        process.env.PAYMENT_FX_RATES_TTL_MS = '60000';
    });

    afterEach(() => {
        global.fetch = originalFetch;
        delete process.env.PAYMENT_FX_RATES_TTL_MS;
        delete process.env.PAYMENT_FX_PROVIDER;
        delete process.env.OPEN_EXCHANGE_RATES_APP_ID;
    });

    test('getFxRates uses Open Exchange Rates when configured', async () => {
        process.env.PAYMENT_FX_PROVIDER = 'openexchangerates';
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'test-app-id';
        delete process.env.PAYMENT_FX_RATES_TTL_MS;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                timestamp: 1775030400,
                base: 'USD',
                rates: {
                    EUR: 0.86,
                    INR: 93.43,
                    GBP: 0.75,
                    AED: 3.6725,
                },
            }),
        });

        const { getFxRates } = require('../services/payments/fxRateService');
        const rates = await getFxRates();

        expect(rates.provider).toBe('openexchangerates');
        expect(rates.referenceBaseCurrency).toBe('USD');
        expect(rates.rates.USD).toBe(1);
        expect(rates.rates.INR).toBe(93.43);
        expect(rates.rates.AED).toBe(3.6725);
        expect(rates.cacheTtlMs).toBe(60 * 60 * 1000);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('getFxRates falls back to ECB when the real-time provider fails', async () => {
        process.env.PAYMENT_FX_PROVIDER = 'openexchangerates';
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'test-app-id';
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => '{"error":true}',
            })
            .mockResolvedValueOnce({
                ok: true,
                text: async () => `
                    <gesmes:Envelope>
                        <Cube>
                            <Cube time="2026-03-27">
                                <Cube currency="USD" rate="1.1000"/>
                                <Cube currency="INR" rate="90.0000"/>
                            </Cube>
                        </Cube>
                    </gesmes:Envelope>
                `,
            });

        const { getFxRates } = require('../services/payments/fxRateService');
        const rates = await getFxRates();

        expect(rates.provider).toBe('ecb');
        expect(rates.referenceBaseCurrency).toBe('EUR');
        expect(rates.rates.USD).toBe(1.1);
        expect(rates.rates.INR).toBe(90);
        expect(rates.asOfDate).toBe('2026-03-27');
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('getFxQuote converts currencies using the live ECB reference feed', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => `
                <gesmes:Envelope>
                    <Cube>
                        <Cube time="2026-03-27">
                            <Cube currency="USD" rate="1.1000"/>
                            <Cube currency="INR" rate="90.0000"/>
                        </Cube>
                    </Cube>
                </gesmes:Envelope>
            `,
        });

        const { getFxQuote } = require('../services/payments/fxRateService');
        const quote = await getFxQuote({
            baseCurrency: 'INR',
            targetCurrency: 'USD',
            amount: 900,
        });

        expect(quote.amount).toBe(11);
        expect(quote.baseCurrency).toBe('INR');
        expect(quote.targetCurrency).toBe('USD');
        expect(quote.asOfDate).toBe('2026-03-27');
        expect(quote.stale).toBe(false);
    });

    test('getFxQuote returns an identity quote when the currencies match', async () => {
        const { getFxQuote } = require('../services/payments/fxRateService');
        const quote = await getFxQuote({
            baseCurrency: 'USD',
            targetCurrency: 'USD',
            amount: 42.5,
        });

        expect(quote).toMatchObject({
            source: 'identity',
            rate: 1,
            amount: 42.5,
            stale: false,
        });
    });

    test('getFxQuote derives AED from the ECB USD rate when AED is not published directly', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => `
                <gesmes:Envelope>
                    <Cube>
                        <Cube time="2026-03-27">
                            <Cube currency="USD" rate="1.1000"/>
                            <Cube currency="INR" rate="90.0000"/>
                        </Cube>
                    </Cube>
                </gesmes:Envelope>
            `,
        });

        const { getFxQuote } = require('../services/payments/fxRateService');
        const quote = await getFxQuote({
            baseCurrency: 'INR',
            targetCurrency: 'AED',
            amount: 900,
        });

        expect(quote.baseCurrency).toBe('INR');
        expect(quote.targetCurrency).toBe('AED');
        expect(quote.rate).toBeCloseTo(0.0448861111111, 12);
        expect(quote.amount).toBe(40.4);
        expect(quote.asOfDate).toBe('2026-03-27');
        expect(quote.stale).toBe(false);
    });

    test('getFxRates falls back to cached data and marks it stale on refresh failures', async () => {
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                text: async () => `
                    <gesmes:Envelope>
                        <Cube>
                            <Cube time="2026-03-27">
                                <Cube currency="USD" rate="1.1000"/>
                                <Cube currency="INR" rate="90.0000"/>
                            </Cube>
                        </Cube>
                    </gesmes:Envelope>
                `,
            })
            .mockRejectedValueOnce(new Error('network down'));

        const { getFxRates } = require('../services/payments/fxRateService');
        const first = await getFxRates();
        const second = await getFxRates({ forceRefresh: true });

        expect(first.stale).toBeUndefined();
        expect(second.stale).toBe(true);
        expect(second.staleReason).toMatch(/network down/i);
        expect(second.asOfDate).toBe('2026-03-27');
    });
});
