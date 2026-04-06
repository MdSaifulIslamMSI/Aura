import { useContext, useEffect } from 'react';
import { AuthContext } from './AuthContext';
import { CartProvider } from './CartContext';
import { WishlistProvider } from './WishlistContext';
import { useSocket } from './SocketContext';
import { initializeCommerceSync, useCommerceStore } from '../store/commerceStore';

export const CommerceProvider = ({ children }) => {
  const { currentUser, loading: isAuthLoading } = useContext(AuthContext);
  const { socket } = useSocket() || {};
  const bindAuthUser = useCommerceStore((state) => state.bindAuthUser);
  const hydrateCart = useCommerceStore((state) => state.hydrateCart);
  const hydrateWishlist = useCommerceStore((state) => state.hydrateWishlist);
  const receiveExternalSnapshot = useCommerceStore((state) => state.receiveExternalSnapshot);

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

  useEffect(() => {
    if (!socket || !currentUser?.uid) {
      return undefined;
    }

    const handleCartUpdated = (snapshot = {}) => {
      receiveExternalSnapshot(snapshot);
    };

    socket.on('cart.updated', handleCartUpdated);
    return () => {
      socket.off('cart.updated', handleCartUpdated);
    };
  }, [currentUser?.uid, receiveExternalSnapshot, socket]);

  useEffect(() => {
    if (isAuthLoading || !currentUser?.uid || typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const refreshCommerce = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void hydrateCart({ force: true });
      void hydrateWishlist({ force: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshCommerce();
      }
    };

    const intervalId = window.setInterval(() => {
      if (navigator.onLine === false || document.visibilityState === 'hidden') {
        return;
      }
      refreshCommerce();
    }, 30000);

    window.addEventListener('focus', refreshCommerce);
    window.addEventListener('online', refreshCommerce);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshCommerce);
      window.removeEventListener('online', refreshCommerce);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser?.uid, hydrateCart, hydrateWishlist, isAuthLoading]);

  return (
    <CartProvider>
      <WishlistProvider>{children}</WishlistProvider>
    </CartProvider>
  );
};
