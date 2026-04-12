import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let authApi;
let mocks;

const loadAuthApi = async () => {
  vi.resetModules();

  mocks = {
    getAuthHeaderMock: vi.fn(),
    ensureCsrfTokenMock: vi.fn(),
    addCsrfTokenToHeadersMock: vi.fn(),
    cacheTokenMock: vi.fn(),
    clearCsrfTokenCacheMock: vi.fn(),
  };

  vi.doMock('./apiUtils', () => ({
    getAuthHeader: mocks.getAuthHeaderMock,
  }));

  vi.doMock('../csrfTokenManager', () => ({
    ensureCsrfToken: mocks.ensureCsrfTokenMock,
    addCsrfTokenToHeaders: mocks.addCsrfTokenToHeadersMock,
    cacheToken: mocks.cacheTokenMock,
    clearCsrfTokenCache: mocks.clearCsrfTokenCacheMock,
  }));

  ({ authApi } = await import('./authApi'));
};

describe('authApi', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    await loadAuthApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('./apiUtils');
    vi.doUnmock('../csrfTokenManager');
  });

  it('bootstraps a cookie session through /auth/exchange when /auth/session initially returns 401', async () => {
    const firebaseUser = {
      getIdToken: vi.fn(),
    };
    const csrfToken = 'a'.repeat(64);

    mocks.getAuthHeaderMock
      .mockResolvedValueOnce({})
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

    expect(mocks.getAuthHeaderMock).toHaveBeenCalledTimes(2);
    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(1, firebaseUser);
    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(2, firebaseUser, {
      useFirebaseBearer: true,
      forceRefresh: true,
    });
    expect(mocks.clearCsrfTokenCacheMock).toHaveBeenCalledTimes(1);
    expect(mocks.cacheTokenMock).toHaveBeenCalledWith(csrfToken, 'cookie_session');
  });

  it('retries auth sync after exchanging a fresh server session when CSRF bootstrap is rejected with 401', async () => {
    const firebaseUser = {
      getIdToken: vi.fn()
        .mockResolvedValueOnce('stale-token')
        .mockResolvedValueOnce('fresh-token'),
    };

    mocks.getAuthHeaderMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Authorization: 'Bearer fresh-token' })
      .mockResolvedValueOnce({});

    mocks.ensureCsrfTokenMock
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 401: Unauthorized'), { status: 401 }))
      .mockResolvedValueOnce('b'.repeat(64));

    mocks.addCsrfTokenToHeadersMock.mockImplementation((headers, _method, csrfToken) => ({
      ...headers,
      'X-CSRF-Token': csrfToken,
    }));

    global.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'authenticated' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'c'.repeat(64),
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(authApi.syncSession('user@example.com', 'Aura User', '+919999999999', { firebaseUser }))
      .resolves
      .toEqual({ ok: true });

    expect(mocks.getAuthHeaderMock).toHaveBeenCalledTimes(3);
    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(1, firebaseUser, {
      useFirebaseBearer: true,
      forceRefresh: false,
    });
    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(2, firebaseUser, {
      useFirebaseBearer: true,
      forceRefresh: true,
    });
    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(3, firebaseUser, {
      useFirebaseBearer: true,
      forceRefresh: true,
    });
    expect(mocks.ensureCsrfTokenMock).toHaveBeenCalledTimes(2);
    expect(mocks.clearCsrfTokenCacheMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
