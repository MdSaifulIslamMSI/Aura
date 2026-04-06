import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import MessageList from './MessageList';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const noopProps = {
    onSelectProduct: vi.fn(),
    onAddToCart: vi.fn(),
    onViewDetails: vi.fn(),
    onOpenSupport: vi.fn(),
    onConfirmPending: vi.fn(),
    onCancelPending: vi.fn(),
};

const renderWithMarket = (ui) => render(
    <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        {ui}
    </MarketProvider>
);

const makeProduct = (id, title) => ({
    id,
    title,
    brand: 'Aura',
    price: 49999,
    originalPrice: 54999,
    image: '/product.png',
    rating: 4.5,
});

describe('MessageList', () => {
    it('renders product cards only for the latest assistant result set', () => {
        renderWithMarket(
            <MessageList
                messages={[
                    {
                        id: 'assistant-old',
                        role: 'assistant',
                        text: 'Here are older results.',
                        uiSurface: 'product_results',
                        products: [makeProduct('101', 'Older Laptop')],
                    },
                    {
                        id: 'assistant-latest',
                        role: 'assistant',
                        text: 'Here are fresher results.',
                        uiSurface: 'product_results',
                        products: [makeProduct('202', 'Latest Phone')],
                    },
                ]}
                {...noopProps}
            />
        );

        expect(screen.getByText('Latest Phone')).toBeInTheDocument();
        expect(screen.queryByText('Older Laptop')).not.toBeInTheDocument();
    });

    it('hides previous product cards once a later navigation reply arrives', () => {
        renderWithMarket(
            <MessageList
                messages={[
                    {
                        id: 'assistant-results',
                        role: 'assistant',
                        text: 'Here are trending items.',
                        uiSurface: 'product_results',
                        products: [makeProduct('101', 'Old Trending Laptop')],
                    },
                    {
                        id: 'assistant-navigation',
                        role: 'assistant',
                        text: 'Opening Marketplace.',
                        uiSurface: 'navigation_notice',
                        products: [],
                    },
                ]}
                {...noopProps}
            />
        );

        expect(screen.queryByText('Old Trending Laptop')).not.toBeInTheDocument();
        expect(screen.getByText('Opening Marketplace.')).toBeInTheDocument();
    });
});
