import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import Profile from './index';

const apiMocks = vi.hoisted(() => ({
    getDashboard: vi.fn(),
    getHealthStatus: vi.fn(),
    getLatestRewards: vi.fn(),
    getMethods: vi.fn(),
    getMfaSecurityCenter: vi.fn(),
    getProfile: vi.fn(),
    getRewards: vi.fn(),
}));

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

vi.mock('@/config/firebase', () => ({
    getFirebaseSocialAuthStatus: () => ({ microsoftEnabled: false, appleEnabled: false }),
}));

vi.mock('@/services/api', () => ({
    authApi: { getMfaSecurityCenter: apiMocks.getMfaSecurityCenter },
    intelligenceApi: { getLatestRewards: apiMocks.getLatestRewards },
    paymentApi: { getMethods: apiMocks.getMethods },
    trustApi: { getHealthStatus: apiMocks.getHealthStatus },
    userApi: {
        getDashboard: apiMocks.getDashboard,
        getProfile: apiMocks.getProfile,
        getRewards: apiMocks.getRewards,
    },
}));

vi.mock('@/hooks/useActiveWindowRefresh', () => ({
    useActiveWindowRefresh: () => {},
}));

vi.mock('@/utils/stripe', () => ({
    openStripeSetupModal: vi.fn(),
}));

vi.mock('./components/OverviewSection', () => ({ default: () => null }));
vi.mock('./components/PersonalInfoSection', () => ({ default: () => null }));
vi.mock('./components/AddressesSection', () => ({ default: () => null }));
vi.mock('./components/OrdersSection', () => ({ default: () => null }));
vi.mock('./components/RewardsSection', () => ({ default: () => null }));
vi.mock('./components/ListingsSection', () => ({ default: () => null }));
vi.mock('./components/PaymentsSection', () => ({ default: () => null }));
vi.mock('./components/AccountStatusBanner', () => ({ default: () => null }));
vi.mock('./components/SupportSection', () => ({ default: () => null }));
vi.mock('./components/NotificationsSection', () => ({ default: () => null }));
vi.mock('./components/SettingsSection', () => ({
    default: ({
        handleRetryMfaCenter,
        mfaCenterError,
        mfaCenterHasData,
        mfaCenterLoaded,
    }) => (
        <div>
            <div data-testid="mfa-center-error">{mfaCenterError?.message || 'none'}</div>
            <div data-testid="mfa-center-loaded">{String(mfaCenterLoaded)}</div>
            <div data-testid="mfa-center-has-data">{String(mfaCenterHasData)}</div>
            <button type="button" onClick={handleRetryMfaCenter}>Retry security settings</button>
        </div>
    ),
}));

const renderProfile = () => render(
    <AuthContext.Provider value={{
        currentUser: {
            uid: 'profile-user-1',
            email: 'profile@example.com',
            emailVerified: true,
            providerData: [],
        },
        dbUser: {
            uid: 'profile-user-1',
            name: 'Profile User',
            email: 'profile@example.com',
            phone: '+919876543210',
            isVerified: true,
        },
        isAuthenticated: true,
        logout: vi.fn(),
        sessionIntelligence: { readiness: {} },
    }}>
        <CartContext.Provider value={{ cartItems: [] }}>
            <WishlistContext.Provider value={{ wishlistItems: [] }}>
                <MemoryRouter initialEntries={['/profile?tab=settings']}>
                    <Profile />
                </MemoryRouter>
            </WishlistContext.Provider>
        </CartContext.Provider>
    </AuthContext.Provider>,
);

describe('Profile security center state', () => {
    it('preserves the backend error for SettingsSection and clears it after retry succeeds', async () => {
        const backendError = Object.assign(new Error('Security center backend unavailable.'), {
            status: 503,
        });
        apiMocks.getProfile.mockResolvedValue({
            name: 'Profile User',
            email: 'profile@example.com',
            phone: '+919876543210',
            isVerified: true,
            addresses: [],
        });
        apiMocks.getDashboard.mockResolvedValue({ stats: {}, recentOrders: [] });
        apiMocks.getMethods.mockResolvedValue([]);
        apiMocks.getRewards.mockResolvedValue(null);
        apiMocks.getHealthStatus.mockResolvedValue({
            derivedStatus: 'healthy',
            backend: { status: 'healthy', db: 'connected' },
        });
        apiMocks.getLatestRewards.mockResolvedValue(null);
        apiMocks.getMfaSecurityCenter
            .mockRejectedValueOnce(backendError)
            .mockResolvedValueOnce({ mfa: { enabled: false, methods: {}, trustedDevices: [] } });

        renderProfile();

        await waitFor(() => {
            expect(screen.getByTestId('mfa-center-error')).toHaveTextContent('Security center backend unavailable.');
        });
        expect(screen.getByTestId('mfa-center-loaded')).toHaveTextContent('true');
        expect(screen.getByTestId('mfa-center-has-data')).toHaveTextContent('false');

        fireEvent.click(screen.getByRole('button', { name: 'Retry security settings' }));

        await waitFor(() => {
            expect(screen.getByTestId('mfa-center-error')).toHaveTextContent('none');
            expect(screen.getByTestId('mfa-center-has-data')).toHaveTextContent('true');
        });
        expect(apiMocks.getMfaSecurityCenter).toHaveBeenCalledTimes(2);
    });
});
