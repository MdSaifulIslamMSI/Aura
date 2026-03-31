import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContext } from 'react';
import { CartContext, CartProvider } from './CartContext';
import { AuthContext } from './AuthContext';
import { GUEST_CART_STORAGE_KEY, resetCommerceStoreForTests, useCommerceStore } from '../store/commerceStore';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return actual;
});

import { userApi } from '../services/api';

const CartProbe = () => {
  const cart = useContext(CartContext);
  return (
    <div>
      <div data-testid="is-loading">{String(cart.isLoading)}</div>
      <div data-testid="item-count">{String(cart.cartItems.length)}</div>
      <div data-testid="item-ids">{cart.cartItems.map((item) => String(item.id)).join(',')}</div>
    </div>
  );
};

const renderCartProvider = (authValue) => render(
  <AuthContext.Provider value={authValue}>
    <CartProvider>
      <CartProbe />
    </CartProvider>
  </AuthContext.Provider>
);

describe('CartProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    resetCommerceStoreForTests();
  });

  it('uses server cart as the source of truth for authenticated refreshes', async () => {
    vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 3,
      syncedAt: null,
    });
    const mergeCartSpy = vi.spyOn(userApi, 'mergeCart').mockResolvedValue({
      items: [],
      revision: 3,
      syncedAt: null,
    });

    renderCartProvider({ currentUser: { uid: 'user-1', email: 'user@example.com' }, loading: false });

    await waitFor(() => {
      expect(userApi.getCart).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('item-count')).toHaveTextContent('0');
    });

    expect(mergeCartSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(GUEST_CART_STORAGE_KEY)).toBeNull();
  });

  it('merges guest cart once when a user signs in', async () => {
    localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify([
      { id: 202, title: 'Guest Laptop', quantity: 1, stock: 3, price: 1499 },
    ]));

    vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 4,
      syncedAt: null,
    });
    const mergeCartSpy = vi.spyOn(userApi, 'mergeCart').mockResolvedValue({
      items: [
        { id: 202, title: 'Guest Laptop', quantity: 1, stock: 3, price: 1499 },
      ],
      revision: 5,
      syncedAt: null,
    });

    renderCartProvider({ currentUser: { uid: 'user-2', email: 'guestmerge@example.com' }, loading: false });

    await waitFor(() => {
      expect(mergeCartSpy).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({ id: 202, quantity: 1 }),
        ],
        expectedRevision: 4,
      });
      expect(screen.getByTestId('item-ids')).toHaveTextContent('202');
    });

    expect(localStorage.getItem(GUEST_CART_STORAGE_KEY)).toBeNull();
  });

  it('keeps cart in loading state while auth bootstrap is unresolved', async () => {
    const getCartSpy = vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 1,
      syncedAt: null,
    });

    renderCartProvider({ currentUser: null, loading: true });

    expect(screen.getByTestId('is-loading')).toHaveTextContent('true');
    expect(getCartSpy).not.toHaveBeenCalled();
  });

  it('waits for auth bootstrap to settle before hydrating an authenticated cart', async () => {
    const getCartSpy = vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 2,
      syncedAt: null,
    });
    vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });

    const authUser = { uid: 'user-3', email: 'settled@example.com' };
    const view = renderCartProvider({ currentUser: authUser, loading: true });

    expect(getCartSpy).not.toHaveBeenCalled();

    view.rerender(
      <AuthContext.Provider value={{ currentUser: authUser, loading: false }}>
        <CartProvider>
          <CartProbe />
        </CartProvider>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(getCartSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('item-count')).toHaveTextContent('0');
    });
  });

  it('keeps recovered cart items visible while authenticated hydration is still in flight', async () => {
    useCommerceStore.setState({
      authUser: { uid: 'user-4', email: 'restore@example.com' },
      cart: {
        itemsById: {
          '404': {
            id: 404,
            title: 'Resume-safe Console',
            brand: 'Aura',
            price: 2999,
            originalPrice: 3499,
            discountPercentage: 14,
            image: '/console.png',
            stock: 5,
            deliveryTime: '1-2 days',
            quantity: 1,
          },
        },
        orderedIds: ['404'],
        revision: 6,
        status: 'ready',
        source: 'user',
        pendingOps: [],
        lastHydratedAt: Date.now(),
        syncedAt: '2026-04-01T00:20:00.000Z',
        error: null,
      },
    });

    await useCommerceStore.getState().bindAuthUser(null);

    vi.spyOn(userApi, 'getCart').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(userApi, 'getWishlist').mockImplementation(() => new Promise(() => {}));

    renderCartProvider({ currentUser: { uid: 'user-4', email: 'restore@example.com' }, loading: false });

    await waitFor(() => {
      expect(screen.getByTestId('item-ids')).toHaveTextContent('404');
      expect(screen.getByTestId('item-count')).toHaveTextContent('1');
      expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
    });
  });
});
