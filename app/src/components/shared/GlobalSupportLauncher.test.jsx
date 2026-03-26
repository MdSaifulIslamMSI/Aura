import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import GlobalSupportLauncher from './GlobalSupportLauncher';

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

const renderLauncher = ({
    currentUser = null,
    initialEntry = '/',
} = {}) => render(
    <MemoryRouter initialEntries={[initialEntry]}>
        <AuthContext.Provider value={{ currentUser }}>
            <GlobalSupportLauncher />
            <LocationProbe />
        </AuthContext.Provider>
    </MemoryRouter>
);

describe('GlobalSupportLauncher', () => {
    it('navigates authenticated users straight to the support desk', async () => {
        renderLauncher({
            currentUser: { uid: 'user-1', email: 'member@example.com' },
            initialEntry: '/products',
        });

        fireEvent.click(screen.getByRole('button', { name: /talk to admin support/i }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/contact"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?compose=1"');
    });

    it('stores the support deep link in login state for signed-out users', async () => {
        renderLauncher({
            currentUser: null,
            initialEntry: '/login',
        });

        fireEvent.click(screen.getByRole('button', { name: /talk to admin support/i }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/contact"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?compose=1"');
    });

    it('hides itself while the user is already in a support surface', () => {
        renderLauncher({
            currentUser: { uid: 'user-1', email: 'member@example.com' },
            initialEntry: '/contact?compose=1',
        });

        expect(screen.queryByRole('button', { name: /talk to admin support/i })).not.toBeInTheDocument();
    });
});
