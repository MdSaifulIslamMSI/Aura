import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { visualSearchMock } = vi.hoisted(() => ({
  visualSearchMock: vi.fn(),
}));

let mockLocale = 'en';
const formatPriceMock = vi.fn((amount) => `$${Number(amount || 0).toFixed(2)}`);
const stableTMock = (_key, _values, fallback) => fallback || _key;
const marketMock = {
  get locale() {
    return mockLocale;
  },
  formatPrice: formatPriceMock,
  t: stableTMock,
};

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => marketMock,
}));

vi.mock('@/services/api', () => ({
  productApi: {
    visualSearch: visualSearchMock,
  },
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: (legacyT) => (typeof legacyT === 'function' ? legacyT : (_id, _values, fallback = '') => fallback),
}));

import VisualSearch from './index';

const renderVisualSearch = (locale = 'en', messages = {}) => {
  mockLocale = locale;
  return render(
    <IntlProvider locale={locale} messages={messages}>
      <MemoryRouter>
        <VisualSearch />
      </MemoryRouter>
    </IntlProvider>
  );
};

describe('VisualSearch localization and match rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale = 'en';
  });

  it('renders localized ICU field labels, plural match options, and results summary', async () => {
    visualSearchMock.mockResolvedValue({
      querySignals: {
        tokens: ['oled', 'tablet'],
        derivedKeyword: 'oled tablet',
      },
      total: 1,
      matches: [
        {
          id: 'prod-1',
          title: 'Aura Slate Pro Tablet',
          brand: 'Aura',
          category: 'electronics',
          price: 45999,
          rating: 4.8,
          ratingCount: 240,
          visualConfidence: 0.94,
          authenticityHints: { verdict: 'likely_authentic', score: 91 },
          priceGap: { position: 'below', medianPrice: 51999, againstMedianAmount: -6000 },
          image: 'https://cdn.example.com/tablet.png',
        },
      ],
    });

    renderVisualSearch('en');

    expect(screen.getByText(/12\s+matches/i)).toBeInTheDocument();

    const urlInput = screen.getByPlaceholderText('https://.../product-image.jpg');
    fireEvent.change(urlInput, { target: { value: 'https://cdn.example.com/query.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: /run visual search/i }));

    await waitFor(() => expect(visualSearchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/1\s+matched product from live catalog/i)).toBeInTheDocument();
    expect(screen.getByText(/Likely Authentic\s+91%/i)).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('renders non-English Intl messages when active locale catalog supplies translations', async () => {
    visualSearchMock.mockRejectedValue(new Error(''));

    renderVisualSearch('hi', {
      'visualSearch.field.imageUrl': 'छवि URL',
      'visualSearch.error.searchFailed': 'विज़ुअल खोज विफल रही।',
      'visualSearch.limit.matchesCount': '{count, plural, one {# मिलान} other {# मिलान}}',
      'visualSearch.results.countSummary': '{count, plural, one {# मिलान उत्पाद मिला।} other {# मिलान उत्पाद मिले।}}',
    });

    expect(screen.getByText('छवि URL')).toBeInTheDocument();
    expect(screen.getByText(/12\s+मिलान/)).toBeInTheDocument();

    const urlInput = screen.getByPlaceholderText('https://.../product-image.jpg');
    fireEvent.change(urlInput, { target: { value: 'https://cdn.example.com/query.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: /run visual search/i }));

    await waitFor(() => {
      expect(screen.getByText('विज़ुअल खोज विफल रही।')).toBeInTheDocument();
    });
  });
});
