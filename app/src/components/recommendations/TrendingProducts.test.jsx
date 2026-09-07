import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { recommendationApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  recommendationApi: { getTrendingProducts: vi.fn() },
}));

vi.mock('./ProductCarousel', () => ({
  default: ({ recommendations = [] }) => (
    <div data-testid="carousel">{recommendations.map((p) => p.id).join(',')}</div>
  ),
}));

import TrendingProducts from './TrendingProducts';

describe('TrendingProducts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches trending picks with the limit', async () => {
    recommendationApi.getTrendingProducts.mockResolvedValue({ recommendations: [{ id: 't-1' }] });
    render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><TrendingProducts limit={3} /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('carousel')).toHaveTextContent('t-1'));
    expect(recommendationApi.getTrendingProducts).toHaveBeenCalledWith({ limit: 3 });
  });

  it('hides the section when nothing trends', async () => {
    recommendationApi.getTrendingProducts.mockResolvedValue({ recommendations: [] });
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><TrendingProducts /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('hides the section on API failure', async () => {
    recommendationApi.getTrendingProducts.mockRejectedValue(new Error('down'));
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><TrendingProducts /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
