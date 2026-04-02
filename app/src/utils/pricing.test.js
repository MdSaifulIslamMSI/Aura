import { beforeEach, describe, expect, it } from 'vitest';
import { formatPrice, setMarketFormatDefaults } from './format';
import { formatBasePrice, formatEntityPrice } from './pricing';

describe('pricing formatting helpers', () => {
  beforeEach(() => {
    setMarketFormatDefaults({
      currency: 'USD',
      locale: 'en-US',
      baseCurrency: 'INR',
      rates: {
        INR: 1,
        USD: 0.02,
      },
    });
  });

  it('formats raw base amounts in the active market currency', () => {
    expect(formatBasePrice(formatPrice, 1000, 'INR')).toContain('$20');
  });

  it('formats entity pricing from base amount and base currency', () => {
    expect(formatEntityPrice(formatPrice, {
      price: 1000,
      baseCurrency: 'INR',
    })).toContain('$20');
  });
});
