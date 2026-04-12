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

  it('sends auth sync with Firebase bearer only when a Firebase user is present', async () => {
    const firebaseUser = {
      getIdToken: vi.fn().mockResolvedValue('fresh-token'),
    };

    mocks.getAuthHeaderMock.mockResolvedValueOnce({ Authorization: 'Bearer fresh-token' });

    global.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'authenticated' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(authApi.syncSession('user@example.com', 'Aura User', '+919999999999', { firebaseUser }))
      .resolves
      .toEqual({ status: 'authenticated' });

    expect(mocks.getAuthHeaderMock).toHaveBeenCalledTimes(1);
    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(1, firebaseUser, {
      useFirebaseBearer: true,
    });
    expect(mocks.ensureCsrfTokenMock).not.toHaveBeenCalled();
    expect(mocks.addCsrfTokenToHeadersMock).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends trusted-device verification with Firebase bearer only when a Firebase user is present', async () => {
    const firebaseUser = {
      getIdToken: vi.fn().mockResolvedValue('fresh-token'),
    };

    mocks.getAuthHeaderMock.mockResolvedValueOnce({ Authorization: 'Bearer fresh-token' });

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, deviceSessionToken: 'device-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(authApi.verifyDeviceChallenge(
      'challenge-token',
      {
        method: 'browser_key',
        proofBase64: 'proof-data',
        publicKeySpkiBase64: 'public-key',
      },
      '',
      { firebaseUser }
    )).resolves.toEqual({ success: true, deviceSessionToken: 'device-token' });

    expect(mocks.getAuthHeaderMock).toHaveBeenCalledTimes(1);
    expect(mocks.getAuthHeaderMock).toHaveBeenCalledWith(firebaseUser, {
      useFirebaseBearer: true,
    });
    expect(mocks.ensureCsrfTokenMock).not.toHaveBeenCalled();
    expect(mocks.addCsrfTokenToHeadersMock).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
