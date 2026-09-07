import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  toggleWishlist: vi.fn(),
  addToCart: vi.fn(),
  prefetchProductById: vi.fn(),
  trackRecommendationEvent: vi.fn(),
  trackSearchClick: vi.fn(),
  isInWishlist: vi.fn(() => false),
}));

vi.mock('@/context/WishlistContext', async () => {
  const React = await import('react');
  return {
    WishlistContext: React.createContext({
      toggleWishlist: mocks.toggleWishlist,
      get isInWishlist() { return mocks.isInWishlist; },
    }),
  };
});

vi.mock('@/context/CartContext', async () => {
  const React = await import('react');
  return { CartContext: React.createContext({ addToCart: mocks.addToCart }) };
});

vi.mock('@/context/ColorModeContext', () => ({
  useColorMode: () => ({ colorMode: 'midnight' }),
}));

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({
    t: (_key, _opts, fallback) => fallback,
    formatNumber: (value) => String(value),
    formatPrice: (value) => `Rs.${value}`,
  }),
}));

vi.mock('@/hooks/useDynamicTranslations', () => ({
  useDynamicTranslations: () => ({ translateText: (text) => text }),
}));

vi.mock('@/config/catalogTaxonomy', () => ({
  getLocalizedCategoryLabel: (category) => category,
}));

vi.mock('@/config/figmaTokens', () => ({
  FIGMA_COLOR_MODE_OPTIONS: [
    { value: 'midnight', primary: '#22d3ee', secondary: '#a78bfa', tertiary: '#34d399' },
  ],
}));

vi.mock('@/utils/pricing', () => ({
  getBaseAmount: (product) => Number(product?.price || 0),
  getBaseCurrency: () => 'INR',
  getOriginalBaseAmount: (product) => Number(product?.originalPrice || 0),
}));

vi.mock('@/services/api', () => ({
  productApi: {
    prefetchProductById: mocks.prefetchProductById,
    trackSearchClick: mocks.trackSearchClick,
  },
  trackRecommendationEvent: mocks.trackRecommendationEvent,
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: (t) => t,
}));

import ProductCard from './index';

const product = {
  id: 'p-101',
  title: 'Aura Focus Phone',
  brand: 'Aura',
  category: 'Phones',
  price: 54999,
  originalPrice: 59999,
  discountPercentage: 8,
  image: '/phone.png',
  rating: 4.5,
  ratingCount: 1248,
  stock: 8,
  deliveryTime: '2-3 days',
  highlights: ['AMOLED display'],
};

const renderCard = (props = {}) => render(
  <MemoryRouter>
    <ProductCard product={product} {...props} />
  </MemoryRouter>
);

describe('ProductCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInWishlist.mockReturnValue(false);
  });

  it('renders title, brand and price with discount', () => {
    renderCard();
    expect(screen.getByText('Aura Focus Phone')).toBeInTheDocument();
    expect(screen.getByText('Aura')).toBeInTheDocument();
    expect(screen.getByText('Rs.54999')).toBeInTheDocument();
    expect(screen.getByText(/8.*% off/i)).toBeInTheDocument();
  });

  it('links to the product detail page', () => {
    renderCard();
    expect(screen.getByTestId('product-card').getAttribute('href')).toBe('/product/p-101');
  });

  it('toggles the wishlist on heart-button click', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /add to wishlist/i }));
    expect(mocks.toggleWishlist).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-101' }));
    expect(mocks.trackRecommendationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'wishlist_add' })
    );
  });

  it('adds the product to the bag', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /add to bag/i }));
    expect(mocks.addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-101' }), 1);
  });

  it('fails closed when out of stock', () => {
    renderCard({ product: { ...product, stock: 0 } });
    expect(screen.getByText('Sold Out')).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /unavailable/i });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('shows the sponsored badge and tagline for sponsored products', () => {
    renderCard({
      product: { ...product, adCampaign: { isSponsored: true, creativeTagline: 'Festive pick' } },
    });
    expect(screen.getByText('Sponsored')).toBeInTheDocument();
    expect(screen.getByText('Festive pick')).toBeInTheDocument();
  });

  it('renders the deal DNA panel when deal signals exist', () => {
    renderCard({ product: { ...product, dealDna: { verdict: 'good_deal', score: 92 } } });
    expect(screen.getByText('Good Deal')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
  });

  it('prefetches the product on hover', () => {
    renderCard();
    fireEvent.mouseEnter(screen.getByTestId('product-card'));
    expect(mocks.prefetchProductById).toHaveBeenCalledWith('p-101');
  });
});
