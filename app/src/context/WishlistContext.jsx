import { useMemo } from 'react';
import {
  createCommerceEntityContext,
  useDeferredStoreAction,
  useRefreshFromServer,
} from './commerceEntityContext';
import {
  selectWishlistItems,
  selectWishlistLoading,
  useCommerceStore,
} from '../store/commerceStore';

const useWishlistContextValue = ({ items: wishlistItems, isLoading }) => {
  const hydrateWishlist = useCommerceStore((state) => state.hydrateWishlist);
  const refreshWishlistIfStale = useCommerceStore((state) => state.refreshWishlistIfStale);
  const addWishlistItem = useCommerceStore((state) => state.addWishlistItem);
  const removeWishlistItem = useCommerceStore((state) => state.removeWishlistItem);
  const toggleWishlistItem = useCommerceStore((state) => state.toggleWishlistItem);
  const clearWishlistState = useCommerceStore((state) => state.clearWishlist);
  const moveWishlistItemToCart = useCommerceStore((state) => state.moveWishlistItemToCart);

  const isInWishlist = useMemo(() => (
    (productId) => wishlistItems.some((item) => Number(item.id) === Number(productId))
  ), [wishlistItems]);
  const moveToCart = useDeferredStoreAction(moveWishlistItemToCart);
  const refreshWishlistFromServer = useRefreshFromServer(hydrateWishlist, refreshWishlistIfStale);

  return useMemo(() => ({
    wishlistItems,
    isLoading,
    itemCount: wishlistItems.length,
    addToWishlist: addWishlistItem,
    removeFromWishlist: removeWishlistItem,
    toggleWishlist: toggleWishlistItem,
    isInWishlist,
    clearWishlist: clearWishlistState,
    moveToCart,
    refreshWishlistFromServer,
  }), [
    addWishlistItem,
    clearWishlistState,
    isInWishlist,
    isLoading,
    moveToCart,
    refreshWishlistFromServer,
    removeWishlistItem,
    toggleWishlistItem,
    wishlistItems,
  ]);
};

const wishlistEntity = createCommerceEntityContext({
  displayName: 'WishlistContext',
  selectItems: selectWishlistItems,
  selectLoading: selectWishlistLoading,
  useContextValue: useWishlistContextValue,
});

export const WishlistContext = wishlistEntity.Context;
export const WishlistProvider = wishlistEntity.Provider;
