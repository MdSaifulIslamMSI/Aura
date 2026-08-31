import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHONE_COUNTRY_CODE,
  PHONE_COUNTRY_OPTIONS,
  getCountryFlag,
  getPhoneCountryOption,
  getPhoneCountryOptionLabel,
} from './phoneCountryOptions.js';

describe('phoneCountryOptions', () => {
  it('builds one option per country with the full option shape', () => {
    expect(PHONE_COUNTRY_OPTIONS.length).toBeGreaterThan(200);
    PHONE_COUNTRY_OPTIONS.forEach((option) => {
      expect(option.countryCode).toMatch(/^[A-Z]{2}$/);
      expect(option.dialCode).toMatch(/^\+\d{1,3}$/);
      // Flag emojis are two regional-indicator code points (4 UTF-16 units).
      expect([...option.flag]).toHaveLength(2);
      expect(option.name.length).toBeGreaterThan(0);
    });
  });

  it('has unique country codes and is sorted for display', () => {
    const codes = PHONE_COUNTRY_OPTIONS.map((option) => option.countryCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (let index = 1; index < PHONE_COUNTRY_OPTIONS.length; index += 1) {
      const previous = PHONE_COUNTRY_OPTIONS[index - 1];
      const current = PHONE_COUNTRY_OPTIONS[index];
      const comparison = previous.name.localeCompare(current.name, 'en')
        || previous.countryCode.localeCompare(current.countryCode, 'en');
      expect(comparison).toBeLessThanOrEqual(0);
    }
  });

  it('defaults to India and falls back for unknown codes', () => {
    expect(DEFAULT_PHONE_COUNTRY_CODE).toBe('IN');
    expect(getPhoneCountryOption('in').countryCode).toBe('IN');
    expect(getPhoneCountryOption('in').dialCode).toBe('+91');
    expect(getPhoneCountryOption('ZZ').countryCode).toBe('IN');
    expect(getPhoneCountryOption().countryCode).toBe('IN');
  });

  it('derives emoji flags from ISO codes and composes display labels', () => {
    expect(getCountryFlag('US')).toBe('\u{1F1FA}\u{1F1F8}');
    expect(getCountryFlag('de')).toBe('\u{1F1E9}\u{1F1EA}');
    expect(getCountryFlag('USA')).toBe('');
    expect(getCountryFlag()).toBe('');
    const india = getPhoneCountryOption('IN');
    expect(getPhoneCountryOptionLabel(india)).toBe(`\u{1F1EE}\u{1F1F3} +91 ${india.name}`);
    expect(getPhoneCountryOptionLabel(null)).toBe('');
  });
});
