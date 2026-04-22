import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let authApi;
let otpApi;
let mocks;

const buildRuntimeValue = (label = 'value') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const loadAuthApi = async () => {
  vi.resetModules();

  mocks = {
    getAuthHeaderMock: vi.fn(),
    ensureCsrfTokenMock: vi.fn(),
    addCsrfTokenToHeadersMock: vi.fn(),
    cacheTokenMock: vi.fn(),
    clearCsrfTokenCacheMock: vi.fn(),
    getTrustedDeviceSessionTokenMock: vi.fn(),
    signTrustedDeviceChallengeMock: vi.fn(),
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

  vi.doMock('../deviceTrustClient', () => ({
    getTrustedDeviceSessionToken: mocks.getTrustedDeviceSessionTokenMock,
    signTrustedDeviceChallenge: mocks.signTrustedDeviceChallengeMock,
  }));

  ({ authApi, otpApi } = await import('./authApi'));
};

describe('authApi', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    await loadAuthApi();
    mocks.getTrustedDeviceSessionTokenMock.mockReturnValue('');
    mocks.signTrustedDeviceChallengeMock.mockResolvedValue({
      method: 'browser_key',
      proofBase64: buildRuntimeValue('sig'),
      publicKeySpkiBase64: '',
      credential: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('./apiUtils');
    vi.doUnmock('../csrfTokenManager');
    vi.doUnmock('../deviceTrustClient');
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
    const [_url, requestOptions] = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(requestOptions.body);
    expect(requestOptions.headers.get('X-Aura-Invisible-Bits')).toBeNull();
    expect(requestBody).toEqual({
      email: 'user@example.com',
      name: 'Aura User',
      phone: '+919999999999',
    });
  });

  it('generates backup recovery codes through a fresh CSRF-protected session write', async () => {
    const csrfToken = 'b'.repeat(64);
    mocks.getAuthHeaderMock.mockResolvedValueOnce({ 'X-Session-Mode': 'cookie' });
    mocks.ensureCsrfTokenMock.mockResolvedValueOnce(csrfToken);
    mocks.addCsrfTokenToHeadersMock.mockReturnValueOnce({
      'X-Session-Mode': 'cookie',
      'X-CSRF-Token': csrfToken,
    });

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, recoveryCodes: ['ABCD-EFGH-IJKL-MNOP'] }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(authApi.generateRecoveryCodes())
      .resolves
      .toEqual({ success: true, recoveryCodes: ['ABCD-EFGH-IJKL-MNOP'] });

    expect(mocks.ensureCsrfTokenMock).toHaveBeenCalledWith({
      authToken: '',
      owner: 'cookie_session',
      forceFresh: false,
    });
    expect(mocks.addCsrfTokenToHeadersMock).toHaveBeenCalledWith(
      { 'X-Session-Mode': 'cookie' },
      'POST',
      csrfToken
    );
    const [url, requestOptions] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/recovery-codes');
    expect(requestOptions.headers.get('X-CSRF-Token')).toBe(csrfToken);
    expect(JSON.parse(requestOptions.body)).toEqual({});
  });

  it('refreshes and retries CSRF-protected writes when the server reports an expired token', async () => {
    const expiredToken = 'e'.repeat(64);
    const freshToken = 'f'.repeat(64);

    mocks.getAuthHeaderMock
      .mockResolvedValueOnce({ 'X-Session-Mode': 'cookie' })
      .mockResolvedValueOnce({ 'X-Session-Mode': 'cookie' });
    mocks.ensureCsrfTokenMock
      .mockResolvedValueOnce(expiredToken)
      .mockResolvedValueOnce(freshToken);
    mocks.addCsrfTokenToHeadersMock
      .mockReturnValueOnce({
        'X-Session-Mode': 'cookie',
        'X-CSRF-Token': expiredToken,
      })
      .mockReturnValueOnce({
        'X-Session-Mode': 'cookie',
        'X-CSRF-Token': freshToken,
      });

    global.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: 'CSRF_TOKEN_EXPIRED',
          message: 'CSRF token expired',
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, recoveryCodes: ['ABCD-EFGH-IJKL-MNOP'] }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(authApi.generateRecoveryCodes())
      .resolves
      .toEqual({ success: true, recoveryCodes: ['ABCD-EFGH-IJKL-MNOP'] });

    expect(mocks.clearCsrfTokenCacheMock).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCsrfTokenMock).toHaveBeenNthCalledWith(2, {
      authToken: '',
      owner: 'cookie_session',
      forceFresh: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, retryOptions] = global.fetch.mock.calls[1];
    expect(retryOptions.headers.get('X-CSRF-Token')).toBe(freshToken);
  });

  it('verifies backup recovery codes through the public recovery endpoint', async () => {
    mocks.getAuthHeaderMock.mockResolvedValueOnce({});

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, flowToken: buildRuntimeValue('flow') }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(authApi.verifyRecoveryCode('user@example.com', 'ABCD-EFGH-IJKL-MNOP'))
      .resolves
      .toMatchObject({ success: true, flowToken: expect.any(String) });

    expect(mocks.ensureCsrfTokenMock).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, requestOptions] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/recovery-codes/verify');
    expect(JSON.parse(requestOptions.body)).toEqual({
      email: 'user@example.com',
      code: 'ABCD-EFGH-IJKL-MNOP',
    });
  });

  it('verifies trusted-device challenges through the cookie session by default', async () => {
    const deviceSessionToken = buildRuntimeValue('session-ref');
    const challengeToken = buildRuntimeValue('challenge-ref');
    const proofBase64 = buildRuntimeValue('sig-ref');
    const publicKeySpkiBase64 = buildRuntimeValue('key-ref');
    const csrfToken = 'c'.repeat(64);
    const firebaseUser = {
      getIdToken: vi.fn().mockResolvedValue('fresh-token'),
    };

    mocks.getAuthHeaderMock.mockResolvedValueOnce({ 'X-Session-Mode': 'cookie' });
    mocks.ensureCsrfTokenMock.mockResolvedValueOnce(csrfToken);
    mocks.addCsrfTokenToHeadersMock.mockReturnValueOnce({
      'X-Session-Mode': 'cookie',
      'X-CSRF-Token': csrfToken,
    });

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, deviceSessionToken }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(authApi.verifyDeviceChallenge(
      challengeToken,
      {
        method: 'browser_key',
        proofBase64,
        publicKeySpkiBase64,
      },
      '',
      { firebaseUser }
    )).resolves.toEqual({ success: true, deviceSessionToken });

    expect(mocks.getAuthHeaderMock).toHaveBeenCalledTimes(1);
    expect(mocks.getAuthHeaderMock).toHaveBeenCalledWith(firebaseUser, {
      useFirebaseBearer: false,
      forceRefresh: false,
    });
    expect(mocks.ensureCsrfTokenMock).toHaveBeenCalledWith({
      authToken: '',
      owner: 'cookie_session',
      forceFresh: false,
    });
    expect(mocks.addCsrfTokenToHeadersMock).toHaveBeenCalledWith(
      { 'X-Session-Mode': 'cookie' },
      'POST',
      csrfToken
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to Firebase bearer auth when trusted-device cookie session is missing', async () => {
    const deviceSessionToken = buildRuntimeValue('session-ref');
    const challengeToken = buildRuntimeValue('challenge-ref');
    const proofBase64 = buildRuntimeValue('sig-ref');
    const publicKeySpkiBase64 = buildRuntimeValue('key-ref');
    const firebaseUser = {
      getIdToken: vi.fn().mockResolvedValue('fresh-token'),
    };
    const csrfError = Object.assign(new Error('HTTP 401: Not authorized, no session'), {
      status: 401,
      data: { message: 'Not authorized, no session' },
    });

    mocks.getAuthHeaderMock
      .mockResolvedValueOnce({ 'X-Session-Mode': 'cookie' })
      .mockResolvedValueOnce({ Authorization: 'Bearer fresh-token' });
    mocks.ensureCsrfTokenMock.mockRejectedValueOnce(csrfError);

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, deviceSessionToken }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(authApi.verifyDeviceChallenge(
      challengeToken,
      {
        method: 'browser_key',
        proofBase64,
        publicKeySpkiBase64,
      },
      '',
      { firebaseUser }
    )).resolves.toEqual({ success: true, deviceSessionToken });

    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(1, firebaseUser, {
      useFirebaseBearer: false,
      forceRefresh: false,
    });
    expect(mocks.getAuthHeaderMock).toHaveBeenNthCalledWith(2, firebaseUser, {
      useFirebaseBearer: true,
    });
    expect(mocks.ensureCsrfTokenMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, requestOptions] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/verify-device');
    expect(requestOptions.headers.get('Authorization')).toBe('Bearer fresh-token');
    expect(requestOptions.headers.get('X-CSRF-Token')).toBeNull();
  });

  it('adds a fresh trusted-device bootstrap proof to sensitive OTP requests', async () => {
    const deviceSessionToken = buildRuntimeValue('session-ref');
    const bootstrapToken = buildRuntimeValue('bootstrap-ref');
    const challengeValue = buildRuntimeValue('challenge-ref');
    const bootstrapProof = buildRuntimeValue('sig-ref');
    const publicKeySpkiBase64 = buildRuntimeValue('key-ref');

    mocks.getTrustedDeviceSessionTokenMock.mockReturnValue(deviceSessionToken);
    mocks.getAuthHeaderMock
      .mockResolvedValueOnce({ 'X-Aura-Device-Id': 'device-123', 'X-Aura-Device-Session': deviceSessionToken })
      .mockResolvedValueOnce({ 'X-Aura-Device-Id': 'device-123', 'X-Aura-Device-Session': deviceSessionToken });
    mocks.signTrustedDeviceChallengeMock.mockResolvedValueOnce({
      method: 'browser_key',
      proofBase64: bootstrapProof,
      publicKeySpkiBase64,
      credential: null,
    });

    global.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          success: true,
          deviceChallenge: {
            token: bootstrapToken,
            challenge: challengeValue,
            mode: 'assert',
            deviceId: 'device-123',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(otpApi.sendOtp('user@example.com', '+919999999999', 'forgot-password'))
      .resolves
      .toEqual({ success: true });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.signTrustedDeviceChallengeMock).toHaveBeenCalledWith(expect.objectContaining({
      token: bootstrapToken,
      challenge: challengeValue,
    }));
    const [_url, requestOptions] = global.fetch.mock.calls[1];
    const requestBody = JSON.parse(requestOptions.body);
    expect(requestBody.trustedDeviceChallenge).toEqual({
      token: bootstrapToken,
      method: 'browser_key',
      proof: bootstrapProof,
      publicKeySpkiBase64,
      credential: null,
    });
  });

  it('sends reset-password requests with the server-issued recovery flow token', async () => {
    const flowToken = buildRuntimeValue('flow-ref');
    mocks.getAuthHeaderMock.mockResolvedValueOnce({ 'X-Aura-Device-Id': 'device-123' });

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(otpApi.resetPassword({
      flowToken,
      password: 'Orbital!59Qa',
    }))
      .resolves
      .toEqual({ success: true });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.getAuthHeaderMock).toHaveBeenCalledTimes(1);
    const [_url, requestOptions] = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(requestOptions.body);
    expect(requestOptions.headers.get('X-Aura-Device-Id')).toBe('device-123');
    expect(requestBody).toEqual({
      flowToken,
      password: 'Orbital!59Qa',
    });
  });
});
