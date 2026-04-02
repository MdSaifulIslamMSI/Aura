import { useContext, useEffect } from 'react';
import { AuthContext } from './AuthContext';
import { CartProvider } from './CartContext';
import { WishlistProvider } from './WishlistContext';
import { initializeCommerceSync, useCommerceStore } from '../store/commerceStore';

export const CommerceProvider = ({ children }) => {
  const { currentUser, loading: isAuthLoading } = useContext(AuthContext);
  const bindAuthUser = useCommerceStore((state) => state.bindAuthUser);

  useEffect(() => {
    const cleanup = initializeCommerceSync();
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    bindAuthUser(currentUser || null).catch(() => {});
  }, [bindAuthUser, currentUser?.email, currentUser?.uid, isAuthLoading]);

  return (
    <CartProvider>
      <WishlistProvider>{children}</WishlistProvider>
    </CartProvider>
  );
};
