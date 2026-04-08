import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const getAuthHeaderMock = vi.fn();
  const ensureCsrfTokenMock = vi.fn();
  const addCsrfTokenToHeadersMock = vi.fn();
  const cacheTokenMock = vi.fn();
  const clearCsrfTokenCacheMock = vi.fn();

  return {
    getAuthHeaderMock,
    ensureCsrfTokenMock,
    addCsrfTokenToHeadersMock,
    cacheTokenMock,
    clearCsrfTokenCacheMock,
  };
});

vi.mock('./apiUtils', () => ({
  getAuthHeader: hoisted.getAuthHeaderMock,
}));

vi.mock('../csrfTokenManager', () => ({
  ensureCsrfToken: hoisted.ensureCsrfTokenMock,
  addCsrfTokenToHeaders: hoisted.addCsrfTokenToHeadersMock,
  cacheToken: hoisted.cacheTokenMock,
  clearCsrfTokenCache: hoisted.clearCsrfTokenCacheMock,
}));

import { authApi } from './authApi';

describe('authApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('force-refreshes the firebase token when /auth/session initially returns 401', async () => {
    const firebaseUser = {
      getIdToken: vi.fn(),
    };
    const csrfToken = 'a'.repeat(64);

    hoisted.getAuthHeaderMock
      .mockResolvedValueOnce({ Authorization: 'Bearer stale-token' })
      .mockResolvedValueOnce({ Authorization: 'Bearer fresh-token' });

    global.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not authorized, token failed' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'authenticated' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
        })
      );

    await expect(authApi.getSession({ firebaseUser })).resolves.toEqual({ status: 'authenticated' });

    expect(hoisted.getAuthHeaderMock).toHaveBeenNthCalledWith(1, firebaseUser, { forceRefresh: false });
    expect(hoisted.getAuthHeaderMock).toHaveBeenNthCalledWith(2, firebaseUser, { forceRefresh: true });
    expect(hoisted.clearCsrfTokenCacheMock).toHaveBeenCalledTimes(1);
    expect(hoisted.cacheTokenMock).toHaveBeenCalledWith(csrfToken, 'fresh-token');
  });

  it('retries auth sync after forcing a fresh token when CSRF bootstrap is rejected with 401', async () => {
    const firebaseUser = {
      getIdToken: vi.fn()
        .mockResolvedValueOnce('stale-token')
        .mockResolvedValueOnce('fresh-token'),
    };

    hoisted.getAuthHeaderMock
      .mockResolvedValueOnce({ Authorization: 'Bearer stale-token' })
      .mockResolvedValueOnce({ Authorization: 'Bearer fresh-token' });

    hoisted.ensureCsrfTokenMock
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 401: Unauthorized'), { status: 401 }))
      .mockResolvedValueOnce('b'.repeat(64));

    hoisted.addCsrfTokenToHeadersMock.mockImplementation((headers, _method, csrfToken) => ({
      ...headers,
      'X-CSRF-Token': csrfToken,
    }));

    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(authApi.syncSession('user@example.com', 'Aura User', '+919999999999', { firebaseUser }))
      .resolves
      .toEqual({ ok: true });

    expect(hoisted.getAuthHeaderMock).toHaveBeenNthCalledWith(1, firebaseUser, { forceRefresh: false });
    expect(hoisted.getAuthHeaderMock).toHaveBeenNthCalledWith(2, firebaseUser, { forceRefresh: true });
    expect(hoisted.clearCsrfTokenCacheMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
