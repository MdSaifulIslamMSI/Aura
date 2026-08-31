import { describe, expect, it } from 'vitest';
import { MARKET_MESSAGE_PACK } from './en.js';

const PACK = MARKET_MESSAGE_PACK;
const KEYS = Object.keys(PACK);

describe('marketMessagePacks/en', () => {
  it('exports a non-empty flat message object', () => {
    expect(PACK).toBeTypeOf('object');
    expect(PACK).not.toBeNull();
    expect(KEYS.length).toBeGreaterThan(400);
  });

  it('has unique keys (no duplicate message ids possible)', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });

  it('maps every key to a non-empty string value', () => {
    for (const key of KEYS) {
      expect(PACK[key], key).toBeTypeOf('string');
      expect(PACK[key].length, key).toBeGreaterThan(0);
    }
  });

  it('contains plausible English UI messages', () => {
    expect(PACK['checkout.continue']).toBe('Continue');
    expect(PACK['market.title']).toBe('Market Studio');
    expect(PACK['search.run']).toBe('Run Search');
    expect(PACK['nav.preferences']).toBe('Preferences');
  });

  it('keeps interpolation templates intact', () => {
    expect(PACK['checkout.applied']).toContain('{{code}}');
  });
});
