import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalLocation = window.location;
const originalCrypto = window.crypto;
const originalIndexedDb = window.indexedDB;
const originalPublicKeyCredential = window.PublicKeyCredential;
const originalSecureContext = window.isSecureContext;
const originalCredentials = window.navigator.credentials;

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

const setRuntimeHost = ({ hostname, host = hostname }) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname,
      host,
    },
  });
};

const loadDeviceTrustModule = async () => {
  vi.resetModules();
  return import('./deviceTrustClient');
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
});
