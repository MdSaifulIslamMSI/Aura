import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  initializeAppMock: vi.fn(() => ({ name: 'firebase-app' })),
  getAnalyticsMock: vi.fn(() => ({ name: 'firebase-analytics' })),
  getAuthMock: vi.fn(() => ({ name: 'firebase-auth' })),
}));

vi.mock('firebase/app', () => ({
  initializeApp: firebaseMocks.initializeAppMock,
}));

vi.mock('firebase/auth', () => ({
  getAuth: firebaseMocks.getAuthMock,
  GoogleAuthProvider: class GoogleAuthProvider {},
  FacebookAuthProvider: class FacebookAuthProvider {
    setCustomParameters() {}
  },
  TwitterAuthProvider: class TwitterAuthProvider {},
}));

vi.mock('firebase/analytics', () => ({
  getAnalytics: firebaseMocks.getAnalyticsMock,
}));

const originalLocation = window.location;
const originalMatchMedia = window.matchMedia;
const originalUserAgent = window.navigator.userAgent;

const setRuntimeHost = ({ hostname, host = hostname }) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname,
      host,
    },
  });
};

const setDisplayModes = (activeModes = []) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: activeModes.some((mode) => query.includes(`display-mode: ${mode}`)),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const setUserAgent = (userAgent = originalUserAgent) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
};

const setFirebaseEnv = (suffix = '') => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', `firebase-api-key${suffix}`);
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', `billy-b674c.firebaseapp.com${suffix}`);
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', `billy-b674c${suffix}`);
  vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', `billy-b674c.firebasestorage.app${suffix}`);
  vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', `32774635133${suffix}`);
  vi.stubEnv('VITE_FIREBASE_APP_ID', `1:32774635133:web:e9b7a433e45debcee07b14${suffix}`);
  vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', `G-W600CSNCFN${suffix}`);
  vi.stubEnv('VITE_FIREBASE_DISABLE_SOCIAL_AUTH', 'false');
  vi.stubEnv('VITE_FIREBASE_FORCE_REDIRECT_SOCIAL_AUTH', 'false');
};

const loadFirebaseModule = async ({ hostname, host = hostname }) => {
  vi.resetModules();
  setFirebaseEnv();
  window.sessionStorage.clear();
  setRuntimeHost({ hostname, host });
  setDisplayModes([]);
  setUserAgent();
  return import('./firebase');
};

describe('firebase social auth host policy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    setUserAgent();
  });

  it('prefers redirect-first social auth on 127.0.0.1 while keeping social auth available', async () => {
    const firebase = await loadFirebaseModule({
      hostname: '127.0.0.1',
      host: '127.0.0.1:4173',
    });

    expect(firebase.shouldPreferFirebaseRedirectAuth()).toBe(true);
    expect(firebase.isFirebaseSocialAuthAvailable()).toBe(true);
    expect(firebase.getFirebaseSocialAuthStatus()).toMatchObject({
      runtimeHost: '127.0.0.1',
      runtimeIpHost: true,
      redirectPreferred: true,
      supported: true,
    });
  });

  it('keeps popup-first social auth on localhost when no runtime block is present', async () => {
    const firebase = await loadFirebaseModule({
      hostname: 'localhost',
      host: 'localhost:4173',
    });

    expect(firebase.shouldPreferFirebaseRedirectAuth()).toBe(false);
    expect(firebase.getFirebaseSocialAuthStatus()).toMatchObject({
      runtimeHost: 'localhost',
      runtimeIpHost: false,
      redirectPreferred: false,
      supported: true,
    });
  });

  it('keeps Electron desktop social auth popup-first on loopback hosts', async () => {
    vi.resetModules();
    setFirebaseEnv();
    window.sessionStorage.clear();
    setRuntimeHost({
      hostname: '127.0.0.1',
      host: '127.0.0.1:4173',
    });
    setDisplayModes([]);
    setUserAgent(`${originalUserAgent} Electron/37.2.1`);

    const firebase = await import('./firebase');

    expect(firebase.shouldPreferFirebaseRedirectAuth()).toBe(false);
    expect(firebase.getFirebaseSocialAuthStatus()).toMatchObject({
      runtimeHost: '127.0.0.1',
      runtimeIpHost: true,
      runtimeElectronDesktop: true,
      redirectPreferred: false,
      supported: true,
    });
  });

  it('prefers redirect-first social auth in standalone app mode even on localhost', async () => {
    vi.resetModules();
    setFirebaseEnv();
    window.sessionStorage.clear();
    setRuntimeHost({
      hostname: 'localhost',
      host: 'localhost:4173',
    });
    setDisplayModes(['standalone']);

    const firebase = await import('./firebase');

    expect(firebase.shouldPreferFirebaseRedirectAuth()).toBe(true);
    expect(firebase.getFirebaseSocialAuthStatus()).toMatchObject({
      runtimeHost: 'localhost',
      runtimeIpHost: false,
      runtimeStandaloneApp: true,
      redirectPreferred: true,
      supported: true,
    });
  });

  it('switches to redirect-first mode after a runtime host rejection without disabling social auth', async () => {
    const firebase = await loadFirebaseModule({
      hostname: 'localhost',
      host: 'localhost:4173',
    });

    expect(firebase.shouldPreferFirebaseRedirectAuth()).toBe(false);

    firebase.markFirebaseSocialAuthRejectedForRuntime({
      code: 'auth/unauthorized-domain',
      message: 'This domain is not authorized.',
    });

    expect(firebase.shouldPreferFirebaseRedirectAuth()).toBe(true);
    expect(firebase.isFirebaseSocialAuthAvailable()).toBe(true);
    expect(firebase.getFirebaseSocialAuthStatus()).toMatchObject({
      runtimeBlocked: true,
      redirectPreferred: true,
      supported: true,
    });
  });

  it('sanitizes literal escaped control sequences from Firebase env values', async () => {
    vi.resetModules();
    setFirebaseEnv('\\r');
    window.sessionStorage.clear();
    setRuntimeHost({
      hostname: 'aurapilot.vercel.app',
      host: 'aurapilot.vercel.app',
    });
    setDisplayModes([]);

    const firebase = await import('./firebase');

    expect(firebase.firebaseConfig).toMatchObject({
      apiKey: 'firebase-api-key',
      authDomain: 'billy-b674c.firebaseapp.com',
      projectId: 'billy-b674c',
      storageBucket: 'billy-b674c.firebasestorage.app',
      messagingSenderId: '32774635133',
      appId: '1:32774635133:web:e9b7a433e45debcee07b14',
      measurementId: 'G-W600CSNCFN',
    });
    expect(firebase.getFirebaseSocialAuthStatus()).toMatchObject({
      ready: true,
      runtimeHost: 'aurapilot.vercel.app',
      supported: true,
    });
  });

  it('treats Netlify production hosts as deployment hosts for social auth policy', async () => {
    vi.resetModules();
    setFirebaseEnv();
    vi.stubEnv('VITE_FIREBASE_DISABLE_SOCIAL_AUTH', 'true');
    window.sessionStorage.clear();
    setRuntimeHost({
      hostname: 'aurapilot.netlify.app',
      host: 'aurapilot.netlify.app',
    });
    setDisplayModes([]);

    const firebase = await import('./firebase');

    expect(firebase.isFirebaseSocialAuthAvailable()).toBe(true);
    expect(firebase.getFirebaseSocialAuthStatus()).toMatchObject({
      runtimeHost: 'aurapilot.netlify.app',
      supported: true,
      disabledByConfig: false,
    });
  });
});
