import { useContext, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AuthContext } from './AuthContext';
import {
  createCommerceEntityContext,
  useDeferredStoreAction,
  useRefreshFromServer,
} from './commerceEntityContext';
import {
  selectCartItems,
  selectCartLoading,
  selectCartSummary,
  useCommerceStore,
} from '../store/commerceStore';

const useCartContextValue = ({ items: cartItems, isLoading }) => {
  const { currentUser } = useContext(AuthContext);
  const cartSummary = useCommerceStore(useShallow(selectCartSummary));
  const hydrateCart = useCommerceStore((state) => state.hydrateCart);
  const refreshIfStale = useCommerceStore((state) => state.refreshIfStale);
  const addItem = useCommerceStore((state) => state.addItem);
  const setQuantity = useCommerceStore((state) => state.setQuantity);
  const removeItem = useCommerceStore((state) => state.removeItem);
  const moveCartItemToWishlist = useCommerceStore((state) => state.moveCartItemToWishlist);
  const clearCartState = useCommerceStore((state) => state.clearCart);

  const moveToWishlist = useDeferredStoreAction(moveCartItemToWishlist);
  const refreshCartFromServer = useRefreshFromServer(hydrateCart, refreshIfStale);
  const clearCart = useMemo(() => (
    () => clearCartState({ incrementRevision: Boolean(currentUser?.uid) })
  ), [clearCartState, currentUser?.uid]);

  return useMemo(() => ({
    cartItems,
    isLoading,
    ...cartSummary,
    addToCart: addItem,
    removeFromCart: removeItem,
    updateQuantity: setQuantity,
    clearCart,
    moveToWishlist,
    refreshCartFromServer,
  }), [
    addItem,
    cartItems,
    cartSummary,
    clearCart,
    isLoading,
    moveToWishlist,
    refreshCartFromServer,
    removeItem,
    setQuantity,
  ]);
};

const cartEntity = createCommerceEntityContext({
  displayName: 'CartContext',
  selectItems: selectCartItems,
  selectLoading: selectCartLoading,
  useContextValue: useCartContextValue,
});

export const CartContext = cartEntity.Context;
export const CartProvider = cartEntity.Provider;
