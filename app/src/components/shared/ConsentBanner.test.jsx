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
});
