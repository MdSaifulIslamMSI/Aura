import { createContext, useContext, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AuthContext } from './AuthContext';
import {
  initializeCommerceSync,
  selectCartItems,
  selectCartLoading,
  selectCartSummary,
  useCommerceStore,
} from '../store/commerceStore';

export const CartContext = createContext();

export const CartProvider = ({ children }) => {
  const { currentUser, loading: isAuthLoading } = useContext(AuthContext);
  const cartItems = useCommerceStore(useShallow(selectCartItems));
  const isLoading = useCommerceStore(selectCartLoading);
  const cartSummary = useCommerceStore(useShallow(selectCartSummary));
  const bindAuthUser = useCommerceStore((state) => state.bindAuthUser);
  const hydrateCart = useCommerceStore((state) => state.hydrateCart);
  const refreshIfStale = useCommerceStore((state) => state.refreshIfStale);
  const addItem = useCommerceStore((state) => state.addItem);
  const setQuantity = useCommerceStore((state) => state.setQuantity);
  const removeItem = useCommerceStore((state) => state.removeItem);
  const clearCartState = useCommerceStore((state) => state.clearCart);

  useEffect(() => {
    const cleanup = initializeCommerceSync();
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!currentUser?.uid && isAuthLoading) {
      return;
    }

    const authPayload = currentUser?.uid
      ? { uid: currentUser.uid, email: currentUser.email || '' }
      : null;

    bindAuthUser(authPayload).catch(() => {});
  }, [bindAuthUser, currentUser?.email, currentUser?.uid, isAuthLoading]);

  const moveToWishlist = (productId, wishlistCallback) => {
    const item = cartItems.find((entry) => entry.id === productId);
    if (!item || !wishlistCallback) return;

    wishlistCallback({
      id: item.id,
      title: item.title,
      brand: item.brand,
      price: item.price,
      originalPrice: item.originalPrice,
      discountPercentage: item.discountPercentage,
      image: item.image,
      stock: item.stock,
    });
    void removeItem(productId);
  };

  const value = useMemo(() => ({
    cartItems,
    isLoading,
    ...cartSummary,
    addToCart: addItem,
    removeFromCart: removeItem,
    updateQuantity: setQuantity,
    clearCart: () => clearCartState({ incrementRevision: Boolean(currentUser?.uid) }),
    moveToWishlist,
    refreshCartFromServer: (options = {}) => (
      options?.force === true
        ? hydrateCart({ force: true, mergeGuest: options?.mergeGuest === true })
        : refreshIfStale({ force: options?.force === true })
    ),
  }), [
    addItem,
    cartItems,
    cartSummary,
    clearCartState,
    currentUser?.uid,
    hydrateCart,
    isLoading,
    refreshIfStale,
    removeItem,
    setQuantity,
  ]);

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
};
