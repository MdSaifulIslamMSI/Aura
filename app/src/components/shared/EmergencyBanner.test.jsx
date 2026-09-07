import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ current: {} }));

vi.mock('@/context/EmergencyStatusContext', () => ({
  useEmergencyStatus: () => state.current,
}));

import EmergencyBanner from './EmergencyBanner';

describe('EmergencyBanner', () => {
  it('renders nothing when all clear', () => {
    state.current = {};
    const { container } = render(<EmergencyBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('prefers the explicit banner message', () => {
    state.current = { bannerMessage: 'Flood delay in region', maintenance: true, readOnly: true };
    render(<EmergencyBanner />);
    expect(screen.getByText('Flood delay in region')).toBeInTheDocument();
  });

  it('falls back to the maintenance message', () => {
    state.current = { maintenance: true };
    render(<EmergencyBanner />);
    expect(screen.getByText(/emergency maintenance/i)).toBeInTheDocument();
  });

  it('falls back to the read-only message', () => {
    state.current = { readOnly: true };
    render(<EmergencyBanner />);
    expect(screen.getByText(/read-only mode/i)).toBeInTheDocument();
  });

  it('renders the alert icon as decorative', () => {
    state.current = { readOnly: true };
    const { container } = render(<EmergencyBanner />);
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
