import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProductByIdMock, getProductsMock, compareMock } = vi.hoisted(() => ({
  getProductByIdMock: vi.fn(),
  getProductsMock: vi.fn(),
  compareMock: vi.fn(),
}));

const formatNumberMock = vi.fn((value) => `FMT:${Number(value || 0)}`);
const formatPriceMock = vi.fn((value) => `$${Number(value || 0).toFixed(2)}`);
const tMock = (_key, values = {}, fallback = '') => {
  let out = fallback || _key;
  Object.entries(values || {}).forEach(([k, v]) => {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
  });
  return out;
};
const marketContextMock = {
  formatNumber: formatNumberMock,
  formatPrice: formatPriceMock,
  t: tMock,
};

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => marketContextMock,
}));

vi.mock('@/services/api', () => ({
  productApi: {
    getProductById: getProductByIdMock,
    getProducts: getProductsMock,
  },
}));

vi.mock('@/services/aiApi', () => ({
  aiApi: {
    compare: compareMock,
  },
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: (legacyT) => (
    typeof legacyT === 'function' ? legacyT : (_id, _values, fallback = '') => fallback
  ),
}));

import AICompare from './index';

describe('AICompare market-aware formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compareMock.mockResolvedValue({ summary: null });
    getProductsMock.mockResolvedValue({ products: [] });
  });

  it('delegates review counts to formatNumber instead of hardcoding en-IN', async () => {
    const productFixtures = {
      p1: {
        id: 'p1',
        title: 'Aura Phone Alpha',
        brand: 'Aura',
        price: 39999,
        rating: 4.7,
        ratingCount: 12345,
        discountPercentage: 10,
        stock: 15,
        deliveryTime: '2-3 days',
        warranty: '1 year',
      },
      p2: {
        id: 'p2',
        title: 'Aura Phone Beta',
        brand: 'Aura',
        price: 44999,
        rating: 4.5,
        ratingCount: 6789,
        discountPercentage: 15,
        stock: 8,
        deliveryTime: '3-5 days',
        warranty: '2 years',
      },
    };
    getProductByIdMock.mockImplementation((id) => Promise.resolve(productFixtures[id] || null));

    render(
      <MemoryRouter initialEntries={['/compare?ids=p1,p2']}>
        <AICompare />
      </MemoryRouter>
    );

    await waitFor(() => expect(getProductByIdMock).toHaveBeenCalledTimes(2));
    expect(formatNumberMock).toHaveBeenCalledWith(12345);
    expect(formatNumberMock).toHaveBeenCalledWith(6789);
    expect(screen.getByText('FMT:12345')).toBeInTheDocument();
    expect(screen.getByText('FMT:6789')).toBeInTheDocument();
  });
});
