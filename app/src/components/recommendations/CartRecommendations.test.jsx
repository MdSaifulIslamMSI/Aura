import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { recommendationApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  recommendationApi: { getCartRecommendations: vi.fn() },
}));

vi.mock('./ProductCarousel', () => ({
  default: ({ recommendations = [] }) => (
    <div data-testid="carousel">{recommendations.map((p) => p.id).join(',')}</div>
  ),
}));

import CartRecommendations from './CartRecommendations';

describe('CartRecommendations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips empty carts without fetching', () => {
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><CartRecommendations cartItems={[]} /></IntlProvider></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    expect(recommendationApi.getCartRecommendations).not.toHaveBeenCalled();
  });

  it('compacts cart items and renders picks', async () => {
    recommendationApi.getCartRecommendations.mockResolvedValue({ recommendations: [{ id: 'c-1' }] });
    render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><CartRecommendations cartItems={[{ id: 'p-9', quantity: 0 }, { productId: '', quantity: 2 }]} /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('carousel')).toHaveTextContent('c-1'));
    expect(recommendationApi.getCartRecommendations).toHaveBeenCalledWith({
      cartItems: [{ productId: 'p-9', quantity: 1 }],
      limit: 8,
    });
  });

  it('hides the section on API failure', async () => {
    recommendationApi.getCartRecommendations.mockRejectedValue(new Error('down'));
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><CartRecommendations cartItems={[{ id: 'p-1' }]} /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
