import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import { ColorModeProvider } from '@/context/ColorModeContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { AuthContext } from '@/context/AuthContext';
import { MARKET_STORAGE_KEY } from '@/config/marketConfig';
import ProductDetails from './index';

vi.mock('@/services/api/marketApi', () => ({
    marketApi: {
        getBrowseFxRates: vi.fn().mockResolvedValue({
            baseCurrency: 'INR',
            rates: {
                INR: 1,
                MXN: 0.22,
            },
            stale: false,
        }),
    },
    readCachedBrowseFxRates: vi.fn(() => null),
}));

vi.mock('@/services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        productApi: {
            ...actual.productApi,
            getProductById: vi.fn().mockResolvedValue({
                id: 400046371,
                title: 'Eco Plus Speaker',
                displayTitle: 'Eco Plus Speaker 09275-1',
                brand: 'Amazon',
                category: 'electronics',
                price: 54999,
                originalPrice: 70999,
                discountPercentage: 22,
                stock: 4,
                image: '/speaker.png',
                description: 'Smart speaker tuned for catalog browse tests.',
                deliveryTime: '2-4 days',
                rating: 5,
                ratingCount: 4312,
                pricing: {
                    baseAmount: 54999,
                    baseCurrency: 'INR',
                    displayAmount: 1056.96,
                    displayCurrency: 'MXN',
                    originalDisplayAmount: 1363.48,
                    originalBaseAmount: 70999,
                },
            }),
            getProducts: vi.fn().mockResolvedValue({ products: [] }),
            getProductReviews: vi.fn().mockResolvedValue({
                reviews: [],
                summary: {
                    averageRating: 5,
                    totalReviews: 4312,
                    withMediaCount: 0,
                    ratingBreakdown: { 5: 4312, 4: 0, 3: 0, 2: 0, 1: 0 },
                },
            }),
            getCompatibility: vi.fn().mockResolvedValue({ groups: [] }),
        },
        priceAlertApi: {
            ...actual.priceAlertApi,
            getHistory: vi.fn().mockResolvedValue({ history: [] }),
            create: vi.fn(),
        },
        uploadApi: {
            ...actual.uploadApi,
            uploadReviewMediaFromFile: vi.fn(),
        },
    };
});

vi.mock('@/components/features/product/ProductCard', () => ({
    default: () => <div data-testid="related-product-card" />,
}));

describe('ProductDetails', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.removeItem(MARKET_STORAGE_KEY);
    });

    it('renders hero pricing in the active market currency even when backend display pricing is stale', async () => {
        render(
            <ColorModeProvider>
                <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                    <AuthContext.Provider value={{ currentUser: null }}>
                        <CartContext.Provider value={{ cartItems: [], addToCart: vi.fn(), updateQuantity: vi.fn() }}>
                            <WishlistContext.Provider value={{ toggleWishlist: vi.fn(), isInWishlist: vi.fn(() => false) }}>
                                <MemoryRouter initialEntries={['/product/400046371']}>
                                    <Routes>
                                        <Route path="/product/:id" element={<ProductDetails />} />
                                    </Routes>
                                </MemoryRouter>
                            </WishlistContext.Provider>
                        </CartContext.Provider>
                    </AuthContext.Provider>
                </MarketProvider>
            </ColorModeProvider>
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /eco plus speaker 09275-1/i })).toBeInTheDocument();
        });

        expect(screen.queryByText((_, node) => {
            const text = node?.textContent?.replace(/\u00a0/g, ' ') || '';
            return /MX\$/.test(text) && /1,056\.96/.test(text);
        })).not.toBeInTheDocument();

        expect(screen.getAllByText((_, node) => {
            const text = node?.textContent?.replace(/\u00a0/g, ' ') || '';
            return /₹/.test(text) && /54,999(?:\.00)?/.test(text);
        }).length).toBeGreaterThan(0);
    });
});
