import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_STORAGE_KEY } from '@/config/marketConfig';
import { clearRuntimeTranslationCache } from '@/services/runtimeTranslation';

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

vi.mock('@/services/api/i18nApi', () => ({
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

const createStaticFormatProbe = (formatPrice) => function StaticFormatProbe() {
    return <div data-testid="static-market-price">{formatPrice(1000)}</div>;
};

const createDynamicTemplateProbe = (useMarket) => function DynamicTemplateProbe() {
    const { setLanguage, t } = useMarket();

    return (
        <div>
            <button type="button" onClick={() => setLanguage('es')}>ES</button>
            <div data-testid="runtime-dynamic-template">
                {t('runtime.dynamicFallbackProbe', { time: '12:00' }, 'Checked {{time}}')}
            </div>
            <div data-testid="runtime-ad-hoc-fallback">
                {t('runtime.adHocLabel', { time: '12:00' }, 'Checked 12:00')}
            </div>
        </div>
    );
};

const createLateArrivalProbe = (useMarket) => function LateArrivalProbe() {
    const { setLanguage, t } = useMarket();
    const [showLateFallback, setShowLateFallback] = useState(false);

    return (
        <div>
            <button type="button" onClick={() => setLanguage('es')}>ES</button>
            <button type="button" onClick={() => setShowLateFallback(true)}>SHOW</button>
            {showLateFallback ? (
                <div data-testid="runtime-late-fallback">
                    {t('runtime.lateArrivalProbe', {}, 'Late arrival')}
                </div>
            ) : null}
        </div>
    );
};

const loadMarketTestKit = async () => {
    vi.resetModules();

    const [{ MarketProvider, useMarket }, marketRuntime] = await Promise.all([
        import('./MarketContext'),
        import('@/services/marketRuntime'),
    ]);
    const { formatPrice } = await import('@/utils/format');

    return {
        MarketProvider,
        MarketProbe: createMarketProbe(useMarket),
        StaticFormatProbe: createStaticFormatProbe(formatPrice),
        RuntimeFallbackProbe: createRuntimeFallbackProbe(useMarket),
        DynamicTemplateProbe: createDynamicTemplateProbe(useMarket),
        LateArrivalProbe: createLateArrivalProbe(useMarket),
        ...marketRuntime,
    };
};

beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearRuntimeTranslationCache();
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
        await waitFor(() => {
            expect(screen.getByTestId('market-price').textContent).toContain('$20');
        });
    });

    it('primes global formatters from stored market preferences before the first child render', async () => {
        window.localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify({
            countryCode: 'US',
            currency: 'USD',
            language: 'en',
            locale: 'en-US',
        }));
        readCachedBrowseFxRatesMock.mockReturnValue({
            baseCurrency: 'INR',
            rates: {
                INR: 1,
                USD: 0.02,
            },
            source: 'unit-test-cache',
            provider: 'unit-test-cache',
            fetchedAt: '2026-03-28T10:00:00.000Z',
            asOfDate: '2026-03-28',
            stale: false,
            staleReason: '',
        });

        const { MarketProvider, StaticFormatProbe } = await loadMarketTestKit();

        await act(async () => {
            render(
                <MarketProvider disableBrowserDetection>
                    <StaticFormatProbe />
                </MarketProvider>
            );
        });

        expect(screen.getByTestId('static-market-price').textContent).toContain('$20');
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

    it('runtime-translates stable templates without queueing ad-hoc rendered fallbacks', async () => {
        const { MarketProvider, DynamicTemplateProbe } = await loadMarketTestKit();

        await act(async () => {
            render(
                <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                    <DynamicTemplateProbe />
                </MarketProvider>
            );
        });

        fireEvent.click(screen.getByRole('button', { name: 'ES' }));

        await waitFor(() => {
            expect(screen.getByTestId('runtime-dynamic-template')).toHaveTextContent('Checked 12:00');
        });

        expect(screen.getByTestId('runtime-ad-hoc-fallback')).toHaveTextContent('Checked 12:00');
        expect(translateTextsMock).not.toHaveBeenCalledWith(expect.objectContaining({
            texts: expect.arrayContaining(['Checked {{time}}', 'Checked 12:00']),
        }));
        expect(translateTextsMock).not.toHaveBeenCalled();
    });

    it('flushes newly queued fallback text after the language switch without an always-running effect', async () => {
        const { MarketProvider, LateArrivalProbe } = await loadMarketTestKit();

        await act(async () => {
            render(
                <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                    <LateArrivalProbe />
                </MarketProvider>
            );
        });

        fireEvent.click(screen.getByRole('button', { name: 'ES' }));
        fireEvent.click(screen.getByRole('button', { name: 'SHOW' }));

        await waitFor(() => {
            expect(screen.getByTestId('runtime-late-fallback')).toHaveTextContent('es:Late arrival');
        });

        expect(translateTextsMock).toHaveBeenCalledWith(expect.objectContaining({
            texts: ['Late arrival'],
            language: 'es',
            sourceLanguage: 'en',
        }));
    });
});
