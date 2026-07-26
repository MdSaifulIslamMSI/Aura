import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActiveSessionsPanel from './ActiveSessionsPanel';

const sessions = [
    {
        id: 'other-session',
        current: false,
        client: 'Safari',
        os: 'macOS',
        createdAt: '2026-07-20T10:00:00.000Z',
        lastActiveAt: '2026-07-25T10:00:00.000Z',
    },
    {
        id: 'current-session',
        current: true,
        client: 'Chrome',
        os: 'Windows',
        createdAt: '2026-07-24T10:00:00.000Z',
        lastActiveAt: '2026-07-26T10:00:00.000Z',
    },
];

describe('ActiveSessionsPanel', () => {
    it('keeps active sessions distinct from trusted credentials and orders current first', () => {
        render(<ActiveSessionsPanel sessions={sessions} loaded />);

        expect(screen.getByRole('heading', { name: 'Active sessions' })).toBeInTheDocument();
        expect(screen.getByText(/separate from passkeys and remembered browsers/i)).toBeInTheDocument();
        const articles = screen.getAllByRole('article');
        expect(within(articles[0]).getByText('Chrome on Windows')).toBeInTheDocument();
        expect(within(articles[0]).getByText('Current')).toBeInTheDocument();
    });

    it('requires an inline confirmation before revoking a session', async () => {
        const onRevokeSession = vi.fn().mockResolvedValue({ success: true });
        render(
            <ActiveSessionsPanel
                sessions={sessions}
                loaded
                onRevokeSession={onRevokeSession}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Sign out Safari on macOS' }));
        expect(onRevokeSession).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out Safari on macOS' }));
        await waitFor(() => expect(onRevokeSession).toHaveBeenCalledWith(sessions[0]));
    });

    it('requires confirmation before revoking all other sessions', async () => {
        const onRevokeOtherSessions = vi.fn().mockResolvedValue({ revoked: 1 });
        render(
            <ActiveSessionsPanel
                sessions={sessions}
                loaded
                onRevokeOtherSessions={onRevokeOtherSessions}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Sign out other sessions' }));
        expect(onRevokeOtherSessions).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out 1' }));
        await waitFor(() => expect(onRevokeOtherSessions).toHaveBeenCalledTimes(1));
    });

    it('requires confirmation before revoking every session including the current browser', async () => {
        const onRevokeAllSessions = vi.fn().mockResolvedValue({ revoked: 2 });
        render(
            <ActiveSessionsPanel
                sessions={sessions}
                loaded
                onRevokeAllSessions={onRevokeAllSessions}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
        expect(onRevokeAllSessions).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out everywhere' }));
        await waitFor(() => expect(onRevokeAllSessions).toHaveBeenCalledTimes(1));
    });

    it('preserves the last inventory when a refresh fails', () => {
        render(
            <ActiveSessionsPanel
                sessions={sessions}
                loaded
                error={new Error('Session service unavailable.')}
            />
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Session service unavailable.');
        expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    });
});
