import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from './AuthContext';
import { CommerceProvider } from './CommerceContext';
import { resetCommerceStoreForTests, useCommerceStore } from '../store/commerceStore';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return actual;
});

import { userApi } from '../services/api';

describe('CommerceProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    resetCommerceStoreForTests();
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
});
