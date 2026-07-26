import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import Profile from './index';

const apiMocks = vi.hoisted(() => ({
    getAccountOverview: vi.fn(),
    getHealthStatus: vi.fn(),
    getLatestRewards: vi.fn(),
    getMethods: vi.fn(),
    getAccountSessions: vi.fn(),
    getAccountSecurityActivity: vi.fn(),
    getMfaSecurityCenter: vi.fn(),
    createAvatarUploadIntent: vi.fn(),
    uploadAvatarMedia: vi.fn(),
    finalizeAvatarMedia: vi.fn(),
    getProfile: vi.fn(),
    getRewards: vi.fn(),
    clearAccountCache: vi.fn(),
}));

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
        formatDateTime: (value) => new Date(value).toISOString(),
        formatNumber: (value) => String(value),
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate || ((_key, values = {}, fallback = '') => (
        Object.entries(values).reduce(
            (message, [token, value]) => message.replaceAll(`{${token}}`, String(value)),
            fallback
        )
    )),
}));

vi.mock('@/config/firebase', () => ({
    getFirebaseSocialAuthStatus: () => ({ microsoftEnabled: false, appleEnabled: false }),
}));

vi.mock('@/services/api', () => ({
    authApi: {
        getAccountSessions: apiMocks.getAccountSessions,
        getAccountSecurityActivity: apiMocks.getAccountSecurityActivity,
        getMfaSecurityCenter: apiMocks.getMfaSecurityCenter,
        createAvatarUploadIntent: apiMocks.createAvatarUploadIntent,
        uploadAvatarMedia: apiMocks.uploadAvatarMedia,
        finalizeAvatarMedia: apiMocks.finalizeAvatarMedia,
    },
    intelligenceApi: { getLatestRewards: apiMocks.getLatestRewards },
    paymentApi: { getMethods: apiMocks.getMethods },
    trustApi: { getHealthStatus: apiMocks.getHealthStatus },
    userApi: {
        getAccountOverview: apiMocks.getAccountOverview,
        getProfile: apiMocks.getProfile,
        getRewards: apiMocks.getRewards,
        clearAccountCache: apiMocks.clearAccountCache,
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
        apiMocks.getAccountOverview.mockResolvedValue({
            contractVersion: 1,
            orders: { activeCount: 0, recent: [] },
            postPurchase: { pendingCount: 0 },
            savedItems: { count: 0, preview: [] },
            security: { recommendationCodes: [] },
            support: { openCount: 0, actionRequired: null },
            marketplace: { activeCount: 0, soldCount: 0, recent: null },
            meta: { partial: false, unavailable: [] },
        });
        apiMocks.getMethods.mockResolvedValue([]);
        apiMocks.getRewards.mockResolvedValue(null);
        apiMocks.getHealthStatus.mockResolvedValue({
            derivedStatus: 'healthy',
            backend: { status: 'healthy', db: 'connected' },
        });
        apiMocks.getLatestRewards.mockResolvedValue(null);
        apiMocks.getAccountSessions.mockResolvedValue({ success: true, data: [] });
        apiMocks.getAccountSecurityActivity.mockResolvedValue({
            activity: [],
            retentionDays: 180,
            pagination: { hasMore: false, nextCursor: null },
        });
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

    it('uses the signed upload, scan/normalize, and finalize flow for avatars', async () => {
        apiMocks.getProfile.mockResolvedValue({
            name: 'Profile User',
            email: 'profile@example.com',
            phone: '+919876543210',
            isVerified: true,
            addresses: [],
        });
        apiMocks.getAccountOverview.mockResolvedValue({
            contractVersion: 1,
            orders: { activeCount: 0, recent: [] },
            postPurchase: { pendingCount: 0 },
            savedItems: { count: 0, preview: [] },
            security: { recommendationCodes: [] },
            support: { openCount: 0, actionRequired: null },
            marketplace: { activeCount: 0, soldCount: 0, recent: null },
            meta: { partial: false, unavailable: [] },
        });
        apiMocks.getMethods.mockResolvedValue([]);
        apiMocks.getRewards.mockResolvedValue(null);
        apiMocks.getHealthStatus.mockResolvedValue({
            derivedStatus: 'healthy',
            backend: { status: 'healthy', db: 'connected' },
        });
        apiMocks.getLatestRewards.mockResolvedValue(null);
        apiMocks.getAccountSessions.mockResolvedValue({ success: true, data: [] });
        apiMocks.getAccountSecurityActivity.mockResolvedValue({
            activity: [],
            retentionDays: 180,
            pagination: { hasMore: false, nextCursor: null },
        });
        apiMocks.getMfaSecurityCenter.mockResolvedValue({
            mfa: { enabled: false, methods: {}, trustedDevices: [] },
        });
        apiMocks.createAvatarUploadIntent.mockResolvedValue({ uploadToken: 'upload-token' });
        apiMocks.uploadAvatarMedia.mockResolvedValue({ finalizeToken: 'finalize-token' });
        apiMocks.finalizeAvatarMedia.mockResolvedValue({
            avatar: '/uploads/avatars/normalized-avatar.webp',
        });

        const view = renderProfile();
        await screen.findByRole('button', { name: 'Change profile photo' });
        const input = view.container.querySelector('input[type="file"]');
        const file = new File([new Uint8Array([1, 2, 3, 4])], 'portrait.png', {
            type: 'image/png',
        });

        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => expect(apiMocks.finalizeAvatarMedia).toHaveBeenCalledWith(
            { finalizeToken: 'finalize-token' },
            expect.objectContaining({ firebaseUser: expect.objectContaining({ uid: 'profile-user-1' }) })
        ));
        expect(apiMocks.createAvatarUploadIntent).toHaveBeenCalledWith(
            {
                fileName: 'portrait.png',
                mimeType: 'image/png',
                sizeBytes: 4,
            },
            expect.any(Object)
        );
        expect(apiMocks.uploadAvatarMedia).toHaveBeenCalledWith(
            expect.objectContaining({
                uploadToken: 'upload-token',
                fileName: 'portrait.png',
                mimeType: 'image/png',
                dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
            }),
            expect.any(Object)
        );
        expect(apiMocks.clearAccountCache).toHaveBeenCalledTimes(1);
        expect(view.container.querySelector('img[src="/uploads/avatars/normalized-avatar.webp"]')).toBeInTheDocument();
    });
});
