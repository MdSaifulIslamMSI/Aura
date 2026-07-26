import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SecurityActivityPanel from './SecurityActivityPanel';

describe('SecurityActivityPanel', () => {
    it('renders only customer-safe activity fields and retention copy', () => {
        render(
            <SecurityActivityPanel
                loaded
                retentionDays={180}
                activity={[{
                    type: 'passkey_added',
                    outcome: 'success',
                    occurredAt: '2026-07-26T10:00:00.000Z',
                }]}
            />
        );

        expect(screen.getByRole('heading', { name: 'Security activity' })).toBeInTheDocument();
        expect(screen.getByText(/available for up to 180 days/i)).toBeInTheDocument();
        expect(screen.getByText('Passkey added')).toBeInTheDocument();
        expect(screen.queryByText('must-not-leak')).toBeNull();
    });

    it('loads the next page without hiding the existing activity', () => {
        const onLoadMore = vi.fn();
        render(
            <SecurityActivityPanel
                loaded
                hasMore
                onLoadMore={onLoadMore}
                activity={[{
                    type: 'sign_in',
                    outcome: 'success',
                    occurredAt: '2026-07-26T10:00:00.000Z',
                }]}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Load more activity' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
        expect(screen.getByText('New sign-in')).toBeInTheDocument();
    });
});
