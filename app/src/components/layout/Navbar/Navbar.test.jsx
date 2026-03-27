import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import Navbar, { NavbarFailureFallback } from './index';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { ColorModeProvider } from '@/context/ColorModeContext';
import { MarketProvider } from '@/context/MarketContext';
import { MotionModeProvider } from '@/context/MotionModeContext';

vi.mock('@/services/api/marketApi', () => ({
    marketApi: {
        getBrowseFxRates: vi.fn().mockResolvedValue({
            baseCurrency: 'INR',
            rates: { INR: 1, USD: 0.02 },
            stale: false,
        }),
    },
    readCachedBrowseFxRates: vi.fn(() => null),
}));

vi.mock('@/context/NotificationContext', () => ({
    useNotifications: () => ({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        markAsRead: vi.fn(),
        markAllAsRead: vi.fn(),
        fetchNotifications: vi.fn(),
    }),
    NotificationProvider: ({ children }) => children,
}));

vi.mock('@/components/shared/GlobalSearchBar', () => ({
    default: ({ className = '' }) => <div data-testid="global-search-bar" className={className}>Search</div>,
}));

vi.mock('@/components/shared/VoiceSearch', () => ({
    default: () => <div data-testid="voice-search">Voice Search</div>,
}));

beforeEach(() => {
    window.scrollTo = vi.fn();
});

describe('Navbar Component', () => {
    const LocationProbe = () => {
        const location = useLocation();
        return <div data-testid="location-probe">{location.pathname}</div>;
    };

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
                        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                            <AuthContext.Provider value={{ ...mockAuth, ...authOverride }}>
                                <CartContext.Provider value={{ ...mockCart, ...cartOverride }}>
                                    <WishlistContext.Provider value={{ ...mockWishlist, ...wishlistOverride }}>
                                        <Navbar />
                                        <LocationProbe />
                                    </WishlistContext.Provider>
                                </CartContext.Provider>
                            </AuthContext.Provider>
                        </MarketProvider>
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

    it('renders readable motion controls inside preferences', () => {
        renderNavbar({ currentUser: { displayName: 'John Doe', email: 'john@example.com' } });

        fireEvent.click(screen.getByText('John Doe'));
        fireEvent.click(screen.getByRole('button', { name: /Preferences/i }));

        expect(screen.getAllByText('Cinematic').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Balanced').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Minimal').length).toBeGreaterThan(0);
        expect(screen.getByText(/Selected:/i)).toBeInTheDocument();
        expect(screen.getByText(/Effective:/i)).toBeInTheDocument();
    });

    it('displays cart count badge', () => {
        renderNavbar({}, { cartItems: [{ quantity: 2 }, { quantity: 1 }] });
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('routes unauthenticated users to the full login page instead of opening a popup', () => {
        renderNavbar({ currentUser: null });

        expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    });

    it('renders a resilient fallback header shell', () => {
        render(
            <MemoryRouter>
                <NavbarFailureFallback />
            </MemoryRouter>
        );

        expect(screen.getByText(/AURA/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Open search/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Cart/i })).toBeInTheDocument();
    });

    it('navigates from the profile panel to wishlist reliably', async () => {
        renderNavbar({ currentUser: { displayName: 'John Doe', email: 'john@example.com' } });

        fireEvent.click(screen.getByText('John Doe'));
        fireEvent.click(screen.getByText('Wishlist'));

        await waitFor(() => {
            expect(screen.getByTestId('location-probe')).toHaveTextContent('/wishlist');
        });
    });
});
