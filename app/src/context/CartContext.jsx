import { createContext, useState, useEffect, useCallback, useContext, useRef } from 'react';
import { AuthContext } from './AuthContext';
import { userApi } from '../services/api';

export const CartContext = createContext();

const SYNC_DEBOUNCE_MS = 2000;
const GUEST_KEY = 'aura_cart_guest';
const userKey = (uid) => `aura_cart_${uid}`;

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { currentUser } = useContext(AuthContext);
  const syncTimerRef = useRef(null);
  const prevUserRef = useRef(null); // Track previous user for logout detection

  const refreshCartFromServer = useCallback(async () => {
    const uid = currentUser?.uid;
    const email = currentUser?.email;
    if (!uid || !email) return [];

    const storedRaw = localStorage.getItem(userKey(uid));
    let localCart = [];
    if (storedRaw) {
      try {
        localCart = JSON.parse(storedRaw);
      } catch {
        localCart = [];
      }
    }

    const data = await userApi.getProfile(email);
    const backendCart = Array.isArray(data?.cart) ? data.cart : [];
    const backendIds = new Set(backendCart.map((item) => item.id));
    const localOnly = localCart.filter((item) => !backendIds.has(item.id));
    const merged = [...backendCart, ...localOnly];

    setCartItems(merged);
    if (localOnly.length > 0) {
      userApi.syncCart(email, merged).catch(() => { });
    }

    return merged;
  }, [currentUser]);

  // ── On mount OR user change: load the correct user's cart ──
  useEffect(() => {
    const uid = currentUser?.uid;
    const prevUid = prevUserRef.current;

    // User LOGGED OUT → clear in-memory cart + save guest as empty
    if (!uid && prevUid) {
      setCartItems([]);
      localStorage.setItem(GUEST_KEY, JSON.stringify([]));
      prevUserRef.current = null;
      setIsLoading(false);
      return;
    }

    // User LOGGED IN or still logged in → load their cart
    if (uid) {
      prevUserRef.current = uid;

      // First load from per-user localStorage (instant UI)
      const stored = localStorage.getItem(userKey(uid));
      if (stored) {
        try { setCartItems(JSON.parse(stored)); } catch { /* ignore */ }
      }

      // Then fetch from backend (source of truth) and REPLACE
      refreshCartFromServer()
        .catch(err => console.error("Cart fetch failed:", err))
        .finally(() => setIsLoading(false));
      return;
    }

    // No user (guest) → load guest cart
    const stored = localStorage.getItem(GUEST_KEY);
    if (stored) {
      try { setCartItems(JSON.parse(stored)); } catch { /* ignore */ }
    }
    setIsLoading(false);
  }, [currentUser, refreshCartFromServer]);

  // ── Persist to localStorage + debounced backend sync ──
  useEffect(() => {
    if (isLoading) return;

    const uid = currentUser?.uid;
    const key = uid ? userKey(uid) : GUEST_KEY;
    localStorage.setItem(key, JSON.stringify(cartItems));

    if (uid && currentUser?.email) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        userApi.syncCart(currentUser.email, cartItems)
          .catch(err => console.error("Cloud sync failed:", err));
      }, SYNC_DEBOUNCE_MS);
    }

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [cartItems, isLoading, currentUser]);

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
    if (currentUser?.email) {
      userApi.syncCart(currentUser.email, []).catch(err => console.error("Cloud cart clear failed:", err));
    }
  }, [currentUser]);

  const moveToWishlist = useCallback((productId, wishlistCallback) => {
    const item = cartItems.find((item) => item.id === productId);
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

  // Calculate totals
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
