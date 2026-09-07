import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';

const stableFns = vi.hoisted(() => ({
  t: (_key, _opts, fallback) => fallback,
  formatPrice: (value) => `Rs.${value}`,
}));

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: stableFns.t, formatPrice: stableFns.formatPrice }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: () => stableFns.t,
}));

import StepReview from './StepReview';

const baseProps = (overrides = {}) => ({
  isActive: true,
  completed: false,
  contact: { name: 'Asha', phone: '+911234', email: 'a@example.com' },
  shippingAddress: { address: 'Street 1', city: 'Pune', postalCode: '411001', country: 'India' },
  deliveryOption: 'express',
  deliverySlot: { date: '2026-10-01', window: '12-3' },
  paymentMethod: 'UPI',
  quote: { totalPrice: 54999, baseAmount: 54999, baseCurrency: 'INR' },
  acceptedTerms: false,
  reviewError: '',
  isPlacingOrder: false,
  orderDisabled: false,
  onSetActive: vi.fn(),
  onAcceptedTermsChange: vi.fn(),
  onBack: vi.fn(),
  onPlaceOrder: vi.fn(),
  ...overrides,
});

const renderReview = (props) => render(
  <IntlProvider locale="en" defaultLocale="en">
    <StepReview {...props} />
  </IntlProvider>
);

describe('StepReview', () => {
  it('renders collapsed without the summary', () => {
    renderReview(baseProps({ isActive: false }));
    expect(screen.getByText('4. Review and Place Order')).toBeInTheDocument();
    expect(screen.queryByText('Asha')).toBeNull();
  });

  it('summarizes contact, address, delivery and payment', () => {
    renderReview(baseProps());
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('Street 1')).toBeInTheDocument();
    expect(screen.getByText('express')).toBeInTheDocument();
    expect(screen.getByText('UPI')).toBeInTheDocument();
    expect(screen.getByText(/54,999/)).toBeInTheDocument();
  });

  it('shows dashes for missing contact fields', () => {
    renderReview(baseProps({ contact: {} }));
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('toggles terms acceptance through the callback', () => {
    const props = baseProps();
    renderReview(props);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(props.onAcceptedTermsChange).toHaveBeenCalledWith(true);
  });

  it('places the order and navigates back', () => {
    const props = baseProps({ acceptedTerms: true });
    renderReview(props);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(props.onBack).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(props.onPlaceOrder).toHaveBeenCalledOnce();
  });

  it('disables ordering while placing or paused', () => {
    const { rerender } = renderReview(baseProps({ isPlacingOrder: true }));
    expect(screen.getByRole('button', { name: 'Placing Order...' })).toBeDisabled();
    rerender(
      <IntlProvider locale="en" defaultLocale="en">
        <StepReview {...baseProps({ orderDisabled: true })} />
      </IntlProvider>
    );
    expect(screen.getByRole('button', { name: 'Order Placement Paused' })).toBeDisabled();
  });

  it('surfaces review errors', () => {
    renderReview(baseProps({ reviewError: 'Quote expired' }));
    expect(screen.getByText('Quote expired')).toBeInTheDocument();
  });
});
