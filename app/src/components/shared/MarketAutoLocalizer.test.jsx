import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider, useMarket } from '@/context/MarketContext';
import MarketAutoLocalizer from './MarketAutoLocalizer';

const { translateTextsMock, getBrowseFxRatesMock, readCachedBrowseFxRatesMock } = vi.hoisted(() => ({
    translateTextsMock: vi.fn(async ({ texts = [], language }) => Object.fromEntries(
        texts.map((text) => [text, language === 'en' ? text : `${language}:${text}`])
    )),
    getBrowseFxRatesMock: vi.fn(),
    readCachedBrowseFxRatesMock: vi.fn(),
}));

vi.mock('@/services/api/i18nApi', () => ({
    i18nApi: {
        translateTexts: translateTextsMock,
    },
}));

vi.mock('@/services/api/marketApi', () => ({
    marketApi: {
        getBrowseFxRates: getBrowseFxRatesMock,
    },
    readCachedBrowseFxRates: readCachedBrowseFxRatesMock,
}));

const Probe = () => {
    const { setLanguage } = useMarket();

    return (
        <div>
            <MarketAutoLocalizer />
            <button data-testid="switch-es" type="button" onClick={() => setLanguage('es')}>Spanish</button>
            <button data-testid="switch-en" type="button" onClick={() => setLanguage('en')}>English</button>
            <h1>Continue Shopping</h1>
            <input placeholder="Search products" aria-label="Search products" />
        </div>
    );
};

describe('MarketAutoLocalizer', () => {
    it('translates raw UI text and restores the original English copy', async () => {
        translateTextsMock.mockClear();
        getBrowseFxRatesMock.mockReset();
        readCachedBrowseFxRatesMock.mockReset();
        readCachedBrowseFxRatesMock.mockReturnValue(null);
        getBrowseFxRatesMock.mockResolvedValue({
            baseCurrency: 'INR',
            rates: { INR: 1, USD: 0.02 },
            stale: false,
        });

        render(
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <Probe />
            </MarketProvider>
        );

        expect(screen.getByRole('heading', { name: 'Continue Shopping' })).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('switch-es'));

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'es:Continue Shopping' })).toBeInTheDocument();
        });

        expect(translateTextsMock).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'es:Search products');

        fireEvent.click(screen.getByTestId('switch-en'));

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Continue Shopping' })).toBeInTheDocument();
        });

        expect(translateTextsMock).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Search products');
    });
});
