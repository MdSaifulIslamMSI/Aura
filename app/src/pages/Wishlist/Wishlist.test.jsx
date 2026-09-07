import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const stableFns = vi.hoisted(() => ({
  t: (_key, _opts, fallback) => fallback,
}));

vi.mock('@/context/WishlistContext', async () => {
  const React = await import('react');
  return { WishlistContext: React.createContext({}) };
});

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: stableFns.t }),
}));

vi.mock('@/components/features/product/ProductCard', () => ({
  default: ({ product }) => <div data-testid={`wish-card-${product.id}`}>{product.title}</div>,
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: () => stableFns.t,
}));

import { WishlistContext } from '@/context/WishlistContext';
import Wishlist from './index';

const renderWishlist = (value) => render(
  <MemoryRouter>
    <WishlistContext.Provider value={value}>
      <Wishlist />
    </WishlistContext.Provider>
  </MemoryRouter>
);

describe('Wishlist page', () => {
  it('shows the empty state when nothing is saved', () => {
    renderWishlist({ wishlistItems: [], removeFromWishlist: vi.fn(), moveToCart: vi.fn() });
    expect(screen.getByText('Your Wishlist is Empty')).toBeInTheDocument();
    expect(screen.getByText("You haven't saved any items yet.")).toBeInTheDocument();
  });

  it('renders the item count and a card per saved item', () => {
    renderWishlist({
      wishlistItems: [{ id: 'w-1', title: 'Saved Phone' }, { id: 'w-2', title: 'Saved Buds' }],
      removeFromWishlist: vi.fn(),
      moveToCart: vi.fn(),
    });
    expect(screen.getByTestId('wish-card-w-1')).toBeInTheDocument();
    expect(screen.getByTestId('wish-card-w-2')).toBeInTheDocument();
  });

  it('removes items via the remove control', () => {
    const removeFromWishlist = vi.fn();
    renderWishlist({
      wishlistItems: [{ id: 'w-1', title: 'Saved Phone' }],
      removeFromWishlist,
      moveToCart: vi.fn(),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove {{title}} from Wishlist' }));
    expect(removeFromWishlist).toHaveBeenCalledWith('w-1');
  });

  it('moves items to the bag', () => {
    const moveToCart = vi.fn();
    renderWishlist({
      wishlistItems: [{ id: 'w-1', title: 'Saved Phone' }],
      removeFromWishlist: vi.fn(),
      moveToCart,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Bag' }));
    expect(moveToCart).toHaveBeenCalledWith('w-1');
  });
});
