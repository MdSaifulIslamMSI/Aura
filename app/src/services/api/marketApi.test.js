import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMarketApiCache, marketApi, readCachedBrowseFxRates } from './marketApi';

const { apiFetchMock } = vi.hoisted(() => ({
    apiFetchMock: vi.fn(),
}));

vi.mock('../apiBase', () => ({
    apiFetch: apiFetchMock,
}));

describe('marketApi', () => {
    beforeEach(() => {
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

        const third = await marketApi.getBrowseFxRates({ baseCurrency: 'INR' });
        expect(third.rates.USD).toBe(0.02);
        expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });
});
