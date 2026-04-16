import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearBackendHealthSnapshotCache, getBackendHealthSnapshot } from './backendHealth';

describe('backendHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearBackendHealthSnapshotCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearBackendHealthSnapshotCache();
  });

  it('falls back to /health/ready when /health/live returns the SPA shell', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<!doctype html><html></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ready: true,
        uptime: 42,
        timestamp: '2026-04-17T00:00:00.000Z',
        startup: {
          asyncStartupHealthy: true,
        },
        topology: {
          splitRuntimeEnabled: true,
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }));

    const snapshot = await getBackendHealthSnapshot({ force: true, timeoutMs: 500 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/health/live');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/health/ready');
    expect(snapshot).toMatchObject({
      status: 'ok',
      alive: true,
      ready: true,
      startupHealthy: true,
      uptime: 42,
    });
  });
});
