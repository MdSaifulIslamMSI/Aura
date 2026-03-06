import { readRecentlyViewed } from '@/utils/recentlyViewed';

const SEARCH_HISTORY_KEY = 'aura_global_search_history';

const CATEGORY_RULES = [
  { category: 'mobiles', pattern: /\bmobile|iphone|android|phone|galaxy|pixel|oneplus\b/i },
  { category: 'laptops', pattern: /\blaptop|macbook|notebook|ultrabook\b/i },
  { category: 'electronics', pattern: /\bearbuds|headphone|speaker|camera|tv|monitor|gadget|electronic\b/i },
  { category: "men's-fashion", pattern: /\bshirt|hoodie|jeans|men|mens|sneaker|jacket\b/i },
  { category: "women's-fashion", pattern: /\bdress|heels|handbag|women|womens|kurti|saree\b/i },
  { category: 'home-kitchen', pattern: /\bair fryer|blender|kitchen|home|furniture|mixer|cookware\b/i },
  { category: 'gaming', pattern: /\bgaming|console|controller|ps5|xbox|gpu\b/i },
  { category: 'books', pattern: /\bbook|novel|biography|exam|guide\b/i },
  { category: 'sports', pattern: /\bfootball|cricket|tennis|gym|sports|dumbbell|yoga\b/i },
];

const readSearchHistory = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const inferCategoryFromText = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return null;
  const matched = CATEGORY_RULES.find((rule) => rule.pattern.test(text));
  return matched?.category || null;
};

const pushWeightedCategory = (counter, category, weight) => {
  if (!category) return;
  counter.set(category, (counter.get(category) || 0) + weight);
};

const normalizeId = (item = {}) => String(item?.id || item?._id || '').trim();

export const buildRecommendationSignals = ({ cartItems = [], wishlistItems = [] } = {}) => {
  const recentItems = readRecentlyViewed();
  const searchHistory = readSearchHistory();
  const categoryWeights = new Map();
  const sourceLabels = [];

  cartItems.forEach((item) => pushWeightedCategory(categoryWeights, item?.category, 4));
  wishlistItems.forEach((item) => pushWeightedCategory(categoryWeights, item?.category, 3));
  recentItems.forEach((item) => pushWeightedCategory(categoryWeights, item?.category, 2));
  searchHistory.forEach((term) => pushWeightedCategory(categoryWeights, inferCategoryFromText(term), 1));

  if (cartItems.length > 0) sourceLabels.push('cart momentum');
  if (wishlistItems.length > 0) sourceLabels.push('wishlist signal');
  if (recentItems.length > 0) sourceLabels.push('recent browsing');
  if (searchHistory.length > 0) sourceLabels.push('search intent');

  const rankedCategories = [...categoryWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category)
    .slice(0, 2);

  const recentQueries = searchHistory.slice(0, 3);
  const excludeIds = new Set(
    [...cartItems, ...wishlistItems, ...recentItems]
      .map((item) => normalizeId(item))
      .filter(Boolean)
  );

  const isColdStart = rankedCategories.length === 0 && recentQueries.length === 0;
  const primaryCategory = rankedCategories[0] || null;

  let eyebrow = 'Intent-Based Recommendations';
  let title = 'Curated for Your Next Move';
  let description = 'This lane is ranked from what you added, saved, viewed, and searched.';

  if (cartItems.length > 0 && primaryCategory) {
    eyebrow = 'Cart Momentum';
    title = `Keep building your ${primaryCategory.replace(/-/g, ' ')} stack`;
    description = 'These picks reinforce what is already converting in your basket and shorten the next decision.';
  } else if (wishlistItems.length > 0 && primaryCategory) {
    eyebrow = 'Wishlist Signal';
    title = `More from your ${primaryCategory.replace(/-/g, ' ')} watchlist`;
    description = 'This lane expands the products you already marked as high intent.';
  } else if (recentItems.length > 0) {
    eyebrow = 'Resume Discovery';
    title = 'Continue where your product research left off';
    description = 'These picks follow your recent product-detail visits so the session does not reset to zero.';
  } else if (recentQueries.length > 0) {
    eyebrow = 'Search Intent';
    title = `Results shaped around "${recentQueries[0]}"`;
    description = 'Your recent search behavior is steering this lane, even before you add anything to cart.';
  } else if (isColdStart) {
    eyebrow = 'Cold Start Picks';
    title = 'Start with high-confidence catalog winners';
    description = 'No personal signal yet, so this lane defaults to broad, high-trust discovery.';
  }

  return {
    recentItems,
    recentQueries,
    rankedCategories,
    primaryCategory,
    excludeIds,
    sourceLabels,
    isColdStart,
    eyebrow,
    title,
    description,
  };
};

