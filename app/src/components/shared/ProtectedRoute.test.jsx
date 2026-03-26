import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { ProtectedRoute } from './ProtectedRoute';

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
        <AuthContext.Provider value={authValue}>
            <MemoryRouter initialEntries={initialEntries}>
                <LocationProbe />
                <Routes>
                    <Route
                        path="/login"
                        element={<div>Login Screen</div>}
                    />
                    <Route
                        path="/profile"
                        element={(
                            <ProtectedRoute>
                                <div>Profile Screen</div>
                            </ProtectedRoute>
                        )}
                    />
                </Routes>
            </MemoryRouter>
        </AuthContext.Provider>
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

        expect(screen.getByText('Login Screen')).toBeInTheDocument();
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/profile"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?tab=support&ticket=abc123"');
    });
});
