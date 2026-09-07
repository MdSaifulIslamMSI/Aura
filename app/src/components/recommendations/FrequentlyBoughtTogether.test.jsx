import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { recommendationApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  recommendationApi: { getFrequentlyBoughtTogether: vi.fn() },
}));

vi.mock('./ProductCarousel', () => ({
  default: ({ recommendations = [] }) => (
    <div data-testid="carousel">{recommendations.map((p) => p.id).join(',')}</div>
  ),
}));

import FrequentlyBoughtTogether from './FrequentlyBoughtTogether';

describe('FrequentlyBoughtTogether', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches by product id and renders items', async () => {
    recommendationApi.getFrequentlyBoughtTogether.mockResolvedValue({ recommendations: [{ id: 'p-1' }, { id: 'p-2' }] });
    render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><FrequentlyBoughtTogether productId="p-0" /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('carousel')).toHaveTextContent('p-1,p-2'));
    expect(recommendationApi.getFrequentlyBoughtTogether).toHaveBeenCalledWith('p-0', { limit: 6 });
    expect(screen.getByText('Frequently Bought Together')).toBeInTheDocument();
  });

  it('renders nothing without a product id', () => {
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><FrequentlyBoughtTogether productId={null} /></IntlProvider></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    expect(recommendationApi.getFrequentlyBoughtTogether).not.toHaveBeenCalled();
  });

  it('hides the section when the API fails', async () => {
    recommendationApi.getFrequentlyBoughtTogether.mockRejectedValue(new Error('down'));
    const { container } = render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><FrequentlyBoughtTogether productId="p-0" /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('forwards custom limits', async () => {
    recommendationApi.getFrequentlyBoughtTogether.mockResolvedValue({ recommendations: [] });
    render(<MemoryRouter><IntlProvider locale="en" defaultLocale="en"><FrequentlyBoughtTogether productId="p-0" limit={2} /></IntlProvider></MemoryRouter>);
    await waitFor(() => expect(recommendationApi.getFrequentlyBoughtTogether).toHaveBeenCalledWith('p-0', { limit: 2 }));
  });
});
