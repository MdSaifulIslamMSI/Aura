import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_STORAGE_KEY } from '@/config/marketConfig';

const {
    getBrowseFxRatesMock,
    readCachedBrowseFxRatesMock,
    translateTextsMock,
} = vi.hoisted(() => ({
    getBrowseFxRatesMock: vi.fn(),
    readCachedBrowseFxRatesMock: vi.fn(),
    translateTextsMock: vi.fn(async ({ texts = [], language }) => Object.fromEntries(
        texts.map((text) => [text, language === 'en' ? text : `${language}:${text}`])
    )),
}));

vi.mock('@/services/api/marketApi', () => ({
    marketApi: {
        getBrowseFxRates: getBrowseFxRatesMock,
    },
    readCachedBrowseFxRates: readCachedBrowseFxRatesMock,
}));

vi.mock('@/services/api', () => ({
    i18nApi: {
        translateTexts: translateTextsMock,
    },
}));

const createMarketProbe = (useMarket) => function MarketProbe() {
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

const createRuntimeFallbackProbe = (useMarket) => function RuntimeFallbackProbe() {
    const { setLanguage, t } = useMarket();

    return (
        <div>
            <button type="button" onClick={() => setLanguage('es')}>ES</button>
            <div data-testid="runtime-fallback">
                {t('checkout.runtimeAutoTranslationProbe', {}, 'Ready for translation')}
            </div>
        </div>
    );
};

const loadMarketTestKit = async () => {
    vi.resetModules();

    const [{ MarketProvider, useMarket }, marketRuntime] = await Promise.all([
        import('./MarketContext'),
        import('@/services/marketRuntime'),
    ]);

    return {
        MarketProvider,
        MarketProbe: createMarketProbe(useMarket),
        RuntimeFallbackProbe: createRuntimeFallbackProbe(useMarket),
        ...marketRuntime,
    };
};

beforeEach(() => {
    getBrowseFxRatesMock.mockReset();
    readCachedBrowseFxRatesMock.mockReset();
    translateTextsMock.mockClear();
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
});

describe('MarketContext', () => {
    it('formats catalog prices using the fetched browse currency rates', async () => {
        const { MarketProvider, MarketProbe } = await loadMarketTestKit();

        await act(async () => {
            render(
                <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                    <MarketProbe />
                </MarketProvider>
            );
        });

        expect(screen.getByTestId('market-country')).toHaveTextContent('IN');
        expect(screen.getByTestId('market-price').textContent).toMatch(/INR|Rs|\u20B9/);

        fireEvent.click(screen.getByRole('button', { name: 'USD' }));

        expect(screen.getByTestId('market-currency')).toHaveTextContent('USD');
        expect(screen.getByTestId('market-price').textContent).toContain('$20');
    });

    it('updates document direction when switching to an rtl language', async () => {
        const { MarketProvider, MarketProbe } = await loadMarketTestKit();

        await act(async () => {
            render(
                <MarketProvider initialPreference={{ countryCode: 'AE', language: 'en', currency: 'AED' }}>
                    <MarketProbe />
                </MarketProvider>
            );
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'AR' }));
        });

        expect(screen.getByTestId('market-language')).toHaveTextContent('ar');
        expect(document.documentElement.dir).toBe('rtl');
        expect(document.documentElement.lang).toContain('ar');
    });

    it('persists the selected market and syncs runtime request headers', async () => {
        const { MarketProvider, MarketProbe, getActiveMarketState, resetActiveMarketHeaders } = await loadMarketTestKit();

        await act(async () => {
            render(
                <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                    <MarketProbe />
                </MarketProvider>
            );
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

        resetActiveMarketHeaders();
    });

    it('runtime-translates missing keyed messages for non-English languages', async () => {
        const { MarketProvider, RuntimeFallbackProbe } = await loadMarketTestKit();

        await act(async () => {
            render(
                <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                    <RuntimeFallbackProbe />
                </MarketProvider>
            );
        });

        expect(screen.getByTestId('runtime-fallback')).toHaveTextContent('Ready for translation');

        fireEvent.click(screen.getByRole('button', { name: 'ES' }));

        await waitFor(() => {
            expect(screen.getByTestId('runtime-fallback')).toHaveTextContent('es:Ready for translation');
        });
    });
});
