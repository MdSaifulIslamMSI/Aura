import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const stableFns = vi.hoisted(() => ({
  t: (_key, _opts, fallback) => fallback,
  formatNumber: (value) => String(value),
  formatPrice: (value) => `Rs.${value}`,
  translateText: (text) => text,
}));

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({
    t: stableFns.t,
    formatNumber: stableFns.formatNumber,
    formatPrice: stableFns.formatPrice,
  }),
}));

vi.mock('@/services/api', () => ({
  productApi: {
    searchProducts: vi.fn(async () => ({ products: [] })),
    getProducts: vi.fn(async () => ({ products: [] })),
    trackSearchClick: vi.fn(),
  },
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: (t) => t,
}));

vi.mock('@/hooks/useDynamicTranslations', () => ({
  useDynamicTranslations: () => ({ translateText: stableFns.translateText }),
}));

vi.mock('@/components/ui/premium-select', () => ({
  default: ({ value, onChange, children, ...rest }) => (
    <select data-testid="premium-select" value={value} onChange={(event) => onChange?.(event)} {...rest}>
      {children}
    </select>
  ),
}));

import GlobalSearchBar from './GlobalSearchBar';

const renderBar = (props = {}) => render(
  <MemoryRouter>
    <GlobalSearchBar {...props} />
  </MemoryRouter>
);

describe('GlobalSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('renders the global search input', () => {
    renderBar();
    expect(screen.getByPlaceholderText('Search products, brands, and live deals')).toBeInTheDocument();
  });

  it('navigates to scoped search URLs on submit', () => {
    const onNavigate = vi.fn();
    renderBar({ onNavigate });
    const input = screen.getByPlaceholderText('Search products, brands, and live deals');
    fireEvent.change(input, { target: { value: 'wireless earbuds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search now' }));
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('/search?q=wireless+earbuds'));
  });

  it('persists submitted queries to history', () => {
    renderBar({ onNavigate: vi.fn() });
    const input = screen.getByPlaceholderText('Search products, brands, and live deals');
    fireEvent.change(input, { target: { value: 'air fryer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search now' }));
    expect(window.localStorage.getItem('aura_global_search_history')).toContain('air fryer');
  });

  it('clears the query via the clear control', () => {
    renderBar();
    const input = screen.getByPlaceholderText('Search products, brands, and live deals');
    fireEvent.change(input, { target: { value: 'drone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
  });

  it('shows trending queries for empty input focus', () => {
    renderBar();
    fireEvent.focus(screen.getByPlaceholderText('Search products, brands, and live deals'));
    expect(screen.getByText('gaming laptop')).toBeInTheDocument();
  });
});
