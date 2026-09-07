import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { recommendationApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  recommendationApi: { getHomeRecommendations: vi.fn() },
}));

vi.mock('./ProductCarousel', () => ({
  default: ({ recommendations = [] }) => (
    <div data-testid="carousel">{recommendations.map((p) => p.id).join(',')}</div>
  ),
}));

import RecommendedForYou from './RecommendedForYou';

describe('RecommendedForYou', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches home picks with the limit', async () => {
    recommendationApi.getHomeRecommendations.mockResolvedValue({ recommendations: [{ id: 'h-1' }] });
    render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><RecommendedForYou limit={4} /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('carousel')).toHaveTextContent('h-1'));
    expect(recommendationApi.getHomeRecommendations).toHaveBeenCalledWith({ limit: 4 });
  });

  it('hides the section when empty', async () => {
    recommendationApi.getHomeRecommendations.mockResolvedValue({ recommendations: [] });
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><RecommendedForYou /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('hides the section on API failure', async () => {
    recommendationApi.getHomeRecommendations.mockRejectedValue(new Error('down'));
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><RecommendedForYou /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
