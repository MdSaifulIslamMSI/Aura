import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({ apiFetch: vi.fn() }));
vi.mock('./apiUtils', () => ({
  getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer t' })),
  createIdempotencyKey: vi.fn((scope) => `key-${scope}-1`),
}));

import { apiFetch } from '../apiBase';
import { adminStatusApi, statusApi } from './statusApi';

const livePayload = { groups: [{ name: 'API' }], lastUpdatedAt: '2026-09-01T00:00:00.000Z', overallStatus: 'operational' };

describe('statusApi.getPublicStatus fallback chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('returns live data and persists it as last-known-good', async () => {
    apiFetch.mockResolvedValue({ data: livePayload });
    const result = await statusApi.getPublicStatus();
    expect(result.fallbackSource).toBe('live');
    const cached = JSON.parse(window.localStorage.getItem('aura.status.lastKnownGood'));
    expect(cached.payload).toMatchObject({ overallStatus: 'operational' });
  });

  it('does not persist unusable live payloads', async () => {
    apiFetch.mockResolvedValue({ data: { overallStatus: 'unknown' } });
    await statusApi.getPublicStatus();
    expect(window.localStorage.getItem('aura.status.lastKnownGood')).toBeNull();
  });

  it('falls back to the static snapshot when live fails', async () => {
    apiFetch.mockRejectedValue(new Error('live down'));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ groups: [{ name: 'API' }] }),
    })));
    const result = await statusApi.getPublicStatus();
    expect(result.fallbackSource).toBe('snapshot');
    vi.unstubAllGlobals();
  });

  it('prefers fresher cached data over stale snapshots', async () => {
    apiFetch.mockRejectedValue(new Error('live down'));
    window.localStorage.setItem('aura.status.lastKnownGood', JSON.stringify({
      savedAt: '2026-09-05T00:00:00.000Z',
      payload: { ...livePayload, lastUpdatedAt: '2026-09-05T00:00:00.000Z' },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...livePayload, lastUpdatedAt: '2026-08-01T00:00:00.000Z' }),
    })));
    const result = await statusApi.getPublicStatus();
    expect(result.fallbackSavedAt).toBe('2026-09-05T00:00:00.000Z');
    vi.unstubAllGlobals();
  });

  it('rethrows the live error when every fallback is unusable', async () => {
    const liveError = new Error('live down');
    apiFetch.mockRejectedValue(liveError);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(statusApi.getPublicStatus()).rejects.toBe(liveError);
    vi.unstubAllGlobals();
  });

  it('tolerates corrupt localStorage entries', async () => {
    apiFetch.mockRejectedValue(new Error('live down'));
    window.localStorage.setItem('aura.status.lastKnownGood', '{not-json');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(statusApi.getPublicStatus()).rejects.toThrow('live down');
    vi.unstubAllGlobals();
  });
});

describe('statusApi subscriptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('encodes incident slugs in the path', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await statusApi.getIncident('outage/aug 2026');
    expect(apiFetch.mock.calls[0][0]).toBe('/status/incidents/outage%2Faug%202026');
  });

  it('posts subscribe/unsubscribe payloads as JSON', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await statusApi.subscribe({ email: 'u@example.com' });
    await statusApi.unsubscribe('tok-1');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ email: 'u@example.com' });
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ token: 'tok-1' });
  });

  it('verifies subscriptions via query params', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await statusApi.verify('tok-9');
    expect(apiFetch.mock.calls[0][1].params).toEqual({ token: 'tok-9' });
  });
});

describe('adminStatusApi client contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches auth headers on admin reads', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await adminStatusApi.getDashboard();
    expect(apiFetch.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer t' });
  });

  it('sends idempotency keys on incident creation', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await adminStatusApi.createIncident({ title: 'DB failover' });
    expect(apiFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('key-status-incident-1');
  });
});
