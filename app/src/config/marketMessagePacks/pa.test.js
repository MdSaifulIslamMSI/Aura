import { describe, expect, it } from 'vitest';
import { MARKET_MESSAGE_PACK } from './pa.js';
import { MARKET_MESSAGE_PACK as EN_PACK } from './en.js';

const PACK = MARKET_MESSAGE_PACK;
const KEYS = Object.keys(PACK);

describe('marketMessagePacks/pa', () => {
  it('exports a non-empty flat message object', () => {
    expect(PACK).toBeTypeOf('object');
    expect(PACK).not.toBeNull();
    expect(KEYS.length).toBeGreaterThan(3000);
  });

  it('has unique keys and non-empty string values', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
    for (const key of KEYS) {
      expect(PACK[key], key).toBeTypeOf('string');
      expect(PACK[key].length, key).toBeGreaterThan(0);
    }
  });

  it('keeps the shared module shape by covering every en key', () => {
    for (const key of Object.keys(EN_PACK)) {
      expect(PACK[key], key).toBeTypeOf('string');
    }
  });

  it('translates the shared messages instead of copying en', () => {
    const shared = Object.keys(EN_PACK);
    const differing = shared.filter((key) => PACK[key] !== EN_PACK[key]);
    expect(differing.length / shared.length).toBeGreaterThan(0.9);
  });

  it('contains Gurmukhi-script translations', () => {
    expect(KEYS.some((key) => /[\u0A00-\u0A7F]/.test(PACK[key]))).toBe(true);
  });
});
