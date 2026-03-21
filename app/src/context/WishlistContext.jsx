import { createContext, useState, useEffect, useCallback, useContext, useRef } from 'react';
import { AuthContext } from './AuthContext';
import { userApi } from '../services/api';

export const WishlistContext = createContext();

const GUEST_KEY = 'aura_wishlist_guest';
const userKey = (uid) => `aura_wishlist_${uid}`;
const parseWishlistSnapshot = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const WishlistProvider = ({ children }) => {
  const [wishlistItems, setWishlistItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { currentUser } = useContext(AuthContext);
  const prevUserRef = useRef(null);

  // ── On mount OR user change: load the correct user's wishlist ──
  useEffect(() => {
    const uid = currentUser?.uid;
    const prevUid = prevUserRef.current;

    // User LOGGED OUT → clear
    if (!uid && prevUid) {
      setWishlistItems([]);
      localStorage.setItem(GUEST_KEY, JSON.stringify([]));
      prevUserRef.current = null;
      setIsLoading(false);
      return;
    }

    // User LOGGED IN → load their wishlist
    if (uid) {
      prevUserRef.current = uid;

      const stored = localStorage.getItem(userKey(uid));
      if (stored) {
        setWishlistItems(parseWishlistSnapshot(stored));
      }

      // Backend is source of truth
      userApi.getProfile({ firebaseUser: currentUser })
        .then(data => {
          if (data.wishlist) {
            const backendIds = new Set(data.wishlist.map(i => i.id));
            const localOnly = parseWishlistSnapshot(stored).filter(i => !backendIds.has(i.id));
            const merged = [...data.wishlist, ...localOnly];
            setWishlistItems(merged);
            if (localOnly.length > 0) {
              userApi.syncWishlist(merged, { firebaseUser: currentUser }).catch(() => { });
            }
          }
        })
        .catch(err => console.error("Wishlist fetch failed:", err))
        .finally(() => setIsLoading(false));
      return;
    }

    // Guest
    const stored = localStorage.getItem(GUEST_KEY);
    if (stored) {
      setWishlistItems(parseWishlistSnapshot(stored));
    }
    setIsLoading(false);
  }, [currentUser]);

  const syncTimerRef = useRef(null);

  // ── Persist to localStorage + debounced backend sync ──
  useEffect(() => {
    if (isLoading) return;

    const uid = currentUser?.uid;
    const key = uid ? userKey(uid) : GUEST_KEY;
    localStorage.setItem(key, JSON.stringify(wishlistItems));

    if (uid) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        userApi.syncWishlist(wishlistItems, { firebaseUser: currentUser })
          .catch(err => console.error("Cloud sync failed:", err));
      }, 2000); // 2s debounce
    }

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [wishlistItems, isLoading, currentUser]);

  const addToWishlist = useCallback((product) => {
    setWishlistItems((prev) => {
      const exists = prev.some((item) => item.id === product.id);
      if (exists) return prev;

      return [
        ...prev,
        {
          id: product.id,
          title: product.title,
          brand: product.brand,
          price: product.price,
          originalPrice: product.originalPrice,
          discountPercentage: product.discountPercentage,
          image: product.image,
          stock: product.stock,
          rating: product.rating,
          ratingCount: product.ratingCount,
          addedAt: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const removeFromWishlist = useCallback((productId) => {
    setWishlistItems((prev) => prev.filter((item) => item.id !== productId));
  }, []);

  const toggleWishlist = useCallback((product) => {
    const exists = wishlistItems.some((item) => item.id === product.id);

    if (exists) {
      removeFromWishlist(product.id);
      return false;
    } else {
      addToWishlist(product);
      return true;
    }
  }, [wishlistItems, addToWishlist, removeFromWishlist]);

  const isInWishlist = useCallback((productId) => {
    return wishlistItems.some((item) => item.id === productId);
  }, [wishlistItems]);

  const clearWishlist = useCallback(() => {
    setWishlistItems([]);
  }, []);

  const moveToCart = useCallback((productId, cartCallback) => {
    const item = wishlistItems.find((item) => item.id === productId);
    if (item && cartCallback) {
      cartCallback({
        id: item.id,
        title: item.title,
        brand: item.brand,
        price: item.price,
        originalPrice: item.originalPrice,
        discountPercentage: item.discountPercentage,
        image: item.image,
        stock: item.stock,
      });
      removeFromWishlist(productId);
    }
  }, [wishlistItems, removeFromWishlist]);

  const value = {
    wishlistItems,
    isLoading,
    itemCount: wishlistItems.length,
    addToWishlist,
    removeFromWishlist,
    toggleWishlist,
    isInWishlist,
    clearWishlist,
    moveToCart,
  };

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
};
