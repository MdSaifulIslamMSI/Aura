import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContext } from 'react';
import { CartContext, CartProvider } from './CartContext';
import { AuthContext } from './AuthContext';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return actual;
});

import { userApi } from '../services/api';

const CartProbe = () => {
  const cart = useContext(CartContext);
  return (
    <div>
      <div data-testid="item-count">{String(cart.cartItems.length)}</div>
      <div data-testid="item-ids">{cart.cartItems.map((item) => String(item.id)).join(',')}</div>
    </div>
  );
};

const renderCartProvider = (currentUser) => render(
  <AuthContext.Provider value={{ currentUser }}>
    <CartProvider>
      <CartProbe />
    </CartProvider>
  </AuthContext.Provider>
);

describe('CartProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('uses server cart as the source of truth for authenticated refreshes', async () => {
    localStorage.setItem('aura_cart_user-1', JSON.stringify([
      { id: 101, title: 'Stale Phone', quantity: 1, stock: 5, price: 99 },
    ]));

    vi.spyOn(userApi, 'getProfile').mockResolvedValue({ cart: [] });
    vi.spyOn(userApi, 'syncCart').mockResolvedValue([]);

    renderCartProvider({ uid: 'user-1', email: 'user@example.com' });

    await waitFor(() => {
      expect(userApi.getProfile).toHaveBeenCalledWith({ force: true, cacheMs: 0 });
      expect(screen.getByTestId('item-count')).toHaveTextContent('0');
    });

    expect(userApi.syncCart).not.toHaveBeenCalled();
    expect(localStorage.getItem('aura_cart_user-1')).toBe('[]');
  });

  it('merges guest cart once when a user signs in', async () => {
    localStorage.setItem('aura_cart_guest', JSON.stringify([
      { id: 202, title: 'Guest Laptop', quantity: 1, stock: 3, price: 1499 },
    ]));

    vi.spyOn(userApi, 'getProfile').mockResolvedValue({ cart: [] });
    vi.spyOn(userApi, 'syncCart').mockResolvedValue([
      { id: 202, title: 'Guest Laptop', quantity: 1, stock: 3, price: 1499 },
    ]);

    renderCartProvider({ uid: 'user-2', email: 'guestmerge@example.com' });

    await waitFor(() => {
      expect(userApi.syncCart).toHaveBeenCalledWith('guestmerge@example.com', [
        { id: 202, title: 'Guest Laptop', quantity: 1, stock: 3, price: 1499 },
      ]);
      expect(screen.getByTestId('item-ids')).toHaveTextContent('202');
    });

    expect(localStorage.getItem('aura_cart_guest')).toBeNull();
  });
});
