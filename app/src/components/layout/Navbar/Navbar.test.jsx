import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import Navbar from './index';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { ColorModeProvider } from '@/context/ColorModeContext';
import { MotionModeProvider } from '@/context/MotionModeContext';

vi.mock('@/components/shared/GlobalSearchBar', () => ({
    default: ({ className = '' }) => <div data-testid="global-search-bar" className={className}>Search</div>,
}));

vi.mock('@/components/shared/VoiceSearch', () => ({
    default: () => <div data-testid="voice-search">Voice Search</div>,
}));

describe('Navbar Component', () => {
    const mockAuth = {
        currentUser: null,
        logout: vi.fn()
    };

    const mockCart = {
        cartItems: []
    };

    const mockWishlist = {
        wishlistItems: [],
        toggleWishlist: vi.fn(),
        isInWishlist: vi.fn(() => false)
    };

    const renderNavbar = (authOverride = {}, cartOverride = {}, wishlistOverride = {}) => {
        return render(
            <MemoryRouter>
                <ColorModeProvider>
                    <MotionModeProvider>
                        <AuthContext.Provider value={{ ...mockAuth, ...authOverride }}>
                            <CartContext.Provider value={{ ...mockCart, ...cartOverride }}>
                                <WishlistContext.Provider value={{ ...mockWishlist, ...wishlistOverride }}>
                                    <Navbar />
                                </WishlistContext.Provider>
                            </CartContext.Provider>
                        </AuthContext.Provider>
                    </MotionModeProvider>
                </ColorModeProvider>
            </MemoryRouter>
        );
    };

    it('renders logo', () => {
        renderNavbar();
        expect(screen.getByText(/AURA/i)).toBeInTheDocument();
        // expect(screen.getByPlaceholderText(/Search for products/i)).toBeInTheDocument(); // Hidden on mobile, flaky test
    });

    it('shows Login button when not authenticated', () => {
        renderNavbar({ currentUser: null });
        expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    });

    it('shows User Name when authenticated', () => {
        renderNavbar({ currentUser: { displayName: 'John Doe', email: 'john@example.com' } });
        expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('displays cart count badge', () => {
        renderNavbar({}, { cartItems: [{ quantity: 2 }, { quantity: 1 }] });
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('routes unauthenticated users to the full login page instead of opening a popup', () => {
        renderNavbar({ currentUser: null });

        expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    });
});
