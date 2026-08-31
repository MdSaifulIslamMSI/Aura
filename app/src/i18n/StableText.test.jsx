import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StableText } from './StableText';

describe('StableText', () => {
    it('renders catalog-backed messages', () => {
        render(<StableText id="accessibility.hidePassword" />);
        expect(screen.getByText('Hide password')).toBeTruthy();
    });

    it('applies ICU values from the catalog message', () => {
        render(<StableText id="accessibility.openCart" values={{ count: 3 }} />);
        expect(screen.getByText('Open cart with 3 items')).toBeTruthy();
    });

    it('renders the defaultMessage for ids missing from the catalog', () => {
        render(<StableText id="no.such.message" defaultMessage="Shown Fallback" />);
        expect(screen.getByText('Shown Fallback')).toBeTruthy();
    });

    it('renders the raw id for unknown ids without a defaultMessage', () => {
        const { container } = render(<StableText id="no.such.message" />);
        expect(container.textContent).toBe('no.such.message');
    });
});
