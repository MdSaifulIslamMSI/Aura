describe('FX rate service', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetModules();
        process.env.PAYMENT_FX_RATES_TTL_MS = '60000';
    });

    afterEach(() => {
        global.fetch = originalFetch;
        delete process.env.PAYMENT_FX_RATES_TTL_MS;
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
