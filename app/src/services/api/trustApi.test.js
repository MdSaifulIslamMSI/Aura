import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trustApi } from './trustApi';
import { getBackendHealthSnapshot } from '../backendHealth';

vi.mock('../backendHealth', () => ({
  getBackendHealthSnapshot: vi.fn(),
}));

describe('trustApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  });

  describe('getClientSignals', () => {
    it('returns the client trust signal shape', async () => {
      const signals = await trustApi.getClientSignals();
      expect(signals).toEqual(expect.objectContaining({
        online: expect.any(Boolean),
        secureContext: expect.any(Boolean),
        permissionsSupported: expect.any(Boolean),
        language: expect.any(String),
        timezone: expect.any(String),
      }));
    });

    it('reflects offline navigator state', async () => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      const signals = await trustApi.getClientSignals();
      expect(signals.online).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('derives healthy when backend is ok and client is online', async () => {
      getBackendHealthSnapshot.mockResolvedValue({
        status: 'ok', uptime: 123, timestamp: '2026-01-01T00:00:00.000Z',
      });
      const result = await trustApi.getHealthStatus();
      expect(result.backend).toEqual({ status: 'ok', db: 'connected', uptime: 123, timestamp: '2026-01-01T00:00:00.000Z' });
      expect(result.derivedStatus).toBe('healthy');
    });

    it('derives degraded when backend reports non-ok status', async () => {
      getBackendHealthSnapshot.mockResolvedValue({ status: 'down', uptime: 0, timestamp: null });
      const result = await trustApi.getHealthStatus();
      expect(result.backend.status).toBe('down');
      expect(result.backend.db).toBe('unknown');
      expect(result.derivedStatus).toBe('degraded');
    });

    it('falls back to degraded when the health probe throws', async () => {
      getBackendHealthSnapshot.mockRejectedValue(new Error('network down'));
      const result = await trustApi.getHealthStatus();
      expect(result.backend).toEqual({ status: 'degraded', db: 'unknown', uptime: 0, timestamp: null });
      expect(result.derivedStatus).toBe('degraded');
    });

    it('derives degraded when client is offline even if backend is ok', async () => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      getBackendHealthSnapshot.mockResolvedValue({ status: 'ok', uptime: 5, timestamp: 't' });
      const result = await trustApi.getHealthStatus();
      expect(result.derivedStatus).toBe('degraded');
    });

    it('coerces missing uptime to zero', async () => {
      getBackendHealthSnapshot.mockResolvedValue({ status: 'ok' });
      const result = await trustApi.getHealthStatus();
      expect(result.backend.uptime).toBe(0);
    });
  });
});
