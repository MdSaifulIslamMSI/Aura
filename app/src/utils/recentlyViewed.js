const RECENTLY_VIEWED_KEY = 'aura_recently_viewed_products';
const MAX_RECENTLY_VIEWED_ITEMS = 12;

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSnapshot = (product = {}) => {
  const id = product?.id || product?._id;
  if (!id) return null;

  return {
    id,
    title: product?.title || product?.name || 'Untitled product',
    brand: product?.brand || 'Aura',
    category: product?.category || 'General',
    image:
      product?.image ||
      (Array.isArray(product?.images) ? product.images[0] : '') ||
      'https://placehold.co/400x400/18181b/4ade80?text=No+Data',
    price: safeNumber(product?.price, 0),
    originalPrice: safeNumber(product?.originalPrice, safeNumber(product?.price, 0)),
    rating: safeNumber(product?.rating, 0),
    ratingCount: safeNumber(product?.ratingCount, 0),
    discountPercentage: safeNumber(product?.discountPercentage, 0),
    deliveryTime: product?.deliveryTime || '3-5 days',
    viewedAt: Date.now(),
  };
};

export const readRecentlyViewed = () => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(RECENTLY_VIEWED_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry) => entry && (entry.id || entry._id))
      .slice(0, MAX_RECENTLY_VIEWED_ITEMS);
  } catch {
    return [];
  }
};

export const pushRecentlyViewed = (product) => {
  if (typeof window === 'undefined') return [];

  const snapshot = normalizeSnapshot(product);
  if (!snapshot) return readRecentlyViewed();

  const existing = readRecentlyViewed();
  const deduped = [
    snapshot,
    ...existing.filter((entry) => String(entry.id || entry._id) !== String(snapshot.id)),
  ].slice(0, MAX_RECENTLY_VIEWED_ITEMS);

  try {
    window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(deduped));
  } catch {
    return existing;
  }

  return deduped;
};

export const clearRecentlyViewed = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENTLY_VIEWED_KEY);
  } catch {
    // ignore storage cleanup failures
  }
};

