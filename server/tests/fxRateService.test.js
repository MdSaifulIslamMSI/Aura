const createSnapshotModelMock = () => {
    let document = null;

    const clone = (value) => (value ? JSON.parse(JSON.stringify(value)) : value);
    const mergeDoc = (update = {}) => {
        document = {
            key: 'global',
            ...(document || {}),
            ...clone(update),
            updatedAt: new Date().toISOString(),
            createdAt: document?.createdAt || new Date().toISOString(),
        };
        return clone(document);
    };

    return {
        findOne: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue(clone(document)),
        })),
        findOneAndUpdate: jest.fn(async (_query, update = {}) => {
            const nextDoc = mergeDoc({
                ...(update?.$setOnInsert || {}),
                ...(update?.$set || {}),
            });
            return nextDoc;
        }),
        getDocument: () => clone(document),
        setDocument: (value) => {
            document = clone(value);
        },
    };
};

describe('FX rate service', () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...originalEnv,
            PAYMENT_FX_PROVIDER: 'auto',
            PAYMENT_FX_RATES_TTL_MS: '60000',
            PAYMENT_FX_REFRESH_RETRY_ATTEMPTS: '3',
            PAYMENT_FX_MAX_CALLS_PER_DAY: '24',
        };
    });

    afterEach(() => {
        global.fetch = originalFetch;
        process.env = { ...originalEnv };
    });

    test('refreshFxRates uses Open Exchange Rates when configured and persists the snapshot', async () => {
        const snapshotModelMock = createSnapshotModelMock();
        process.env.PAYMENT_FX_PROVIDER = 'openexchangerates';
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'test-app-id';
        delete process.env.PAYMENT_FX_RATES_TTL_MS;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                timestamp: Math.floor(Date.now() / 1000),
                base: 'USD',
                rates: {
                    EUR: 0.86,
                    INR: 93.43,
                    GBP: 0.75,
                    AED: 3.6725,
                },
            }),
        });

        jest.doMock('../models/FxRateSnapshot', () => snapshotModelMock);

        const { refreshFxRates, getFxRates } = require('../services/payments/fxRateService');
        const refreshed = await refreshFxRates({ trigger: 'test' });
        const cached = await getFxRates();

        expect(refreshed.provider).toBe('openexchangerates');
        expect(refreshed.referenceBaseCurrency).toBe('USD');
        expect(refreshed.rates.INR).toBe(93.43);
        expect(refreshed.stale).toBe(false);
        expect(cached.provider).toBe('openexchangerates');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(snapshotModelMock.getDocument().provider).toBe('openexchangerates');
    });

    test('refreshFxRates falls back to ECB when the primary provider fails', async () => {
        const snapshotModelMock = createSnapshotModelMock();
        process.env.PAYMENT_FX_PROVIDER = 'openexchangerates';
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'test-app-id';

        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => '{"error":true}',
                headers: { get: () => null },
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

        jest.doMock('../models/FxRateSnapshot', () => snapshotModelMock);

        const { refreshFxRates } = require('../services/payments/fxRateService');
        const rates = await refreshFxRates({ trigger: 'test' });

        expect(rates.provider).toBe('ecb');
        expect(rates.referenceBaseCurrency).toBe('EUR');
        expect(rates.rates.USD).toBe(1.1);
        expect(rates.rates.INR).toBe(90);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('getFxQuote converts currencies from the cached snapshot without a new API call', async () => {
        const snapshotModelMock = createSnapshotModelMock();
        process.env.PAYMENT_FX_PROVIDER = 'ecb';

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

        jest.doMock('../models/FxRateSnapshot', () => snapshotModelMock);

        const { refreshFxRates, getFxQuote } = require('../services/payments/fxRateService');
        await refreshFxRates({ trigger: 'test' });
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
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('getFxQuote derives AED from the cached ECB USD rate', async () => {
        const snapshotModelMock = createSnapshotModelMock();
        process.env.PAYMENT_FX_PROVIDER = 'ecb';

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

        jest.doMock('../models/FxRateSnapshot', () => snapshotModelMock);

        const { refreshFxRates, getFxQuote } = require('../services/payments/fxRateService');
        await refreshFxRates({ trigger: 'test' });
        const quote = await getFxQuote({
            baseCurrency: 'INR',
            targetCurrency: 'AED',
            amount: 900,
        });

        expect(quote.rate).toBeCloseTo(0.0448861111111, 12);
        expect(quote.amount).toBe(40.4);
        expect(quote.stale).toBe(false);
    });

    test('refreshFxRates retries 3 times and falls back to the last successful snapshot', async () => {
        const snapshotModelMock = createSnapshotModelMock();
        process.env.PAYMENT_FX_PROVIDER = 'ecb';
        snapshotModelMock.setDocument({
            key: 'global',
            provider: 'ecb',
            source: 'ecb_reference_rates',
            referenceBaseCurrency: 'EUR',
            asOfDate: '2026-03-27',
            fetchedAt: '2026-03-27T10:00:00.000Z',
            expiresAt: '2026-03-27T11:00:00.000Z',
            cacheTtlMs: 60000,
            rates: {
                EUR: 1,
                USD: 1.1,
                INR: 90,
            },
            lastSuccessfulRefreshAt: '2026-03-27T10:00:00.000Z',
        });

        global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

        jest.doMock('../models/FxRateSnapshot', () => snapshotModelMock);

        const { refreshFxRates } = require('../services/payments/fxRateService');
        const rates = await refreshFxRates({
            force: true,
            trigger: 'test',
        });

        expect(rates.stale).toBe(true);
        expect(rates.staleReason).toMatch(/network down/i);
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('refreshFxRates skips Open Exchange Rates when the daily quota is exhausted', async () => {
        const snapshotModelMock = createSnapshotModelMock();
        process.env.PAYMENT_FX_PROVIDER = 'openexchangerates';
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'test-app-id';
        process.env.PAYMENT_FX_MAX_CALLS_PER_DAY = '1';
        snapshotModelMock.setDocument({
            key: 'global',
            providerUsage: {
                openexchangerates: {
                    windowDate: new Date().toISOString().slice(0, 10),
                    callCount: 1,
                    dailyLimit: 1,
                },
            },
        });

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

        jest.doMock('../models/FxRateSnapshot', () => snapshotModelMock);

        const { refreshFxRates } = require('../services/payments/fxRateService');
        const rates = await refreshFxRates({
            force: true,
            trigger: 'test',
        });

        expect(rates.provider).toBe('ecb');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
