import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';

const mocks = vi.hoisted(() => ({
    pushClientDiagnostic: vi.fn(),
}));

vi.mock('@/services/clientObservability', () => ({
    pushClientDiagnostic: mocks.pushClientDiagnostic,
}));

import SecurePathDock from './SecurePathDock';

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

const renderDock = ({
    authValue = {},
    initialEntry = '/',
} = {}) => render(
    <MemoryRouter initialEntries={[initialEntry]}>
        <AuthContext.Provider value={{
            currentUser: null,
            dbUser: null,
            deviceChallenge: null,
            roles: {},
            status: 'signed_out',
            ...authValue,
        }}
        >
            <SecurePathDock />
            <LocationProbe />
        </AuthContext.Provider>
    </MemoryRouter>
);

describe('SecurePathDock', () => {
    beforeEach(() => {
        mocks.pushClientDiagnostic.mockClear();
    });

    it('opens market studio from the secure path instead of a page-covering floating panel', () => {
        const listener = vi.fn();
        window.addEventListener('aura:open-market-studio', listener);

        renderDock();

        fireEvent.click(screen.getByRole('button', { name: /market studio: region controls/i }));

        expect(listener).toHaveBeenCalledTimes(1);
        expect(mocks.pushClientDiagnostic).toHaveBeenCalledWith('market_studio.secure_path_opened', {
            context: {
                originPath: '/',
                source: 'secure_path_dock',
            },
        });

        window.removeEventListener('aura:open-market-studio', listener);
    });

    it('toggles the compact secure path sheet from the trigger button', () => {
        renderDock();

        const trigger = screen.getByRole('button', { name: /^secure path tools$/i });

        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(trigger);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(screen.getByRole('button', { name: /market studio: region controls/i }));

        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('navigates into the assistant workspace with the current commerce context', () => {
        renderDock({ initialEntry: '/product/101?ref=home' });

        fireEvent.click(screen.getByRole('button', { name: /commerce assistant: focused copilot/i }));

        expect(mocks.pushClientDiagnostic).toHaveBeenCalledWith('assistant_workspace.launcher_opened', {
            context: {
                originPath: '/product/101?ref=home',
                source: 'secure_path_dock',
            },
        });
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/assistant"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?from=%2Fproduct%2F101%3Fref%3Dhome"');
    });

    it('sends authenticated users to the support desk from product pages', () => {
        renderDock({
            authValue: {
                currentUser: { uid: 'user-1', email: 'member@example.com' },
            },
            initialEntry: '/product/101',
        });

        fireEvent.click(screen.getByRole('button', { name: /support panel: support desk/i }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/contact"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?compose=1"');
    });

    it('keeps the support route in login state for signed-out users', () => {
        renderDock({ initialEntry: '/orders' });

        fireEvent.click(screen.getByRole('button', { name: /support access: sign in for support/i }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/contact"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?compose=1"');
    });

    it('moves admin trust proof into the secure path before entering admin', () => {
        renderDock({
            authValue: {
                currentUser: { uid: 'admin-1', email: 'admin@example.com' },
                dbUser: { isAdmin: true },
                roles: { isAdmin: true },
            },
            initialEntry: '/products',
        });

        fireEvent.click(screen.getByRole('button', { name: /trust checkpoint: admin proof lane/i }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/admin/dashboard"');
    });

    it('does not add another utility layer inside admin routes', () => {
        renderDock({
            authValue: {
                currentUser: { uid: 'admin-1', email: 'admin@example.com' },
                dbUser: { isAdmin: true },
                roles: { isAdmin: true },
            },
            initialEntry: '/admin/dashboard',
        });

        expect(screen.queryByRole('navigation', { name: /secure path tools/i })).not.toBeInTheDocument();
    });
});
