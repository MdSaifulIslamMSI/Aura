import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({
    apiFetchMock: vi.fn(),
}));

let clearMarketApiCache;
let marketApi;
let readCachedBrowseFxRates;

describe('marketApi', () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.useRealTimers();
        vi.doMock('../apiBase', () => ({
            apiFetch: apiFetchMock,
        }));
        ({
            clearMarketApiCache,
            marketApi,
            readCachedBrowseFxRates,
        } = await import('./marketApi'));

        clearMarketApiCache();
        window.sessionStorage.clear();
        apiFetchMock.mockReset();
    });

    it('dedupes overlapping FX requests and caches the result', async () => {
        apiFetchMock.mockResolvedValue({
            data: {
                baseCurrency: 'INR',
                rates: {
                    INR: 1,
                    USD: 0.02,
                },
                source: 'unit-test',
                provider: 'unit-test',
                fetchedAt: '2026-03-27T10:00:00.000Z',
                asOfDate: '2026-03-27',
                cacheTtlMs: 60000,
                stale: false,
                staleReason: '',
            },
        });

        const [first, second] = await Promise.all([
            marketApi.getBrowseFxRates({ baseCurrency: 'INR' }),
            marketApi.getBrowseFxRates({ baseCurrency: 'INR' }),
        ]);

        expect(first.rates.USD).toBe(0.02);
        expect(second.rates.USD).toBe(0.02);
        expect(apiFetchMock).toHaveBeenCalledTimes(1);

        const cached = readCachedBrowseFxRates('INR');
        expect(cached?.rates?.USD).toBe(0.02);
        expect(cached?.cacheTtlMs).toBe(60000);

        const third = await marketApi.getBrowseFxRates({ baseCurrency: 'INR' });
        expect(third.rates.USD).toBe(0.02);
        expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });

    it('respects the server-provided FX cache ttl before refetching', async () => {
        vi.useFakeTimers();
        const baseNow = new Date('2026-04-01T10:00:00.000Z');
        vi.setSystemTime(baseNow);

        apiFetchMock
            .mockResolvedValueOnce({
                data: {
                    baseCurrency: 'INR',
                    rates: {
                        INR: 1,
                        USD: 0.02,
                    },
                    source: 'unit-test',
                    provider: 'unit-test',
                    fetchedAt: '2026-04-01T10:00:00.000Z',
                    asOfDate: '2026-04-01',
                    cacheTtlMs: 1000,
                    stale: false,
                    staleReason: '',
                },
            })
            .mockResolvedValueOnce({
                data: {
                    baseCurrency: 'INR',
                    rates: {
                        INR: 1,
                        USD: 0.03,
                    },
                    source: 'unit-test',
                    provider: 'unit-test',
                    fetchedAt: '2026-04-01T10:00:02.000Z',
                    asOfDate: '2026-04-01',
                    cacheTtlMs: 1000,
                    stale: false,
                    staleReason: '',
                },
            });

        const first = await marketApi.getBrowseFxRates({ baseCurrency: 'INR' });
        expect(first.rates.USD).toBe(0.02);

        vi.advanceTimersByTime(900);
        const cached = await marketApi.getBrowseFxRates({ baseCurrency: 'INR' });
        expect(cached.rates.USD).toBe(0.02);
        expect(apiFetchMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(200);
        const refreshed = await marketApi.getBrowseFxRates({ baseCurrency: 'INR' });
        expect(refreshed.rates.USD).toBe(0.03);
        expect(apiFetchMock).toHaveBeenCalledTimes(2);
    });
});
