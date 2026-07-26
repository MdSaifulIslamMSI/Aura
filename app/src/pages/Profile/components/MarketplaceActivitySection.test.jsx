import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarketplaceActivitySection from './MarketplaceActivitySection';
import { authApi } from '@/services/api';

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
        formatCurrency: (value) => `$${Number(value).toFixed(2)}`,
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

vi.mock('@/services/api', () => ({
    authApi: {
        getAccountMarketplace: vi.fn(),
    },
}));

const renderSection = () => render(
    <MemoryRouter>
        <MarketplaceActivitySection firebaseUser={{ uid: 'owner-1' }} />
    </MemoryRouter>
);

describe('MarketplaceActivitySection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders repository-backed saved, review, listing, trade-in, and alert activity', async () => {
        authApi.getAccountMarketplace.mockResolvedValue({
            savedItems: {
                count: 1,
                href: '/wishlist',
                items: [{ productId: 9, title: 'Saved camera', price: 89, inStock: true, href: '/product/9' }],
            },
            reviews: {
                count: 1,
                items: [{ id: 'review-1', productTitle: 'Saved camera', rating: 5, status: 'published', href: '/product/9' }],
            },
            listings: {
                count: 1,
                href: '/my-listings',
                items: [{ id: 'listing-1', title: 'Camera case', status: 'active', views: 12, href: '/listing/listing-1' }],
            },
            tradeIns: {
                count: 1,
                href: '/trade-in',
                items: [{ id: 'trade-1', productTitle: 'New camera', status: 'under-review', href: '/trade-in' }],
            },
            priceAlerts: {
                count: 1,
                href: '/price-alerts',
                items: [{ id: 'alert-1', productTitle: 'Lens', targetPrice: 70, href: '/price-alerts' }],
            },
        });

        renderSection();

        expect(await screen.findAllByText('Saved camera')).toHaveLength(2);
        expect(screen.getByRole('heading', { name: 'Marketplace activity' })).toBeInTheDocument();
        expect(screen.getByText('Camera case')).toBeInTheDocument();
        expect(screen.getByText('New camera')).toBeInTheDocument();
        expect(screen.getByText('Lens')).toBeInTheDocument();
        expect(authApi.getAccountMarketplace).toHaveBeenCalledWith({
            firebaseUser: { uid: 'owner-1' },
        });
    });

    it('exposes a retry after an isolated marketplace load failure', async () => {
        authApi.getAccountMarketplace
            .mockRejectedValueOnce(new Error('Marketplace unavailable'))
            .mockResolvedValueOnce({});

        renderSection();

        expect(await screen.findByRole('alert')).toHaveTextContent('Marketplace unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        await waitFor(() => {
            expect(authApi.getAccountMarketplace).toHaveBeenCalledTimes(2);
        });
        expect(await screen.findByText('No marketplace activity yet')).toBeInTheDocument();
    });
});
