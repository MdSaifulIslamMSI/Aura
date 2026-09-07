import { describe, expect, it } from 'vitest';
import * as barrel from './api';
import * as index from './api/index';

describe('services/api barrel', () => {
  it('re-exports every module from services/api/index', () => {
    for (const key of Object.keys(index)) {
      expect(barrel, `missing re-export: ${key}`).toHaveProperty(key);
    }
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });

  it('exposes the core commerce API surfaces', () => {
    for (const key of ['productApi', 'cartApi', 'orderApi', 'userApi', 'authApi']) {
      expect(barrel, `missing API surface: ${key}`).toHaveProperty(key);
      expect(barrel[key]).toBeDefined();
    }
  });

  it('exposes trust and platform API surfaces', () => {
    for (const key of ['trustApi', 'supportApi', 'notificationApi', 'emergencyApi', 'marketApi']) {
      expect(barrel, `missing API surface: ${key}`).toHaveProperty(key);
    }
  });

  it('keeps the legacy default import path side-effect free', async () => {
    const fresh = await import('./api');
    expect(fresh.productApi).toBe(barrel.productApi);
  });
});
