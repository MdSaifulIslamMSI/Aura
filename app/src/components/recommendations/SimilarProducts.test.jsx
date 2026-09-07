import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { recommendationApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  recommendationApi: { getSimilarProducts: vi.fn() },
}));

vi.mock('./ProductCarousel', () => ({
  default: ({ recommendations = [] }) => (
    <div data-testid="carousel">{recommendations.map((p) => p.id).join(',')}</div>
  ),
}));

import SimilarProducts from './SimilarProducts';

describe('SimilarProducts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches similar items for the product', async () => {
    recommendationApi.getSimilarProducts.mockResolvedValue({ recommendations: [{ id: 's-1' }] });
    render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><SimilarProducts productId="p-1" /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('carousel')).toHaveTextContent('s-1'));
    expect(recommendationApi.getSimilarProducts).toHaveBeenCalledWith('p-1', { limit: 8 });
  });

  it('hides the section on empty results', async () => {
    recommendationApi.getSimilarProducts.mockResolvedValue({ recommendations: [] });
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><SimilarProducts productId="p-1" /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('hides the section on API failure', async () => {
    recommendationApi.getSimilarProducts.mockRejectedValue(new Error('down'));
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><SimilarProducts productId="p-1" /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
