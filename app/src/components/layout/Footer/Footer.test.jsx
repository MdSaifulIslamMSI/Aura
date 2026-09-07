import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: (_key, _opts, fallback) => fallback }),
}));

vi.mock('@/services/api', () => ({
  trustApi: { getHealthStatus: vi.fn() },
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: (t) => (typeof t === 'function' ? t : (_id, _values, fallback = '') => fallback),
}));

import { trustApi } from '@/services/api';
import Footer from './index';

const healthy = {
  backend: { status: 'ok', db: 'connected', uptime: 99, timestamp: '2026-09-01T00:00:00.000Z' },
  client: { online: true, secureContext: true, language: 'en', timezone: 'UTC' },
  derivedStatus: 'healthy',
};

const renderFooter = () => render(
  <MemoryRouter>
    <Footer />
  </MemoryRouter>
);

describe('Footer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders company, help and policy navigation', () => {
    renderFooter();
    for (const label of ['Contact Us', 'About Us', 'Payments', 'FAQ', 'Privacy', 'Terms Of Use']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('reflects healthy backend trust status', async () => {
    trustApi.getHealthStatus.mockResolvedValue(healthy);
    const { container } = renderFooter();
    await waitFor(() => expect(trustApi.getHealthStatus).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toContain('bg-emerald-500/15'));
  });

  it('downgrades to degraded styling on backend trouble', async () => {
    trustApi.getHealthStatus.mockResolvedValue({ ...healthy, derivedStatus: 'degraded' });
    const { container } = renderFooter();
    await waitFor(() => expect(container.innerHTML).toContain('bg-amber-500/15'));
  });

  it('keeps the checking state when the probe fails without prior signal', async () => {
    trustApi.getHealthStatus.mockRejectedValue(new Error('offline'));
    const { container } = renderFooter();
    await waitFor(() => expect(container.innerHTML).toContain('bg-slate-500/15'));
  });

  it('polls trust status on an interval and cleans up', async () => {
    vi.useFakeTimers();
    trustApi.getHealthStatus.mockResolvedValue(healthy);
    const { unmount } = renderFooter();
    expect(trustApi.getHealthStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(trustApi.getHealthStatus).toHaveBeenCalledTimes(2);
    unmount();
    vi.useRealTimers();
  });
});
