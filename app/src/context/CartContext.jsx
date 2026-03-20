import { createContext, useState, useEffect, useCallback, useContext, useRef } from 'react';
import { AuthContext } from './AuthContext';
import { userApi } from '../services/api';

export const CartContext = createContext();

const SYNC_DEBOUNCE_MS = 2000;
const GUEST_KEY = 'aura_cart_guest';
const userKey = (uid) => `aura_cart_${uid}`;

const readStoredCart = (key) => {
  const raw = localStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const mergeCartItems = (primaryItems = [], secondaryItems = []) => {
  const merged = [...primaryItems];
  const seenIds = new Set(primaryItems.map((item) => String(item?.id ?? '')));

  secondaryItems.forEach((item) => {
    const itemId = String(item?.id ?? '');
    if (!itemId || seenIds.has(itemId)) return;
    seenIds.add(itemId);
    merged.push(item);
  });

  return merged;
};

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { currentUser } = useContext(AuthContext);
  const syncTimerRef = useRef(null);
  const prevUserRef = useRef(null);
  const lastSyncedSignatureRef = useRef('[]');

  const refreshCartFromServer = useCallback(async ({ mergeGuest = false } = {}) => {
    const uid = currentUser?.uid;
    const email = currentUser?.email;
    if (!uid || !email) return [];

    const data = await userApi.getProfile({ force: true, cacheMs: 0 });
    const backendCart = Array.isArray(data?.cart) ? data.cart : [];

    let canonicalCart = backendCart;
    if (mergeGuest) {
      const guestCart = readStoredCart(GUEST_KEY);
      const mergedGuestCart = mergeCartItems(backendCart, guestCart);
      if (mergedGuestCart.length !== backendCart.length) {
        const syncedCart = await userApi.syncCart(email, mergedGuestCart);
        canonicalCart = Array.isArray(syncedCart) ? syncedCart : mergedGuestCart;
      }
      localStorage.removeItem(GUEST_KEY);
    }

    const serialized = JSON.stringify(canonicalCart);
    lastSyncedSignatureRef.current = serialized;
    localStorage.setItem(userKey(uid), serialized);
    setCartItems(canonicalCart);

    return canonicalCart;
  }, [currentUser]);

  useEffect(() => {
    const uid = currentUser?.uid;
    const prevUid = prevUserRef.current;

    if (!uid && prevUid) {
      setCartItems([]);
      localStorage.setItem(GUEST_KEY, JSON.stringify([]));
      prevUserRef.current = null;
      lastSyncedSignatureRef.current = '[]';
      setIsLoading(false);
      return;
    }

    if (uid) {
      prevUserRef.current = uid;

      const stored = readStoredCart(userKey(uid));
      if (stored.length > 0) {
        setCartItems(stored);
      }

      refreshCartFromServer({ mergeGuest: prevUid !== uid })
        .catch((err) => console.error('Cart fetch failed:', err))
        .finally(() => setIsLoading(false));
      return;
    }

    setCartItems(readStoredCart(GUEST_KEY));
    setIsLoading(false);
  }, [currentUser, refreshCartFromServer]);

  useEffect(() => {
    if (isLoading) return undefined;

    const uid = currentUser?.uid;
    const key = uid ? userKey(uid) : GUEST_KEY;
    const serializedCart = JSON.stringify(cartItems);
    localStorage.setItem(key, serializedCart);

    if (uid && currentUser?.email) {
      if (serializedCart === lastSyncedSignatureRef.current) {
        return undefined;
      }

      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        userApi.syncCart(currentUser.email, cartItems)
          .then(() => {
            lastSyncedSignatureRef.current = serializedCart;
          })
          .catch((err) => console.error('Cloud sync failed:', err));
      }, SYNC_DEBOUNCE_MS);
    }

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [cartItems, isLoading, currentUser]);

  useEffect(() => {
    if (!currentUser?.uid || typeof window === 'undefined') return undefined;

    const refreshVisibleCart = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      refreshCartFromServer().catch(() => { });
    };

    window.addEventListener('focus', refreshVisibleCart);
    window.addEventListener('pageshow', refreshVisibleCart);
    document.addEventListener('visibilitychange', refreshVisibleCart);

    return () => {
      window.removeEventListener('focus', refreshVisibleCart);
      window.removeEventListener('pageshow', refreshVisibleCart);
      document.removeEventListener('visibilitychange', refreshVisibleCart);
    };
  }, [currentUser?.uid, refreshCartFromServer]);

  const addToCart = useCallback((product, quantity = 1) => {
    setCartItems((prev) => {
      const existingItem = prev.find((item) => item.id === product.id);

      if (existingItem) {
        return prev.map((item) =>
          item.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + quantity, item.stock) }
            : item
        );
      }

      return [
        ...prev,
        {
          id: product.id,
          title: product.title,
          brand: product.brand,
          price: Number(product.price) || 0,
          originalPrice: Number(product.originalPrice) || Number(product.price) || 0,
          discountPercentage: Number(product.discountPercentage) || 0,
          image: product.image,
          stock: Number(product.stock) || 0,
          deliveryTime: product.deliveryTime || '2-3 days',
          quantity: Math.min(quantity, Number(product.stock) || 10),
        },
      ];
    });
  }, []);

  const removeFromCart = useCallback((productId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
  }, []);

  const updateQuantity = useCallback((productId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setCartItems((prev) =>
      prev.map((item) =>
        item.id === productId
          ? { ...item, quantity: Math.min(quantity, item.stock) }
          : item
      )
    );
  }, [removeFromCart]);

  const clearCart = useCallback(() => {
    setCartItems([]);
    lastSyncedSignatureRef.current = '[]';
    if (currentUser?.email) {
      userApi.syncCart(currentUser.email, []).catch((err) => console.error('Cloud cart clear failed:', err));
    }
  }, [currentUser]);

  const moveToWishlist = useCallback((productId, wishlistCallback) => {
    const item = cartItems.find((entry) => entry.id === productId);
    if (item && wishlistCallback) {
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
      removeFromCart(productId);
    }
  }, [cartItems, removeFromCart]);

  const cartSummary = cartItems.reduce((acc, item) => {
    const price = Number(item.price) || 0;
    const originalPrice = Number(item.originalPrice) || 0;
    const quantity = Number(item.quantity) || 1;

    const itemTotal = price * quantity;
    const itemOriginalTotal = originalPrice > price ? originalPrice * quantity : itemTotal;

    acc.totalPrice += itemTotal;
    acc.totalOriginalPrice += itemOriginalTotal;
    acc.totalDiscount += itemOriginalTotal - itemTotal;
    acc.totalItems += quantity;
    acc.itemCount += 1;

    return acc;
  }, {
    totalPrice: 0,
    totalOriginalPrice: 0,
    totalDiscount: 0,
    totalItems: 0,
    itemCount: 0,
  });

  const value = {
    cartItems,
    isLoading,
    ...cartSummary,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    moveToWishlist,
    refreshCartFromServer,
  };

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
};
