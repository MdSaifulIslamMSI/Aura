import { describe, expect, it, beforeEach } from 'vitest';
import { buildRecommendationSignals } from './recommendationSignals';
import { pushRecentlyViewed } from './recentlyViewed';

const setSearchHistory = (terms) => {
  window.localStorage.setItem('aura_global_search_history', JSON.stringify(terms));
};

describe('buildRecommendationSignals', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reports cold start with default copy when no signal exists', () => {
    const signals = buildRecommendationSignals();
    expect(signals.isColdStart).toBe(true);
    expect(signals.rankedCategories).toEqual([]);
    expect(signals.eyebrow).toBe('Cold Start Picks');
    expect(signals.excludeIds.size).toBe(0);
  });

  it('ranks categories by weighted signals with cart momentum as the top copy', () => {
    setSearchHistory(['laptop bag']);
    const signals = buildRecommendationSignals({
      cartItems: [{ id: 'c1', category: 'laptops' }, { id: 'c2', category: 'laptops' }],
      wishlistItems: [{ id: 'w1', category: 'mobiles' }],
    });

    expect(signals.rankedCategories).toEqual(['laptops', 'mobiles']);
    expect(signals.primaryCategory).toBe('laptops');
    expect(signals.eyebrow).toBe('Cart Momentum');
    expect(signals.title).toBe('Keep building your laptops stack');
    expect(signals.sourceLabels).toEqual(['cart momentum', 'wishlist signal', 'search intent']);
    expect(signals.isColdStart).toBe(false);
  });

  it('falls back to the wishlist lane when the cart is empty', () => {
    const signals = buildRecommendationSignals({
      wishlistItems: [{ id: 'w1', category: 'gaming' }],
    });
    expect(signals.eyebrow).toBe('Wishlist Signal');
    expect(signals.primaryCategory).toBe('gaming');
  });

  it('switches to resume-discovery copy driven by recently viewed products', () => {
    pushRecentlyViewed({ id: 'r1', category: 'electronics' });
    const signals = buildRecommendationSignals();
    expect(signals.eyebrow).toBe('Resume Discovery');
    expect(signals.recentItems).toHaveLength(1);
    expect(signals.sourceLabels).toEqual(['recent browsing']);
  });

  it('uses search intent copy when only search history exists', () => {
    setSearchHistory(['football shoes', 'cricket bat']);
    const signals = buildRecommendationSignals();
    expect(signals.eyebrow).toBe('Search Intent');
    expect(signals.title).toBe('Results shaped around "football shoes"');
    expect(signals.recentQueries).toEqual(['football shoes', 'cricket bat']);
    expect(signals.rankedCategories).toEqual(['sports']);
  });

  it('infers categories from search terms only when no explicit category exists', () => {
    setSearchHistory(['iphone 15 deal']);
    const signals = buildRecommendationSignals();
    expect(signals.rankedCategories).toContain('mobiles');
  });

  it('excludes already-seen product ids from recommendations', () => {
    pushRecentlyViewed({ id: 'seen-1' });
    const signals = buildRecommendationSignals({
      cartItems: [{ id: 'cart-1' }],
      wishlistItems: [{ _id: 'wish-1' }],
    });
    expect([...signals.excludeIds].sort()).toEqual(['cart-1', 'seen-1', 'wish-1']);
  });

  it('ignores non-string search history entries', () => {
    setSearchHistory(['valid term', 42, null, { junk: true }]);
    const signals = buildRecommendationSignals();
    expect(signals.recentQueries).toEqual(['valid term']);
  });
});
