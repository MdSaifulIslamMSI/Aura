import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { ProtectedRoute } from './ProtectedRoute';

const renderProtectedRoute = (authValue, initialEntries = ['/profile']) => {
    render(
        <AuthContext.Provider value={authValue}>
            <MemoryRouter initialEntries={initialEntries}>
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
});
