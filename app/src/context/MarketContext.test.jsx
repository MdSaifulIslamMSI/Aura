import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKET_STORAGE_KEY } from '@/config/marketConfig';
import { getActiveMarketState, resetActiveMarketHeaders } from '@/services/marketRuntime';
import { MarketProvider, useMarket } from './MarketContext';

vi.mock('@/services/api', () => ({
    i18nApi: {
        translateTexts: vi.fn(async ({ texts = [], language }) => Object.fromEntries(
            texts.map((text) => [text, language === 'en' ? text : `${language}:${text}`])
        )),
    },
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

const RuntimeFallbackProbe = () => {
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

afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
    resetActiveMarketHeaders();
  });

describe('MarketContext', () => {
    it('formats catalog prices using the selected browse currency', () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <MarketProbe />
            </MarketProvider>
        );

        expect(screen.getByTestId('market-country')).toHaveTextContent('IN');
        expect(screen.getByTestId('market-price').textContent).toMatch(/₹|Rs|INR/);

        fireEvent.click(screen.getByRole('button', { name: 'USD' }));

        expect(screen.getByTestId('market-currency')).toHaveTextContent('USD');
        expect(screen.getByTestId('market-price').textContent).toContain('$');
    });

    it('updates document direction when switching to an rtl language', () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'AE', language: 'en', currency: 'AED' }}>
                <MarketProbe />
            </MarketProvider>
        );

        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'AR' }));
        });

        expect(screen.getByTestId('market-language')).toHaveTextContent('ar');
        expect(document.documentElement.dir).toBe('rtl');
        expect(document.documentElement.lang).toContain('ar');
    });

    it('persists the selected market and syncs runtime request headers', () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <MarketProbe />
            </MarketProvider>
        );

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

    it('runtime-translates missing keyed messages for non-English languages', async () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <RuntimeFallbackProbe />
            </MarketProvider>
        );

        expect(screen.getByTestId('runtime-fallback')).toHaveTextContent('Ready for translation');

        fireEvent.click(screen.getByRole('button', { name: 'ES' }));

        await waitFor(() => {
            expect(screen.getByTestId('runtime-fallback')).toHaveTextContent('es:Ready for translation');
        });
    });
});
