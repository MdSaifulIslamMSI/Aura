import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from './AuthContext';
import { CommerceProvider } from './CommerceContext';
import { resetCommerceStoreForTests, useCommerceStore } from '../store/commerceStore';

const socketHandlers = new Map();
const socketMock = {
  on: vi.fn((eventName, handler) => {
    socketHandlers.set(eventName, handler);
  }),
  off: vi.fn((eventName, handler) => {
    if (socketHandlers.get(eventName) === handler) {
      socketHandlers.delete(eventName);
    }
  }),
};

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return actual;
});

vi.mock('./SocketContext', () => ({
  useSocket: () => ({ socket: socketMock }),
}));

import { userApi } from '../services/api';

describe('CommerceProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    resetCommerceStoreForTests();
    socketHandlers.clear();
    socketMock.on.mockClear();
    socketMock.off.mockClear();
  });

  it('binds auth-backed commerce state once for the shared cart and wishlist tree', async () => {
    vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });
    vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });

    const originalBindAuthUser = useCommerceStore.getState().bindAuthUser;
    const bindAuthUserSpy = vi.fn((...args) => originalBindAuthUser(...args));
    useCommerceStore.setState({
      bindAuthUser: bindAuthUserSpy,
    });

    render(
      <AuthContext.Provider value={{ currentUser: { uid: 'user-1', email: 'user@example.com' }, loading: false }}>
        <CommerceProvider>
          <div>Commerce Ready</div>
        </CommerceProvider>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(bindAuthUserSpy).toHaveBeenCalledTimes(1);
      expect(bindAuthUserSpy).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 'user-1', email: 'user@example.com' })
      );
    });
  });

  it('applies authenticated cart updates pushed over the realtime socket', async () => {
    vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });
    vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });

    render(
      <AuthContext.Provider value={{ currentUser: { uid: 'user-1', email: 'user@example.com' }, loading: false }}>
        <CommerceProvider>
          <div>Commerce Ready</div>
        </CommerceProvider>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(socketMock.on).toHaveBeenCalledWith('cart.updated', expect.any(Function));
    });

    const handler = socketHandlers.get('cart.updated');
    expect(handler).toBeTypeOf('function');

    await act(async () => {
      handler({
        entity: 'cart',
        source: 'user',
        userId: 'user-1',
        items: [{
          productId: 991,
          quantity: 2,
          title: 'Realtime Headset',
          brand: 'Aura',
          price: 2999,
          originalPrice: 3499,
          discountPercentage: 14,
          image: '/headset.png',
          stock: 5,
        }],
        revision: 8,
        syncedAt: '2026-04-06T08:00:00.000Z',
      });
    });

    await waitFor(() => {
      expect(useCommerceStore.getState().cart.orderedIds).toEqual(['991']);
      expect(useCommerceStore.getState().cart.revision).toBe(8);
    });
  });

  it('refreshes authenticated commerce data when the app regains focus', async () => {
    vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });
    vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });

    render(
      <AuthContext.Provider value={{ currentUser: { uid: 'user-1', email: 'user@example.com' }, loading: false }}>
        <CommerceProvider>
          <div>Commerce Ready</div>
        </CommerceProvider>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(userApi.getCart).toHaveBeenCalledTimes(1);
      expect(userApi.getWishlist).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(userApi.getCart).toHaveBeenCalledTimes(2);
      expect(userApi.getWishlist).toHaveBeenCalledTimes(2);
    });
  });
});
