import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import Home from './index';
import { productApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { ColorModeProvider } from '@/context/ColorModeContext';
import { MotionModeProvider } from '@/context/MotionModeContext';

// Mock the API layer
vi.mock('@/services/api', () => ({
    productApi: {
        getProducts: vi.fn(),
    },
}));

describe('Home Page', () => {
    const mockAuth = { currentUser: null };
    const mockCart = { addToCart: vi.fn(), cartItems: [] };
    const mockWishlist = {
        isInWishlist: vi.fn(() => false),
        toggleWishlist: vi.fn()
    };

    it('renders without crashing and calls API', async () => {
        // Setup Mock - resolves immediately with empty array
        productApi.getProducts.mockResolvedValue({ products: [] });

        const { container } = render(
            <MemoryRouter>
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
            </MemoryRouter>
        );

        // Smoke test: Component renders a container div
        expect(container.firstChild).toBeInTheDocument();

        // Verify API was called for data fetching (3 parallel calls)
        await waitFor(() => {
            expect(productApi.getProducts).toHaveBeenCalled();
        });
    });
});
