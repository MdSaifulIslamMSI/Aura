import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import { MARKET_STORAGE_KEY } from '@/config/marketConfig';
import ProductCardInline from './ProductCardInline';

const product = {
    id: '101',
    title: 'Aura Focus Phone',
    brand: 'Aura',
    price: 54999,
    originalPrice: 59999,
    image: '/phone.png',
    rating: 4.5,
};

const renderWithMarket = (ui, initialPreference = { countryCode: 'IN', language: 'en', currency: 'INR' }) => render(
    <MarketProvider initialPreference={initialPreference}>
        {ui}
    </MarketProvider>
);

describe('ProductCardInline', () => {
    beforeEach(() => {
        window.localStorage.removeItem(MARKET_STORAGE_KEY);
    });

    it('shows a single select action in explore mode', () => {
        const onSelect = vi.fn();

        renderWithMarket(
            <ProductCardInline
                product={product}
                mode="explore"
                onSelect={onSelect}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /select/i }));

        expect(onSelect).toHaveBeenCalledWith('101');
        expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /view details/i })).not.toBeInTheDocument();
    });

    it('shows add-to-cart and detail actions in product mode', () => {
        const onAddToCart = vi.fn();
        const onViewDetails = vi.fn();

        renderWithMarket(
            <ProductCardInline
                product={product}
                mode="product"
                onAddToCart={onAddToCart}
                onViewDetails={onViewDetails}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));
        fireEvent.click(screen.getByRole('button', { name: /view details/i }));

        expect(onAddToCart).toHaveBeenCalledWith('101');
        expect(onViewDetails).toHaveBeenCalledWith('101');
    });

    it('renders inline pricing in the active market currency even when stale backend display pricing differs', () => {
        renderWithMarket(
            <ProductCardInline
                product={{
                    ...product,
                    pricing: {
                        baseAmount: 54999,
                        baseCurrency: 'INR',
                        displayAmount: 699,
                        displayCurrency: 'USD',
                        originalDisplayAmount: 749,
                        originalBaseAmount: 59999,
                    },
                }}
                mode="explore"
                onSelect={vi.fn()}
            />,
            { countryCode: 'IN', language: 'en', currency: 'JPY' }
        );

        expect(screen.queryByText(/\$699(?:\.00)?/)).not.toBeInTheDocument();
        expect(screen.queryByText(/\$749(?:\.00)?/)).not.toBeInTheDocument();
        expect(screen.getAllByText(/¥|JP¥/).length).toBeGreaterThan(0);
    });
});
