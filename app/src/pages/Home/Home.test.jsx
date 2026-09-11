import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './index';
import { productApi, recommendationApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { ColorModeProvider } from '@/context/ColorModeContext';
import { MarketProvider } from '@/context/MarketContext';
import { MotionModeProvider } from '@/context/MotionModeContext';

vi.mock('@/components/features/home/Carousel', () => ({
    default: () => <div data-testid="home-carousel">Carousel</div>,
}));

vi.mock('@/components/features/product/ProductCard', () => ({
    default: ({ product }) => <div data-testid="product-card">{product?.title || product?.name || 'Product'}</div>,
}));

vi.mock('@/components/shared/SkeletonLoader', () => ({
    default: () => <div data-testid="skeleton-loader">Loading</div>,
}));

vi.mock('@/components/shared/RevealOnScroll', () => ({
    default: ({ children }) => <>{children}</>,
}));

// Mock the API layer
vi.mock('@/services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        productApi: {
            ...actual.productApi,
            getProducts: vi.fn(),
            getProductById: vi.fn(),
            getRecommendations: vi.fn(),
        },
        recommendationApi: {
            ...actual.recommendationApi,
            getTrendingProducts: vi.fn(),
            getHomeRecommendations: vi.fn(),
        },
    };
});

const mockAuth = { currentUser: null };
const mockCart = { addToCart: vi.fn(), cartItems: [] };
const mockWishlist = {
    isInWishlist: vi.fn(() => false),
    toggleWishlist: vi.fn()
};

const renderHomeScreen = () => render(
    <MemoryRouter>
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
            <ColorModeProvider>
                <MotionModeProvider>
                    <AuthContext.Provider value={mockAuth}>
                        <CartContext.Provider value={mockCart}>
                            <WishlistContext.Provider value={mockWishlist}>
                                <Home />
                            </WishlistContext.Provider>
                        </CartContext.Provider>
                    </AuthContext.Provider>
                </MotionModeProvider>
            </ColorModeProvider>
        </MarketProvider>
    </MemoryRouter>
);

describe('Home Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders without crashing and calls API', async () => {
        // Setup Mock - resolves immediately with empty array
        productApi.getProducts.mockResolvedValue({ products: [] });
        productApi.getProductById.mockResolvedValue(null);
        productApi.getRecommendations.mockResolvedValue({ products: [] });
        recommendationApi.getTrendingProducts.mockResolvedValue({ recommendations: [] });

        const { container } = renderHomeScreen();

        // Smoke test: Component renders a container div
        expect(container.firstChild).toBeInTheDocument();

        // Verify API was called for data fetching (3 parallel calls)
        await waitFor(() => {
            expect(productApi.getProducts).toHaveBeenCalled();
        });
    });

    it('renders the per-section empty message when the catalog loads empty', async () => {
        productApi.getProducts.mockResolvedValue({ products: [] });
        productApi.getProductById.mockResolvedValue(null);
        recommendationApi.getTrendingProducts.mockResolvedValue({ recommendations: [] });
        recommendationApi.getHomeRecommendations.mockResolvedValue({ recommendations: [] });

        renderHomeScreen();

        const emptyMessages = await screen.findAllByText(/No products are available in this section right now/i);
        expect(emptyMessages).toHaveLength(3);
        expect(screen.queryByTestId('skeleton-loader')).not.toBeInTheDocument();
    });

    it('shows a retryable error state when every home feed request fails', async () => {
        productApi.getProducts.mockRejectedValue(new Error('catalog unreachable'));
        recommendationApi.getTrendingProducts.mockRejectedValue(new Error('trending unreachable'));

        renderHomeScreen();

        // Attempt 0 fails, Home schedules its single automatic retry after 5s, and the
        // retry fails too: the feed error state must be visible, not blank shelves.
        expect(await screen.findByText(/Products could not load right now/i, {}, { timeout: 10000 })).toBeInTheDocument();
        expect(screen.queryByTestId('product-card')).not.toBeInTheDocument();

        // Retrying recovers the shelves without a page reload.
        productApi.getProducts.mockResolvedValue({ products: [{ id: 7, title: 'Recovered Product' }] });
        recommendationApi.getTrendingProducts.mockResolvedValue({ recommendations: [] });

        fireEvent.click(screen.getByRole('button', { name: /retry/i }));

        const cards = await screen.findAllByTestId('product-card');
        expect(cards[0]).toHaveTextContent('Recovered Product');
        expect(screen.queryByText(/Products could not load right now/i)).not.toBeInTheDocument();
    }, 20000);
});
