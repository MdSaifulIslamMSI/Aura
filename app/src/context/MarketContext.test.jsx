import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_STORAGE_KEY } from '@/config/marketConfig';
import { getActiveMarketState, resetActiveMarketHeaders } from '@/services/marketRuntime';
import { MarketProvider, useMarket } from './MarketContext';

const { getBrowseFxRatesMock, readCachedBrowseFxRatesMock } = vi.hoisted(() => ({
    getBrowseFxRatesMock: vi.fn(),
    readCachedBrowseFxRatesMock: vi.fn(),
}));

vi.mock('@/services/api/marketApi', () => ({
    marketApi: {
        getBrowseFxRates: getBrowseFxRatesMock,
    },
    readCachedBrowseFxRates: readCachedBrowseFxRatesMock,
}));

const MarketProbe = () => {
    const {
        countryCode,
        currency,
        language,
        formatPrice,
        setCurrency,
        setLanguage,
    } = useMarket();

    return (
        <div>
            <div data-testid="market-country">{countryCode}</div>
            <div data-testid="market-currency">{currency}</div>
            <div data-testid="market-language">{language}</div>
            <div data-testid="market-price">{formatPrice(1000)}</div>
            <button type="button" onClick={() => setCurrency('USD')}>USD</button>
            <button type="button" onClick={() => setLanguage('ar')}>AR</button>
        </div>
    );
};

beforeEach(() => {
    getBrowseFxRatesMock.mockReset();
    readCachedBrowseFxRatesMock.mockReset();
    readCachedBrowseFxRatesMock.mockReturnValue(null);
    getBrowseFxRatesMock.mockResolvedValue({
        baseCurrency: 'INR',
        rates: {
            INR: 1,
            USD: 0.02,
            AED: 0.08,
        },
        source: 'unit-test',
        provider: 'unit-test',
        fetchedAt: '2026-03-27T10:00:00.000Z',
        asOfDate: '2026-03-27',
        stale: false,
        staleReason: '',
    });
});

afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
    resetActiveMarketHeaders();
});

describe('MarketContext', () => {
    it('formats catalog prices using the fetched browse currency rates', async () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <MarketProbe />
            </MarketProvider>
        );

        expect(screen.getByTestId('market-country')).toHaveTextContent('IN');
        expect(screen.getByTestId('market-price').textContent).toMatch(/INR|Rs|₹/);

        await waitFor(() => {
            expect(getBrowseFxRatesMock).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: 'USD' }));

        expect(screen.getByTestId('market-currency')).toHaveTextContent('USD');
        expect(screen.getByTestId('market-price').textContent).toContain('$20');
    });

    it('updates document direction when switching to an rtl language', async () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'AE', language: 'en', currency: 'AED' }}>
                <MarketProbe />
            </MarketProvider>
        );

        await waitFor(() => {
            expect(getBrowseFxRatesMock).toHaveBeenCalledTimes(1);
        });

        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'AR' }));
        });

        expect(screen.getByTestId('market-language')).toHaveTextContent('ar');
        expect(document.documentElement.dir).toBe('rtl');
        expect(document.documentElement.lang).toContain('ar');
    });

    it('persists the selected market and syncs runtime request headers', async () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <MarketProbe />
            </MarketProvider>
        );

        await waitFor(() => {
            expect(getBrowseFxRatesMock).toHaveBeenCalledTimes(1);
        });

        expect(getActiveMarketState()).toMatchObject({
            country: 'IN',
            currency: 'INR',
            language: 'en',
        });

        fireEvent.click(screen.getByRole('button', { name: 'USD' }));

        expect(getActiveMarketState()).toMatchObject({
            country: 'IN',
            currency: 'USD',
            language: 'en',
        });

        expect(JSON.parse(window.localStorage.getItem(MARKET_STORAGE_KEY))).toMatchObject({
            countryCode: 'IN',
            currency: 'USD',
            language: 'en',
        });
    });
});
