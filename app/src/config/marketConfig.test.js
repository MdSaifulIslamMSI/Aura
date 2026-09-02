import { describe, expect, it } from 'vitest';
import {
  BROWSE_BASE_CURRENCY,
  DEFAULT_MARKET_PREFERENCE,
  MARKET_PRESENTMENT_RATES,
  MARKET_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  SUPPORTED_MARKETS,
  createTranslator,
  formatMessageTemplate,
  getSupportedCurrency,
  getSupportedLanguage,
  getSupportedMarket,
  hasLoadedMarketMessagePack,
  marketRules,
  normalizeMarketPreference,
  resolveLocaleForSelection,
} from './marketConfig.js';

describe('marketConfig', () => {
  it('exposes stable storage and base-currency constants', () => {
    expect(MARKET_STORAGE_KEY).toBe('aura_market_preferences_v1');
    expect(BROWSE_BASE_CURRENCY).toBe('INR');
  });

  it('provides positive presentment rates pinned to INR', () => {
    expect(Object.keys(MARKET_PRESENTMENT_RATES).length).toBeGreaterThan(5);
    expect(MARKET_PRESENTMENT_RATES.INR).toBe(1);
    Object.values(MARKET_PRESENTMENT_RATES).forEach((rate) => expect(rate).toBeGreaterThan(0));
  });

  it('lists supported languages with valid shape and text directions', () => {
    const codes = SUPPORTED_LANGUAGES.map((language) => language.code);
    expect(codes).toContain('en');
    expect(new Set(codes).size).toBe(codes.length);
    SUPPORTED_LANGUAGES.forEach((language) => {
      expect(['ltr', 'rtl']).toContain(language.direction);
      expect(language.nativeLabel.length).toBeGreaterThan(0);
      expect(language.defaultLocale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    });
    expect(SUPPORTED_LANGUAGES.find((language) => language.code === 'ur').direction).toBe('rtl');
    expect(SUPPORTED_LANGUAGES.find((language) => language.code === 'ar').direction).toBe('rtl');
  });

  it('lists supported markets with unique country codes and valid fields', () => {
    const codes = SUPPORTED_MARKETS.map((market) => market.countryCode);
    expect(codes).toContain('IN');
    expect(new Set(codes).size).toBe(codes.length);
    SUPPORTED_MARKETS.forEach((market) => {
      expect(market.currency).toMatch(/^[A-Z]{3}$/);
      expect(market.timeZones.length).toBeGreaterThan(0);
    });
  });

  it('gives India the richer payment rail set', () => {
    expect(marketRules.IN.paymentMethods).toContain('UPI');
    expect(marketRules.US.paymentMethods).toEqual(['CARD']);
  });

  it('normalizes unknown preferences back to the Indian default', () => {
    expect(DEFAULT_MARKET_PREFERENCE).toEqual({
      countryCode: 'IN',
      language: 'en',
      currency: 'INR',
      locale: 'en-IN',
    });
    expect(normalizeMarketPreference({ countryCode: 'XX', language: 'zz', currency: 'XXX' }))
      .toEqual(DEFAULT_MARKET_PREFERENCE);
  });

  it('resolves lookups with case-insensitive fallbacks', () => {
    expect(getSupportedMarket('jp').countryCode).toBe('JP');
    expect(getSupportedMarket('XX').countryCode).toBe('IN');
    expect(getSupportedLanguage('BN').code).toBe('bn');
    expect(getSupportedLanguage('zz').code).toBe('en');
    expect(getSupportedCurrency('usd')).toBe('USD');
    expect(getSupportedCurrency('XXX')).toBe('INR');
  });

  it('resolves the market locale when the language matches the market default', () => {
    expect(resolveLocaleForSelection('de', 'DE')).toBe('de-DE');
    expect(resolveLocaleForSelection('hi', 'US')).toBe('hi-IN');
  });

  it('translates and interpolates message templates with fallbacks', () => {
    expect(formatMessageTemplate('{{a}} + {{b}}', { a: 1, b: 2 })).toBe('1 + 2');
    expect(formatMessageTemplate('{{missing}}', {})).toBe('');
    expect(createTranslator('en')('checkout.continue')).toBe('Continue');
    expect(createTranslator('en')('no.such.key', {}, 'Fallback')).toBe('Fallback');
    expect(hasLoadedMarketMessagePack('en')).toBe(true);
  });
});
