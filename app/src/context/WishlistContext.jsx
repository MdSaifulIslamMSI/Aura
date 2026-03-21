import { createContext, useContext, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AuthContext } from './AuthContext';
import {
  initializeCommerceSync,
  selectWishlistItems,
  selectWishlistLoading,
  useCommerceStore,
} from '../store/commerceStore';

export const WishlistContext = createContext();

export const WishlistProvider = ({ children }) => {
  const { currentUser, loading: isAuthLoading } = useContext(AuthContext);
  const wishlistItems = useCommerceStore(useShallow(selectWishlistItems));
  const isLoading = useCommerceStore(selectWishlistLoading);
  const bindAuthUser = useCommerceStore((state) => state.bindAuthUser);
  const hydrateWishlist = useCommerceStore((state) => state.hydrateWishlist);
  const refreshWishlistIfStale = useCommerceStore((state) => state.refreshWishlistIfStale);
  const addWishlistItem = useCommerceStore((state) => state.addWishlistItem);
  const removeWishlistItem = useCommerceStore((state) => state.removeWishlistItem);
  const toggleWishlistItem = useCommerceStore((state) => state.toggleWishlistItem);
  const clearWishlistState = useCommerceStore((state) => state.clearWishlist);
  const moveWishlistItemToCart = useCommerceStore((state) => state.moveWishlistItemToCart);

  useEffect(() => {
    const cleanup = initializeCommerceSync();
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!currentUser?.uid && isAuthLoading) {
      return;
    }

    bindAuthUser(currentUser || null).catch(() => {});
  }, [bindAuthUser, currentUser?.email, currentUser?.uid, isAuthLoading]);

  const isInWishlist = (productId) => (
    wishlistItems.some((item) => Number(item.id) === Number(productId))
  );

  const moveToCart = (productId) => {
    void moveWishlistItemToCart(productId);
  };

  const value = useMemo(() => ({
    wishlistItems,
    isLoading,
    itemCount: wishlistItems.length,
    addToWishlist: addWishlistItem,
    removeFromWishlist: removeWishlistItem,
    toggleWishlist: toggleWishlistItem,
    isInWishlist,
    clearWishlist: clearWishlistState,
    moveToCart,
    refreshWishlistFromServer: (options = {}) => (
      options?.force === true
        ? hydrateWishlist({ force: true, mergeGuest: options?.mergeGuest === true })
        : refreshWishlistIfStale({ force: options?.force === true })
    ),
  }), [
    addWishlistItem,
    clearWishlistState,
    hydrateWishlist,
    moveWishlistItemToCart,
    moveToCart,
    isLoading,
    refreshWishlistIfStale,
    removeWishlistItem,
    toggleWishlistItem,
    wishlistItems,
  ]);

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
};
