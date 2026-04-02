import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContext } from 'react';
import { AuthContext } from './AuthContext';
import { CommerceProvider } from './CommerceContext';
import { WishlistContext } from './WishlistContext';
import { GUEST_WISHLIST_STORAGE_KEY, resetCommerceStoreForTests } from '../store/commerceStore';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return actual;
});

import { userApi } from '../services/api';

const WishlistProbe = () => {
  const wishlist = useContext(WishlistContext);
  return (
    <div>
      <div data-testid="is-loading">{String(wishlist.isLoading)}</div>
      <div data-testid="item-count">{String(wishlist.itemCount)}</div>
      <div data-testid="item-ids">{wishlist.wishlistItems.map((item) => String(item.id)).join(',')}</div>
      <div data-testid="has-303">{String(wishlist.isInWishlist(303))}</div>
    </div>
  );
};

const renderWishlistProvider = (authValue) => render(
  <AuthContext.Provider value={authValue}>
    <CommerceProvider>
      <WishlistProbe />
    </CommerceProvider>
  </AuthContext.Provider>
);

describe('WishlistProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    resetCommerceStoreForTests();
  });

  it('uses server wishlist as the source of truth for authenticated refreshes', async () => {
    vi.spyOn(userApi, 'getCart').mockResolvedValue({
      items: [],
      revision: 0,
      syncedAt: null,
    });
    vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
      items: [
        { id: 303, title: 'Aura Speaker', price: 1499, image: '/speaker.png', stock: 8 },
      ],
      revision: 6,
      syncedAt: null,
    });
    const mergeWishlistSpy = vi.spyOn(userApi, 'mergeWishlist').mockResolvedValue({
      items: [],
      revision: 6,
      syncedAt: null,
    });

    renderWishlistProvider({ currentUser: { uid: 'user-1', email: 'user@example.com' }, loading: false });

    await waitFor(() => {
      expect(userApi.getWishlist).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('item-count')).toHaveTextContent('1');
      expect(screen.getByTestId('item-ids')).toHaveTextContent('303');
      expect(screen.getByTestId('has-303')).toHaveTextContent('true');
    });

    expect(mergeWishlistSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(GUEST_WISHLIST_STORAGE_KEY)).toBeNull();
  });
});
