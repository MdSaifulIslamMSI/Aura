import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const stableFns = vi.hoisted(() => ({
  t: (_key, _opts, fallback) => fallback,
  formatPrice: (value) => `Rs.${value}`,
}));

vi.mock('@/context/AuthContext', async () => {
  const React = await import('react');
  return { AuthContext: React.createContext({}) };
});

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: stableFns.t, formatPrice: stableFns.formatPrice }),
}));

vi.mock('@/services/api', () => ({
  priceAlertApi: { getMyAlerts: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: () => stableFns.t,
}));

import { AuthContext } from '@/context/AuthContext';
import { priceAlertApi } from '@/services/api';
import PriceAlerts from './index';

const renderAlerts = () => render(
  <MemoryRouter>
    <AuthContext.Provider value={{ currentUser: { _id: 'u-1' } }}>
      <PriceAlerts />
    </AuthContext.Provider>
  </MemoryRouter>
);

describe('PriceAlerts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the hero and fetches the caller alerts', async () => {
    priceAlertApi.getMyAlerts.mockResolvedValue({ alerts: [] });
    renderAlerts();
    expect(screen.getByText('Price Alerts')).toBeInTheDocument();
    await waitFor(() => expect(priceAlertApi.getMyAlerts).toHaveBeenCalledOnce());
  });

  it('lists active alerts with target prices', async () => {
    priceAlertApi.getMyAlerts.mockResolvedValue({
      alerts: [{ _id: 'a-1', productId: 'p-1', productTitle: 'Phone', targetPrice: 40000, currentPrice: 45000, isActive: true, triggered: false }],
    });
    renderAlerts();
    await waitFor(() => expect(screen.getByText('Phone')).toBeInTheDocument());
  });

  it('shows the empty state when no alerts exist', async () => {
    priceAlertApi.getMyAlerts.mockResolvedValue({ alerts: [] });
    renderAlerts();
    await waitFor(() => expect(screen.getByText('No active alerts')).toBeInTheDocument());
  });

  it('fails safe to the empty state when loading fails', async () => {
    priceAlertApi.getMyAlerts.mockRejectedValue(new Error('service down'));
    renderAlerts();
    await waitFor(() => expect(screen.getByText('No active alerts')).toBeInTheDocument());
  });

  it('deletes alerts and removes them from the list', async () => {
    priceAlertApi.getMyAlerts.mockResolvedValue({
      alerts: [{ _id: 'a-1', productId: 'p-1', productTitle: 'Phone', targetPrice: 40000, currentPrice: 45000, isActive: true, triggered: false }],
    });
    priceAlertApi.delete.mockResolvedValue({});
    renderAlerts();
    await waitFor(() => expect(screen.getByText('Phone')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete alert' }));
    await waitFor(() => expect(priceAlertApi.delete).toHaveBeenCalledWith('a-1'));
    await waitFor(() => expect(screen.queryByText('Phone')).toBeNull());
  });
});
