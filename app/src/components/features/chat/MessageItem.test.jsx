import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MessageItem from './MessageItem';

const product = {
    id: '101',
    title: 'Aura Focus Laptop',
    brand: 'Aura',
    price: 54999,
    originalPrice: 59999,
    image: '/laptop.png',
    rating: 4.5,
};

const noopProps = {
    onSelectProduct: vi.fn(),
    onAddToCart: vi.fn(),
    onViewDetails: vi.fn(),
    onOpenSupport: vi.fn(),
    onConfirmPending: vi.fn(),
    onCancelPending: vi.fn(),
};

describe('MessageItem', () => {
    it('renders product cards for product result messages', () => {
        render(
            <MessageItem
                message={{
                    id: 'assistant-results',
                    role: 'assistant',
                    text: 'Here are some laptops.',
                    uiSurface: 'product_results',
                    products: [product],
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('Aura Focus Laptop')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();
    });

    it('does not render stale product cards for navigation messages', () => {
        render(
            <MessageItem
                message={{
                    id: 'assistant-navigation',
                    role: 'assistant',
                    text: 'Opening Marketplace.',
                    uiSurface: 'navigation_notice',
                    products: [product],
                }}
                {...noopProps}
            />
        );

        expect(screen.queryByRole('button', { name: /select/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Aura Focus Laptop')).not.toBeInTheDocument();
        expect(screen.getByText('Opening Marketplace.')).toBeInTheDocument();
    });

    it('shows an approximate match signal when search fallback was used', () => {
        render(
            <MessageItem
                message={{
                    id: 'assistant-approximate',
                    role: 'assistant',
                    text: 'No exact match. Showing closest results.',
                    uiSurface: 'product_results',
                    products: [product],
                    assistantTurn: {
                        ui: {
                            search: {
                                query: 'oppo',
                                matchType: 'approximate',
                                confidence: 0.58,
                            },
                        },
                    },
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText(/No exact match for "oppo"/i)).toBeInTheDocument();
        expect(screen.getByText(/58% confidence/i)).toBeInTheDocument();
    });
});
