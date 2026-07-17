import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { MarketProvider } from '@/context/MarketContext';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import { AdminRoute, ProtectedRoute } from './ProtectedRoute';

const LocationProbe = () => {
    const location = useLocation();
    return (
        <pre data-testid="location-probe">
            {JSON.stringify({
                pathname: location.pathname,
                search: location.search,
                state: location.state || null,
            })}
        </pre>
    );
};

const renderProtectedRoute = (authValue, initialEntries = ['/profile']) => {
    render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
            <LocaleProvider>
                <AuthContext.Provider value={authValue}>
                    <MemoryRouter initialEntries={initialEntries}>
                        <LocationProbe />
                        <Routes>
                            <Route
                                path="/login"
                                element={<div>Login Screen</div>}
                            />
                            <Route
                                path="*"
                                element={(
                                    <ProtectedRoute>
                                        <div>Profile Screen</div>
                                    </ProtectedRoute>
                                )}
                            />
                        </Routes>
                    </MemoryRouter>
                </AuthContext.Provider>
            </LocaleProvider>
        </MarketProvider>
    );
};

const renderAdminRoute = (authValue, initialEntries = ['/admin/dashboard']) => {
    render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
            <LocaleProvider>
                <AuthContext.Provider value={authValue}>
                    <MemoryRouter initialEntries={initialEntries}>
                        <LocationProbe />
                        <Routes>
                            <Route
                                path="/"
                                element={<div>Storefront</div>}
                            />
                            <Route
                                path="/login"
                                element={<div>Login Screen</div>}
                            />
                            <Route
                                path="/admin/*"
                                element={(
                                    <AdminRoute>
                                        <div>Admin Dashboard</div>
                                    </AdminRoute>
                                )}
                            />
                        </Routes>
                    </MemoryRouter>
                </AuthContext.Provider>
            </LocaleProvider>
        </MarketProvider>
    );
};

describe('ProtectedRoute', () => {
    it('holds protected pages in a pending state during bootstrap instead of redirecting to login', () => {
        renderProtectedRoute({
            status: 'bootstrap',
            sessionError: null,
            refreshSession: async () => null,
            currentUser: null,
        });

        expect(screen.getByText('Session checkpoint')).toBeInTheDocument();
        expect(screen.queryByText('Login Screen')).not.toBeInTheDocument();
    });

    it('renders the protected content once an authenticated session is available', () => {
        renderProtectedRoute({
            status: 'authenticated',
            sessionError: null,
            refreshSession: async () => null,
            currentUser: { uid: 'u_1', email: 'user@example.com' },
        });

        expect(screen.getByText('Profile Screen')).toBeInTheDocument();
    });

    it('holds protected pages behind the trusted device checkpoint when device proof is pending', () => {
        renderProtectedRoute({
            status: 'device_challenge_required',
            sessionError: null,
            refreshSession: async () => null,
            currentUser: { uid: 'u_1', email: 'user@example.com' },
        });

        expect(screen.getByText('Trusted device checkpoint')).toBeInTheDocument();
        expect(screen.queryByText('Profile Screen')).not.toBeInTheDocument();
    });

    it('renders an interactive MFA challenge and forwards the existing TOTP contract', async () => {
        const verifyMfaTotpChallenge = vi.fn().mockResolvedValue({
            success: true,
            session: { sessionId: 'route-session' },
            profile: { id: 'route-profile' },
            roles: { isAdmin: false },
        });

        renderProtectedRoute({
            status: 'mfa_challenge_required',
            sessionError: null,
            mfaChallenge: {
                challengeId: 'mfa-route-challenge',
                purpose: 'login',
                action: 'finish_login',
                allowedMethods: ['totp', 'recovery_code'],
                preferredMethod: 'totp',
            },
            mfaPolicy: { allowedMethods: ['totp', 'recovery_code'] },
            roles: { isAdmin: false },
            verifyMfaTotpChallenge,
            verifyMfaRecoveryCodeChallenge: vi.fn(),
            refreshSession: async () => null,
            logout: vi.fn().mockResolvedValue(null),
            currentUser: { uid: 'u_1', email: 'user@example.com' },
        });

        expect(screen.getByRole('heading', { name: /confirm it's you/i })).toBeInTheDocument();
        expect(screen.queryByText('Profile Screen')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/6-digit authenticator code/i), {
            target: { value: '654321' },
        });
        fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

        await waitFor(() => {
            expect(verifyMfaTotpChallenge).toHaveBeenCalledWith({
                challengeId: 'mfa-route-challenge',
                purpose: 'login',
                action: 'finish_login',
                code: '654321',
            });
        });
    });

    it('uses admin checkpoint copy only when the resolved role is admin', () => {
        renderAdminRoute({
            status: 'mfa_challenge_required',
            sessionError: null,
            sessionIntelligence: null,
            mfaChallenge: {
                challengeId: 'mfa-admin-challenge',
                allowedMethods: ['passkey'],
                preferredMethod: 'passkey',
            },
            mfaPolicy: { allowedMethods: ['passkey'] },
            roles: { isAdmin: true },
            verifyMfaPasskeyChallenge: vi.fn().mockResolvedValue({ success: true }),
            refreshSession: vi.fn().mockResolvedValue(null),
            logout: vi.fn().mockResolvedValue(null),
            currentUser: { uid: 'u_admin', email: 'admin@example.com' },
        });

        expect(screen.getByRole('heading', { name: /admin verification required/i })).toBeInTheDocument();
        expect(screen.getByText(/admin security checkpoint/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /confirm it's you/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
    });

    it.each([
        ['trusted-device', 'device_challenge_required'],
        ['MFA', 'mfa_challenge_required'],
    ])('rejects a non-admin before rendering the %s challenge', (_label, status) => {
        renderAdminRoute({
            status,
            sessionError: null,
            sessionIntelligence: null,
            deviceChallenge: status === 'device_challenge_required'
                ? { token: 'device-challenge', mode: 'assert' }
                : null,
            mfaChallenge: status === 'mfa_challenge_required'
                ? {
                    challengeId: 'mfa-non-admin',
                    allowedMethods: ['totp'],
                    preferredMethod: 'totp',
                }
                : null,
            roles: { isAdmin: false },
            verifyMfaTotpChallenge: vi.fn(),
            refreshSession: vi.fn().mockResolvedValue(null),
            logout: vi.fn().mockResolvedValue(null),
            currentUser: { uid: 'u_non_admin', email: 'buyer@example.com' },
        });

        expect(screen.getByText('Storefront')).toBeInTheDocument();
        expect(screen.queryByText(/trusted device checkpoint/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /confirm it's you|admin verification required/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
    });

    it('offers a reset sign-in path that preserves the blocked support route', async () => {
        const refreshSession = vi.fn().mockResolvedValue(null);
        const logout = vi.fn().mockResolvedValue(null);

        renderProtectedRoute({
            status: 'recoverable_error',
            sessionError: {
                message: 'CSRF token fetch failed for /auth/sync: HTTP 403',
            },
            refreshSession,
            logout,
            currentUser: { uid: 'u_1', email: 'user@example.com' },
        }, ['/profile?tab=support&ticket=abc123']);

        fireEvent.click(screen.getByRole('button', { name: /reset sign-in/i }));

        await waitFor(() => {
            expect(logout).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
            expect(screen.getByText('Login Screen')).toBeInTheDocument();
            expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');
            expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/profile"');
            expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?tab=support&ticket=abc123"');
        });
    });

    it('opens the recovery-safe admin support route from the blocked state', async () => {
        const refreshSession = vi.fn().mockResolvedValue(null);

        renderProtectedRoute({
            status: 'recoverable_error',
            sessionError: {
                message: 'Profile sync failed while opening checkout.',
            },
            refreshSession,
            logout: vi.fn().mockResolvedValue(null),
            currentUser: { uid: 'u_1', email: 'user@example.com' },
        }, ['/checkout']);

        fireEvent.click(screen.getByRole('button', { name: /open admin support/i }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/contact"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?compose=1');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('Session+sync+blocked+account+access');
    });

    it('renders a single admin lock state before trusted-device checks when the allowlist is missing', () => {
        renderAdminRoute({
            status: 'device_challenge_required',
            sessionError: null,
            sessionIntelligence: {
                adminAccess: {
                    locked: true,
                    reason: 'allowlist_missing',
                    code: 'ADMIN_ALLOWLIST_MISSING',
                    message: 'Admin access is locked: allowlist is not configured',
                },
            },
            roles: { isAdmin: true },
            refreshSession: vi.fn().mockResolvedValue(null),
            currentUser: { uid: 'u_admin', email: 'admin@example.com' },
        });

        expect(screen.getByText('Admin access is locked')).toBeInTheDocument();
        expect(screen.getByText(/production admin allowlist configuration is missing/i)).toBeInTheDocument();
        expect(screen.queryByText('Trusted device checkpoint')).not.toBeInTheDocument();
        expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
    });
});
