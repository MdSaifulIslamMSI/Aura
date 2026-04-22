import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalLocation = window.location;
const originalCrypto = window.crypto;
const originalIndexedDb = window.indexedDB;
const originalPublicKeyCredential = window.PublicKeyCredential;
const originalSecureContext = window.isSecureContext;
const originalCredentials = window.navigator.credentials;
const originalUserAgent = window.navigator.userAgent;

const createAsyncRequest = (executor) => {
  const request = {
    error: null,
    result: undefined,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  };

  queueMicrotask(() => {
    try {
      request.result = executor();
      request.onsuccess?.();
    } catch (error) {
      request.error = error;
      request.onerror?.();
    }
  });

  return request;
};

const createIndexedDbMock = () => {
  const records = new Map();
  const db = {
    objectStoreNames: {
      contains: () => true,
    },
    createObjectStore: vi.fn(),
    transaction: () => ({
      objectStore: () => ({
        get: (deviceId) => createAsyncRequest(() => records.get(deviceId) || null),
        put: (record) => createAsyncRequest(() => {
          records.set(record.deviceId, record);
          return record;
        }),
        delete: (deviceId) => createAsyncRequest(() => {
          records.delete(deviceId);
          return undefined;
        }),
      }),
    }),
  };

  return {
    records,
    indexedDB: {
      open: () => {
        const request = {
          error: null,
          result: db,
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
        };

        queueMicrotask(() => {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });

        return request;
      },
    },
  };
};

const setRuntimeHost = ({ hostname, host = hostname, protocol = 'https:', origin = `${protocol}//${host}` }) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname,
      host,
      protocol,
      origin,
    },
  });
};

const loadDeviceTrustModule = async () => {
  vi.resetModules();
  return import('./deviceTrustClient');
};

const setUserAgent = (userAgent = originalUserAgent) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
};

describe('deviceTrustClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: originalIndexedDb,
    });
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: originalPublicKeyCredential,
    });
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: originalSecureContext,
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: originalCredentials,
    });
    setUserAgent();
  });

  it('marks 127.0.0.1 as a browser-key-only trusted-device host', async () => {
    const { indexedDB } = createIndexedDbMock();

    setRuntimeHost({ hostname: '127.0.0.1', host: '127.0.0.1:4173' });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDB });
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'uuid-127',
        subtle: {
          generateKey: vi.fn(),
          exportKey: vi.fn(),
          sign: vi.fn(),
        },
      },
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn(),
        get: vi.fn(),
      },
    });

    const deviceTrustClient = await loadDeviceTrustModule();

    expect(deviceTrustClient.getTrustedDeviceSupportProfile()).toMatchObject({
      webauthn: true,
      browserKeyFallback: true,
      runtimeHost: '127.0.0.1',
      webauthnHostEligible: false,
      localIpHost: true,
    });
  });

  it('falls back to a browser key when WebAuthn fails with an RP-ID host mismatch', async () => {
    const indexedDbMock = createIndexedDbMock();
    const createCredentialMock = vi.fn().mockRejectedValue(Object.assign(
      new Error('The relying party ID is not a registrable domain suffix of, nor equal to the current domain. Subsequently, an attempt to fetch the .well-known/webauthn resource of the claimed RP ID failed.'),
      { name: 'SecurityError' },
    ));
    const subtleMocks = {
      generateKey: vi.fn().mockResolvedValue({
        privateKey: { kind: 'private-key' },
        publicKey: { kind: 'public-key' },
      }),
      exportKey: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]).buffer),
      sign: vi.fn().mockResolvedValue(Uint8Array.from([5, 6, 7, 8]).buffer),
    };

    setRuntimeHost({ hostname: '127.0.0.1', host: '127.0.0.1:4173' });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDbMock.indexedDB });
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'uuid-fallback',
        subtle: subtleMocks,
      },
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: createCredentialMock,
        get: vi.fn(),
      },
    });

    const deviceTrustClient = await loadDeviceTrustModule();
    const result = await deviceTrustClient.signTrustedDeviceChallenge({
      availableMethods: ['webauthn', 'browser_key'],
      challenge: 'fallback-challenge',
      mode: 'enroll',
      webauthn: {
        registrationOptions: {
          challenge: 'ZmFsbGJhY2staWQ',
          user: {
            id: 'dXNlci1pZA',
            name: 'member@example.com',
            displayName: 'Member',
          },
          rp: {
            id: 'app.example.com',
            name: 'Aura Trusted Device',
          },
        },
      },
    });

    expect(createCredentialMock).toHaveBeenCalledTimes(1);
    expect(subtleMocks.generateKey).toHaveBeenCalledTimes(1);
    expect(subtleMocks.sign).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      method: 'browser_key',
      deviceId: expect.stringContaining('aura_'),
      publicKeySpkiBase64: expect.any(String),
      proofBase64: expect.any(String),
    });
  });

  it('allows explicitly choosing the RSA-PSS browser-key path when both methods are offered', async () => {
    const indexedDbMock = createIndexedDbMock();
    const subtleMocks = {
      generateKey: vi.fn().mockResolvedValue({
        privateKey: { kind: 'private-key' },
        publicKey: { kind: 'public-key' },
      }),
      exportKey: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]).buffer),
      sign: vi.fn().mockResolvedValue(Uint8Array.from([5, 6, 7, 8]).buffer),
    };
    const createCredentialMock = vi.fn();

    setRuntimeHost({ hostname: 'localhost', host: 'localhost:4173' });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDbMock.indexedDB });
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'uuid-explicit-browser-key',
        subtle: subtleMocks,
      },
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: createCredentialMock,
        get: vi.fn(),
      },
    });

    const deviceTrustClient = await loadDeviceTrustModule();
    const result = await deviceTrustClient.signTrustedDeviceChallenge({
      availableMethods: ['webauthn', 'browser_key'],
      challenge: 'explicit-browser-key',
      mode: 'enroll',
    }, {
      preferredMethod: 'browser_key',
    });

    expect(createCredentialMock).not.toHaveBeenCalled();
    expect(subtleMocks.generateKey).toHaveBeenCalledTimes(1);
    expect(subtleMocks.sign).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      method: 'browser_key',
      deviceId: expect.stringContaining('aura_'),
      publicKeySpkiBase64: expect.any(String),
      proofBase64: expect.any(String),
    });
  });

  it('forces platform user verification for biometric passkey registration', async () => {
    const indexedDbMock = createIndexedDbMock();
    const createCredentialMock = vi.fn().mockResolvedValue({
      id: 'credential-id',
      rawId: Uint8Array.from([1, 2, 3, 4]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: Uint8Array.from([5, 6, 7, 8]).buffer,
        attestationObject: Uint8Array.from([9, 10, 11, 12]).buffer,
        getTransports: () => ['internal'],
      },
    });

    setRuntimeHost({ hostname: 'localhost', host: 'localhost:4173' });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDbMock.indexedDB });
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'uuid-platform-passkey',
        subtle: {
          generateKey: vi.fn(),
          exportKey: vi.fn(),
          sign: vi.fn(),
        },
      },
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: createCredentialMock,
        get: vi.fn(),
      },
    });

    const deviceTrustClient = await loadDeviceTrustModule();
    const result = await deviceTrustClient.signTrustedDeviceChallenge({
      availableMethods: ['webauthn'],
      challenge: 'platform-passkey',
      mode: 'enroll',
      webauthn: {
        registrationOptions: {
          challenge: 'cGxhdGZvcm0tcGFzc2tleQ',
          user: {
            id: 'dXNlci1pZA',
            name: 'member@example.com',
            displayName: 'Member',
          },
          rp: {
            id: 'localhost',
            name: 'Aura Trusted Device',
          },
          authenticatorSelection: {
            userVerification: 'preferred',
          },
        },
      },
    });

    expect(createCredentialMock).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({
        authenticatorSelection: expect.objectContaining({
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        }),
      }),
    });
    expect(result).toMatchObject({
      method: 'webauthn',
      deviceId: expect.stringContaining('aura_'),
      credential: expect.objectContaining({
        authenticatorAttachment: 'platform',
      }),
    });
  });

  it('requires user verification for biometric passkey assertions', async () => {
    const indexedDbMock = createIndexedDbMock();
    const getCredentialMock = vi.fn().mockResolvedValue({
      id: 'credential-id',
      rawId: Uint8Array.from([1, 2, 3, 4]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: Uint8Array.from([5, 6, 7, 8]).buffer,
        authenticatorData: Uint8Array.from([9, 10, 11, 12]).buffer,
        signature: Uint8Array.from([13, 14, 15, 16]).buffer,
        userHandle: null,
      },
    });

    setRuntimeHost({ hostname: 'localhost', host: 'localhost:4173' });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDbMock.indexedDB });
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'uuid-platform-assertion',
        subtle: {
          generateKey: vi.fn(),
          exportKey: vi.fn(),
          sign: vi.fn(),
        },
      },
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn(),
        get: getCredentialMock,
      },
    });

    const deviceTrustClient = await loadDeviceTrustModule();
    await deviceTrustClient.signTrustedDeviceChallenge({
      availableMethods: ['webauthn'],
      challenge: 'platform-assertion',
      mode: 'assert',
      webauthn: {
        assertionOptions: {
          challenge: 'cGxhdGZvcm0tYXNzZXJ0aW9u',
          rpId: 'localhost',
          userVerification: 'preferred',
          allowCredentials: [{
            id: 'AQIDBA',
            type: 'public-key',
            transports: ['internal'],
          }],
        },
      },
    });

    expect(getCredentialMock).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({
        userVerification: 'required',
      }),
    });
  });

  it('does not silently fall back to the browser key when passkey was explicitly chosen', async () => {
    const indexedDbMock = createIndexedDbMock();
    const createCredentialMock = vi.fn().mockRejectedValue(Object.assign(
      new Error('The relying party ID is not a registrable domain suffix of, nor equal to the current domain. Subsequently, an attempt to fetch the .well-known/webauthn resource of the claimed RP ID failed.'),
      { name: 'SecurityError' },
    ));
    const subtleMocks = {
      generateKey: vi.fn(),
      exportKey: vi.fn(),
      sign: vi.fn(),
    };

    setRuntimeHost({ hostname: 'localhost', host: 'localhost:4173' });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDbMock.indexedDB });
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'uuid-explicit-passkey',
        subtle: subtleMocks,
      },
    });
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: createCredentialMock,
        get: vi.fn(),
      },
    });

    const deviceTrustClient = await loadDeviceTrustModule();

    await expect(deviceTrustClient.signTrustedDeviceChallenge({
      availableMethods: ['webauthn', 'browser_key'],
      challenge: 'explicit-passkey',
      mode: 'enroll',
      webauthn: {
        registrationOptions: {
          challenge: 'ZmFsbGJhY2staWQ',
          user: {
            id: 'dXNlci1pZA',
            name: 'member@example.com',
            displayName: 'Member',
          },
          rp: {
            id: 'localhost',
            name: 'Aura Trusted Device',
          },
        },
      },
    }, {
      preferredMethod: 'webauthn',
    })).rejects.toThrow('The relying party ID is not a registrable domain suffix');

    expect(createCredentialMock).toHaveBeenCalledTimes(1);
    expect(subtleMocks.generateKey).not.toHaveBeenCalled();
    expect(subtleMocks.sign).not.toHaveBeenCalled();
  });

  it('stores the trusted-device session token in sessionStorage by default', async () => {
    const deviceTrustClient = await loadDeviceTrustModule();

    deviceTrustClient.cacheTrustedDeviceSessionToken('shared-device-token');

    expect(localStorage.getItem('aura_trusted_device_session_v1')).toBeNull();
    expect(sessionStorage.getItem('aura_trusted_device_session_v1')).toBe('shared-device-token');
    expect(deviceTrustClient.getTrustedDeviceSessionToken()).toBe('shared-device-token');
  });

  it('reads an existing tab-scoped trusted-device token without persisting it', async () => {
    sessionStorage.setItem('aura_trusted_device_session_v1', 'legacy-tab-token');
    const deviceTrustClient = await loadDeviceTrustModule();

    expect(deviceTrustClient.getTrustedDeviceSessionToken()).toBe('legacy-tab-token');
    expect(localStorage.getItem('aura_trusted_device_session_v1')).toBeNull();
  });

  it('persists the trusted-device session token across tabs on hosted frontends', async () => {
    setRuntimeHost({
      hostname: 'aurapilot.vercel.app',
      host: 'aurapilot.vercel.app',
      protocol: 'https:',
      origin: 'https://aurapilot.vercel.app',
    });
    const deviceTrustClient = await loadDeviceTrustModule();

    deviceTrustClient.cacheTrustedDeviceSessionToken('shared-device-token');

    expect(sessionStorage.getItem('aura_trusted_device_session_v1')).toBe('shared-device-token');
    expect(localStorage.getItem('aura_trusted_device_session_v1')).toBe('shared-device-token');
  });

  it('persists the trusted-device session token across desktop app restarts', async () => {
    setRuntimeHost({
      hostname: 'localhost',
      host: 'localhost:47831',
      protocol: 'http:',
      origin: 'http://localhost:47831',
    });
    setUserAgent(`${originalUserAgent} Electron/37.2.1`);
    const deviceTrustClient = await loadDeviceTrustModule();

    deviceTrustClient.cacheTrustedDeviceSessionToken('desktop-device-token');

    expect(sessionStorage.getItem('aura_trusted_device_session_v1')).toBe('desktop-device-token');
    expect(localStorage.getItem('aura_trusted_device_session_v1')).toBe('desktop-device-token');
  });

  it('promotes an existing tab-scoped trusted-device token into shared storage on hosted frontends', async () => {
    setRuntimeHost({
      hostname: 'aurapilot.netlify.app',
      host: 'aurapilot.netlify.app',
      protocol: 'https:',
      origin: 'https://aurapilot.netlify.app',
    });
    sessionStorage.setItem('aura_trusted_device_session_v1', 'legacy-tab-token');
    const deviceTrustClient = await loadDeviceTrustModule();

    expect(deviceTrustClient.getTrustedDeviceSessionToken()).toBe('legacy-tab-token');
    expect(localStorage.getItem('aura_trusted_device_session_v1')).toBe('legacy-tab-token');
  });

  it('includes the current browser origin in trusted-device headers for session bootstrap requests', async () => {
    setRuntimeHost({
      hostname: 'aurapilot.vercel.app',
      host: 'aurapilot.vercel.app',
      protocol: 'https:',
      origin: 'https://aurapilot.vercel.app',
    });
    const deviceTrustClient = await loadDeviceTrustModule();

    expect(deviceTrustClient.getTrustedDeviceHeaders()).toMatchObject({
      'X-Aura-Client-Origin': 'https://aurapilot.vercel.app',
      'X-Aura-Device-Id': expect.stringContaining('aura_'),
      'X-Aura-Device-Label': expect.any(String),
    });
  });
});
