import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { IntlProvider } from 'react-intl';

const stableFns = vi.hoisted(() => ({
  t: (_key, _opts, fallback) => fallback,
  formatPrice: (value) => `Rs.${value}`,
}));

vi.mock('@/context/CartContext', async () => {
  const React = await import('react');
  return { CartContext: React.createContext({}) };
});

vi.mock('@/context/EmergencyStatusContext', () => ({
  useEmergencyStatus: () => ({ isFeatureDisabled: () => false, readOnly: false }),
}));

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: stableFns.t, formatPrice: stableFns.formatPrice }),
}));

vi.mock('@/store/commerceStore', () => ({
  useCommerceStore: (selector) => selector({ clearDirectBuy: vi.fn() }),
}));

vi.mock('@/components/recommendations', () => ({
  CartRecommendations: () => <div data-testid="cart-recs" />,
}));

vi.mock('@/services/api', () => ({
  trackRecommendationEvent: vi.fn(),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: () => stableFns.t,
}));

import { CartContext } from '@/context/CartContext';
import Cart from './index';

const item = { id: 'p-1', title: 'Aura Phone', price: 50000, quantity: 2, stock: 9, category: 'Phones' };

const renderCart = (value) => render(
  <MemoryRouter>
    <IntlProvider locale="en" defaultLocale="en">
      <CartContext.Provider value={value}>
        <Cart />
      </CartContext.Provider>
    </IntlProvider>
  </MemoryRouter>
);

const loadedValue = (overrides = {}) => ({
  cartItems: [item],
  removeFromCart: vi.fn(),
  updateQuantity: vi.fn(),
  moveToWishlist: vi.fn(),
  isLoading: false,
  ...overrides,
});

describe('Cart page', () => {
  it('shows the hydration screen while loading an empty cart', () => {
    renderCart(loadedValue({ cartItems: [], isLoading: true }));
    expect(screen.getByText(/Syncing your latest cart state/)).toBeInTheDocument();
  });

  it('shows the empty state with a home link', () => {
    const { container } = renderCart(loadedValue({ cartItems: [] }));
    expect(screen.getByText(/couldn't find any items/)).toBeInTheDocument();
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
  });

  it('renders items with totals and recommendations', () => {
    renderCart(loadedValue());
    expect(screen.getByText('Aura Phone')).toBeInTheDocument();
    expect(screen.getByTestId('cart-recs')).toBeInTheDocument();
    expect(screen.getByText(/Secure Encrypted Checkout/)).toBeInTheDocument();
  });

  it('adjusts quantities through the cart controls', () => {
    const value = loadedValue();
    renderCart(value);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity for {{title}}' }));
    expect(value.updateQuantity).toHaveBeenCalledWith('p-1', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity for {{title}}' }));
    expect(value.updateQuantity).toHaveBeenCalledWith('p-1', 3);
  });

  it('saves items to the wishlist and removes them from the bag', () => {
    const value = loadedValue();
    renderCart(value);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(value.moveToWishlist).toHaveBeenCalledWith('p-1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from cart' }));
    expect(value.removeFromCart).toHaveBeenCalledWith('p-1');
  });

  it('proceeds to checkout when allowed', () => {
    renderCart(loadedValue());
    const proceed = screen.getByRole('button', { name: /proceed to checkout|checkout/i });
    fireEvent.click(proceed);
    expect(proceed).toBeInTheDocument();
  });
});
