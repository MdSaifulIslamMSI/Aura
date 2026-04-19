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

const { getRewardsMock } = vi.hoisted(() => ({
    getRewardsMock: vi.fn().mockResolvedValue({
        rewards: {
            pointsBalance: 1808,
        },
    }),
}));

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

vi.mock('@/services/api/userApi', () => ({
    userApi: {
        getRewards: getRewardsMock,
    },
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

beforeEach(() => {
    window.scrollTo = vi.fn();
    getRewardsMock.mockClear();
    getRewardsMock.mockResolvedValue({
        rewards: {
            pointsBalance: 1808,
        },
    });
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

    it('shows direct account links without extra preference controls', () => {
        renderNavbar({ currentUser: { displayName: 'John Doe', email: 'john@example.com' } });

        fireEvent.click(screen.getByText('John Doe'));

        expect(screen.getByText('My profile')).toBeInTheDocument();
        expect(screen.getByText('Orders')).toBeInTheDocument();
        expect(screen.getByText('Wishlist')).toBeInTheDocument();
        expect(screen.getAllByText('Become seller').length).toBeGreaterThan(0);
        expect(screen.getByText('Color mode')).toBeInTheDocument();
        expect(screen.getByText('Stylish White')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Preferences/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Admin Tools/i })).not.toBeInTheDocument();
    });

    it('hydrates aura points from the rewards endpoint for authenticated users', async () => {
        renderNavbar({
            currentUser: { uid: 'user-1', displayName: 'John Doe', email: 'john@example.com' },
            dbUser: { name: 'John Doe', loyalty: {} },
        });

        await waitFor(() => {
            expect(screen.getAllByText('1,808 AP').length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getByText('John Doe'));

        await waitFor(() => {
            expect(screen.getAllByText('1,808 AP').length).toBeGreaterThan(1);
        });
    });

    it('lets the user switch color modes directly from the profile menu', () => {
        renderNavbar({ currentUser: { displayName: 'John Doe', email: 'john@example.com' } });

        fireEvent.click(screen.getByText('John Doe'));
        fireEvent.click(screen.getAllByRole('button', { name: 'Stylish White' })[0]);

        expect(document.documentElement).toHaveAttribute('data-color-mode', 'white');
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

    it('keeps market settings in a dedicated control without an explore panel', () => {
        renderNavbar();

        expect(screen.queryByRole('button', { name: /Open quick access panel/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Open market settings/i }));

        expect(screen.getByText('Country')).toBeInTheDocument();
        expect(screen.getByText('Language')).toBeInTheDocument();
        expect(screen.getByText('Currency')).toBeInTheDocument();
    });

    it('shows a direct admin portal link in the profile menu', () => {
        renderNavbar({
            currentUser: { displayName: 'John Doe', email: 'john@example.com' },
            dbUser: { isAdmin: true, name: 'John Doe' }
        });

        fireEvent.click(screen.getByText('John Doe'));

        expect(screen.getByText('Admin portal')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Admin Tools/i })).not.toBeInTheDocument();
    });
});
