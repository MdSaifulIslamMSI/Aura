import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushClientDiagnostic: vi.fn(),
}));

vi.mock('@/services/clientObservability', () => ({
    pushClientDiagnostic: mocks.pushClientDiagnostic,
}));

import AssistantLauncher from './AssistantLauncher';

const LocationProbe = () => {
    const location = useLocation();
    return (
        <pre data-testid="location-probe">
            {JSON.stringify({
                pathname: location.pathname,
                search: location.search,
            })}
        </pre>
    );
};

const renderLauncher = (initialEntry = '/product/101?ref=home') => render(
    <MemoryRouter initialEntries={[initialEntry]}>
        <AssistantLauncher />
        <LocationProbe />
    </MemoryRouter>
);

describe('AssistantLauncher', () => {
    it('navigates into the dedicated assistant workspace with the origin route', () => {
        renderLauncher();

        fireEvent.click(screen.getByRole('button', { name: /open the focused commerce copilot/i }));

        expect(mocks.pushClientDiagnostic).toHaveBeenCalledWith('assistant_workspace.launcher_opened', {
            context: {
                originPath: '/product/101?ref=home',
            },
        });
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/assistant"');
        expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?from=%2Fproduct%2F101%3Fref%3Dhome"');
    });

    it('hides itself inside the assistant workspace', () => {
        renderLauncher('/assistant?from=%2F');

        expect(screen.queryByRole('button', { name: /open the focused commerce copilot/i })).not.toBeInTheDocument();
    });

    it('does not render on the homepage', () => {
        renderLauncher('/');

        expect(screen.queryByRole('button', { name: /open the focused commerce copilot/i })).not.toBeInTheDocument();
    });
});
