import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import { MARKET_STORAGE_KEY } from '@/config/marketConfig';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import ProductCardInline from './ProductCardInline';

const product = {
    id: '101',
    title: 'Aura Focus Phone',
    brand: 'Aura',
    price: 54999,
    originalPrice: 59999,
    image: '/phone.png',
    rating: 4.5,
    ratingCount: 1248,
    stock: 8,
};

const renderWithMarket = (ui, initialPreference = { countryCode: 'IN', language: 'en', currency: 'INR' }) => render(
    <MarketProvider initialPreference={initialPreference}>
        <LocaleProvider>
            {ui}
        </LocaleProvider>
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
        expect(screen.getByLabelText('4.5 out of 5 from 1,248 reviews')).toBeInTheDocument();
    });

    it('fails closed when a product is out of stock', () => {
        const onAddToCart = vi.fn();

        renderWithMarket(
            <ProductCardInline
                product={{ ...product, stock: 0 }}
                mode="product"
                onAddToCart={onAddToCart}
                onViewDetails={vi.fn()}
            />
        );

        const unavailableButton = screen.getByRole('button', { name: /out of stock/i });
        expect(unavailableButton).toBeDisabled();
        fireEvent.click(unavailableButton);
        expect(onAddToCart).not.toHaveBeenCalled();
    });

    it('shows only catalog-supplied delivery and warranty facts', () => {
        renderWithMarket(
            <ProductCardInline
                product={{
                    ...product,
                    deliveryTime: 'Usually dispatches in 2 days',
                    warranty: '1 year manufacturer warranty',
                }}
                mode="product"
                onAddToCart={vi.fn()}
                onViewDetails={vi.fn()}
            />
        );

        expect(screen.getByText('Usually dispatches in 2 days')).toBeInTheDocument();
        expect(screen.getByText('1 year manufacturer warranty')).toBeInTheDocument();
        expect(screen.queryByText(/Open details to confirm/i)).not.toBeInTheDocument();
    });

    it('asks the shopper to confirm commerce facts that are not supplied', () => {
        renderWithMarket(
            <ProductCardInline
                product={product}
                mode="product"
                onAddToCart={vi.fn()}
                onViewDetails={vi.fn()}
            />
        );

        expect(screen.getByText('Open details to confirm delivery and warranty.')).toBeInTheDocument();
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

    it('shows assistant fit reasons from grounded catalog retrieval', () => {
        renderWithMarket(
            <ProductCardInline
                product={{
                    ...product,
                    assistantReason: 'within Rs 60000, 4.5 rating, 8 in stock',
                    assistantWatchout: 'low review depth',
                }}
                mode="explore"
                onSelect={vi.fn()}
            />
        );

        expect(screen.getByText('Why it fits:')).toBeInTheDocument();
        expect(screen.getByText(/within Rs 60000, 4.5 rating, 8 in stock/)).toBeInTheDocument();
        expect(screen.getByText('Watch: low review depth')).toBeInTheDocument();
    });
});
