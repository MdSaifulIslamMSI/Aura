import { describe, expect, it } from 'vitest';
import {
  buildListingSearchParams,
  createFiltersFromParams,
  parseListingPage,
} from './index';

describe('ProductListing URL state', () => {
  it('restores listing filters and pagination from URL parameters', () => {
    const params = new URLSearchParams({
      minPrice: '1500',
      maxPrice: '75000',
      brand: 'Apple,Sony',
      categories: 'Electronics,Books',
      rating: '4',
      discount: '20',
      inStock: 'true',
      hasWarranty: 'true',
      minReviews: '500',
      deliveryTime: '1-2 days,3-5 days',
      page: '3',
    });

    expect(createFiltersFromParams(params)).toMatchObject({
      priceRange: [1500, 75000],
      brands: ['Apple', 'Sony'],
      categories: ['Electronics', 'Books'],
      minRating: 4,
      minDiscount: 20,
      inStockOnly: true,
      warrantyOnly: true,
      minReviews: 500,
      deliveryWindows: ['1-2 days', '3-5 days'],
    });
    expect(parseListingPage(params.get('page'))).toBe(3);
    expect(parseListingPage('invalid')).toBe(1);
  });

  it('round-trips changed UI state while preserving query, lane, and unrelated parameters', () => {
    const filters = createFiltersFromParams(new URLSearchParams({
      minPrice: '1500',
      maxPrice: '75000',
      brand: 'Apple,Sony',
      categories: 'Electronics,Books',
      rating: '4',
      discount: '20',
      inStock: 'true',
      hasWarranty: 'true',
      minReviews: '500',
      deliveryTime: '1-2 days,3-5 days',
    }));
    const current = new URLSearchParams({
      q: 'creator laptop',
      category: 'laptops',
      campaign: 'summer',
    });

    const next = buildListingSearchParams(current, {
      filters,
      sortBy: 'price-asc',
      page: 3,
      pathname: '/search',
    });

    expect(next.get('q')).toBe('creator laptop');
    expect(next.get('category')).toBe('laptops');
    expect(next.get('campaign')).toBe('summer');
    expect(next.get('brand')).toBe('Apple,Sony');
    expect(next.get('categories')).toBe('Electronics,Books');
    expect(next.get('rating')).toBe('4');
    expect(next.get('inStock')).toBe('true');
    expect(next.get('deliveryTime')).toBe('1-2 days,3-5 days');
    expect(next.get('sort')).toBe('price-asc');
    expect(next.get('page')).toBe('3');

    expect(createFiltersFromParams(next)).toMatchObject(filters);
    expect(parseListingPage(next.get('page'))).toBe(3);
  });

  it('removes only listing-owned defaults during reset serialization', () => {
    const current = new URLSearchParams({
      q: 'headphones',
      category: 'electronics',
      campaign: 'member',
      brand: 'Sony',
      categories: 'Electronics',
      rating: '4',
      inStock: 'true',
      deliveryTime: '1-2 days',
      sort: 'rating',
      page: '4',
    });

    const reset = buildListingSearchParams(current, {
      filters: createFiltersFromParams(new URLSearchParams()),
      sortBy: 'relevance',
      page: 1,
      pathname: '/search',
    });

    expect(reset.toString()).toBe('q=headphones&category=electronics&campaign=member');
  });
});
