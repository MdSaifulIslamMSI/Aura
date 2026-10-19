import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ConsentBanner from './ConsentBanner';
import {
    TELEMETRY_CONSENT_GRANTED,
    TELEMETRY_CONSENT_STORAGE_KEY,
} from '@/services/telemetryConsent';

describe('ConsentBanner', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('asks for consent before any session capture starts', () => {
        render(<ConsentBanner />);

        expect(screen.getByText('Allow optional session replay?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'No thanks' })).toBeInTheDocument();
        expect(window.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBeNull();
    });

    it('stores the opt-in and switches to the active state', () => {
        render(<ConsentBanner />);

        fireEvent.click(screen.getByRole('button', { name: 'Allow' }));

        expect(window.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBe(TELEMETRY_CONSENT_GRANTED);
        expect(screen.getByText('Optional session replay is on.')).toBeInTheDocument();
        expect(screen.queryByText('Allow optional session replay?')).not.toBeInTheDocument();
    });

    it('stores the opt-out and stops asking', () => {
        render(<ConsentBanner />);

        fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));

        expect(window.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBe('denied');
        expect(screen.queryByText('Allow optional session replay?')).not.toBeInTheDocument();
    });

    it('lets the visitor withdraw a granted consent', () => {
        window.localStorage.setItem(TELEMETRY_CONSENT_STORAGE_KEY, TELEMETRY_CONSENT_GRANTED);

        render(<ConsentBanner />);

        expect(screen.getByText('Optional session replay is on.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));

        expect(window.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBe('denied');
        expect(screen.queryByText('Optional session replay is on.')).not.toBeInTheDocument();
    });

    // The banner is a fixed bottom overlay that is mounted globally, so it
    // physically overlaps page controls - the mobile PDP sticky buy bar is
    // the case that broke. It must never intercept a tap meant for a control
    // underneath, so the sheet is pointer-events-none and only its own
    // controls are pointer-events-auto.
    it('never intercepts pointer events meant for a control underneath', () => {
        const { unmount } = render(<ConsentBanner />);

        const sheet = screen.getByRole('dialog', { name: 'Privacy' });
        expect(sheet.className).toContain('pointer-events-none');

        for (const name of ['Allow', 'No thanks', 'Dismiss']) {
            expect(screen.getByRole('button', { name }).className).toContain('pointer-events-auto');
        }
        unmount();

        window.localStorage.setItem(TELEMETRY_CONSENT_STORAGE_KEY, TELEMETRY_CONSENT_GRANTED);
        render(<ConsentBanner />);

        const granted = screen.getByText('Optional session replay is on.').closest('div.pointer-events-none');
        expect(granted).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Turn off' }).className).toContain('pointer-events-auto');
    });

    it('lifts the sheet clear of the mobile bottom action bar', () => {
        render(<ConsentBanner />);

        const sheet = screen.getByRole('dialog', { name: 'Privacy' });
        // The mobile sticky buy bar is fixed at the bottom; the sheet must sit
        // above it rather than on top of it.
        expect(sheet.className).toMatch(/bottom-\[calc\(5\.9rem\+env\(safe-area-inset-bottom\)\)\]/);
        expect(sheet.className).toContain('sm:bottom-5');
    });
});
