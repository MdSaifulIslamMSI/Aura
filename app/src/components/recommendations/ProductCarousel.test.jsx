import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import ProductCarousel from './ProductCarousel';

const product = (id) => ({ id, title: `Item ${id}`, brand: 'Aura', price: 999, stock: 5, rating: 4 });

const renderCarousel = (props = {}) => render(
  <MemoryRouter>
    <ProductCarousel recommendations={[product('p-1'), product('p-2')]} {...props} />
  </MemoryRouter>
);

describe('ProductCarousel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInWishlist.mockReturnValue(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders skeleton loaders while loading', () => {
    const { container } = renderCarousel({ recommendations: [], loading: true });
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the empty message when there is nothing to show', () => {
    renderCarousel({ recommendations: [] });
    expect(screen.getByText('No recommendations are available right now.')).toBeInTheDocument();
  });

  it('renders a card per recommendation', () => {
    renderCarousel();
    expect(screen.getByText('Item p-1')).toBeInTheDocument();
    expect(screen.getByText('Item p-2')).toBeInTheDocument();
  });

  it('shows reason badges when provided', () => {
    render(
      <MemoryRouter>
        <ProductCarousel recommendations={[{ ...product('p-9'), recommendationMeta: { reason: 'Bought together' } }]} />
      </MemoryRouter>
    );
    expect(screen.getByText('Bought together')).toBeInTheDocument();
  });

  it('drops entries without product ids', () => {
    render(
      <MemoryRouter>
        <ProductCarousel recommendations={[{ title: 'Ghost' }, { product: null }]} />
      </MemoryRouter>
    );
    expect(screen.getByText('No recommendations are available right now.')).toBeInTheDocument();
  });

  it('fires impression events after the dwell delay', async () => {
    renderCarousel({ sourcePage: 'cart' });
    expect(mocks.trackRecommendationEvent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(mocks.trackRecommendationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'recommendation_impression',
      productId: 'p-1',
      sourcePage: 'cart',
    }));
  });
});
