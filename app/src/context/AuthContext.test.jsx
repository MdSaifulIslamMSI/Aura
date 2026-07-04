import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';

let AuthProvider;
let useAuth;
let resetBrowserSessionState;
let mocks;

const loadAuthContext = async () => {
  vi.resetModules();

  mocks = {
    signOutMock: vi.fn().mockResolvedValue(undefined),
    onAuthStateChangedMock: vi.fn(),
    getRedirectResultMock: vi.fn().mockResolvedValue(null),
    emailCredentialMock: vi.fn((email, password) => ({ providerId: 'password', email, password })),
    linkWithPopupMock: vi.fn(),
    linkWithCredentialMock: vi.fn(),
    linkWithRedirectMock: vi.fn().mockResolvedValue(undefined),
    reauthenticateWithCredentialMock: vi.fn().mockResolvedValue({ user: null }),
    reauthenticateWithPopupMock: vi.fn(),
    reauthenticateWithRedirectMock: vi.fn().mockResolvedValue(undefined),
    signInWithEmailAndPasswordMock: vi.fn(),
    signInWithCustomTokenMock: vi.fn(),
    signInWithRedirectMock: vi.fn().mockResolvedValue(undefined),
    signInWithPopupMock: vi.fn(),
    shouldUseNativeSocialAuthMock: vi.fn().mockReturnValue(false),
    signInWithNativeSocialProviderMock: vi.fn(),
    signOutNativeSocialAuthMock: vi.fn().mockResolvedValue(undefined),
    shouldPreferFirebaseRedirectAuthMock: vi.fn().mockReturnValue(false),
    clearCsrfTokenCacheMock: vi.fn(),
    cacheTrustedDeviceSessionTokenMock: vi.fn(),
    clearTrustedDeviceSessionTokenMock: vi.fn(),
    authApiMock: {
      exchangeSession: vi.fn(),
      createDesktopHandoffToken: vi.fn(),
      getSession: vi.fn(),
      generateRecoveryCodes: vi.fn(),
      logoutSession: vi.fn(),
      syncSession: vi.fn(),
      setupTotp: vi.fn(),
      verifyTotpSetup: vi.fn(),
      registerMfaPasskey: vi.fn(),
      regenerateMfaRecoveryCodes: vi.fn(),
      verifyDeviceChallenge: vi.fn(),
    },
    mockUser: {
      uid: 'firebase-user-1',
      email: 'stale@example.com',
      emailVerified: true,
      displayName: 'Stale Session',
      phoneNumber: '+919999999999',
      providerData: [],
      getIdToken: vi.fn().mockResolvedValue('firebase-token'),
    },
  };

  vi.doMock('firebase/auth', () => ({
    createUserWithEmailAndPassword: vi.fn(),
    EmailAuthProvider: { credential: mocks.emailCredentialMock },
    FacebookAuthProvider: { credentialFromError: vi.fn(() => null) },
    getRedirectResult: mocks.getRedirectResultMock,
    GithubAuthProvider: { credentialFromError: vi.fn((error) => error?.githubCredential || null) },
    GoogleAuthProvider: { credentialFromError: vi.fn(() => null) },
    linkWithCredential: mocks.linkWithCredentialMock,
    linkWithPopup: mocks.linkWithPopupMock,
    linkWithRedirect: mocks.linkWithRedirectMock,
    OAuthProvider: { credentialFromError: vi.fn((error) => error?.oauthCredential || null) },
    signInWithEmailAndPassword: mocks.signInWithEmailAndPasswordMock,
    signInWithCredential: vi.fn(),
    signInWithCustomToken: mocks.signInWithCustomTokenMock,
    signInWithRedirect: mocks.signInWithRedirectMock,
    signOut: mocks.signOutMock,
    onAuthStateChanged: mocks.onAuthStateChangedMock,
    reauthenticateWithCredential: mocks.reauthenticateWithCredentialMock,
    reauthenticateWithPopup: mocks.reauthenticateWithPopupMock,
    reauthenticateWithRedirect: mocks.reauthenticateWithRedirectMock,
    updateProfile: vi.fn(),
    signInWithPopup: mocks.signInWithPopupMock,
    TwitterAuthProvider: { credentialFromError: vi.fn(() => null) },
  }));

  vi.doMock('../config/firebase', () => ({
    auth: {},
    googleProvider: { providerId: 'google.com' },
    facebookProvider: { providerId: 'facebook.com' },
    githubProvider: { providerId: 'github.com' },
    microsoftProvider: { providerId: 'microsoft.com' },
    appleProvider: null,
    xProvider: { providerId: 'twitter.com' },
    assertFirebaseReady: vi.fn(),
    assertFirebaseSocialAuthReady: vi.fn(),
    clearFirebaseSocialAuthRuntimeBlock: vi.fn(),
    isFirebaseReady: true,
    markFirebaseSocialAuthRejectedForRuntime: vi.fn(),
    shouldPreferFirebaseRedirectAuth: mocks.shouldPreferFirebaseRedirectAuthMock,
  }));

  vi.doMock('../services/api', () => ({
    authApi: mocks.authApiMock,
    userApi: {
      updateProfile: vi.fn(),
      activateSeller: vi.fn(),
      deactivateSeller: vi.fn(),
    },
  }));

  vi.doMock('../services/csrfTokenManager', () => ({
    clearCsrfTokenCache: mocks.clearCsrfTokenCacheMock,
  }));

  vi.doMock('../services/deviceTrustClient', () => ({
    cacheTrustedDeviceSessionToken: mocks.cacheTrustedDeviceSessionTokenMock,
    clearTrustedDeviceSessionToken: mocks.clearTrustedDeviceSessionTokenMock,
  }));

  vi.doMock('../services/nativeSocialAuth', () => ({
    shouldUseNativeSocialAuth: mocks.shouldUseNativeSocialAuthMock,
    signInWithNativeSocialProvider: mocks.signInWithNativeSocialProviderMock,
    signOutNativeSocialAuth: mocks.signOutNativeSocialAuthMock,
  }));

  vi.doMock('../utils/authAcceleration', () => ({
    clearAuthJourneyDraft: vi.fn(),
    writeAuthIdentityMemory: vi.fn(),
  }));

  ({ AuthProvider, useAuth } = await import('./AuthContext'));
  ({ resetBrowserSessionState } = await import('../services/browserSessionReset'));
};

describe('AuthProvider', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    await loadAuthContext();
    mocks.getRedirectResultMock.mockResolvedValue(null);
    mocks.onAuthStateChangedMock.mockImplementation((_auth, callback) => {
      callback(mocks.mockUser);
      return () => {};
    });
    mocks.authApiMock.exchangeSession.mockResolvedValue({
      status: 'authenticated',
      session: { sessionId: 'server-session-1' },
    });
    mocks.authApiMock.getSession.mockResolvedValue({
      status: 'authenticated',
      session: {
        sessionId: 'server-session-1',
        uid: 'firebase-user-1',
        email: 'stale@example.com',
        emailVerified: true,
        displayName: 'Stale Session',
        phone: '+919999999999',
        providerIds: [],
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
        phone: '+919999999999',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: true,
          hasPhone: true,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'password',
          rememberedIdentifier: 'email+phone',
          suggestedProvider: '',
          providerIds: [],
        },
      },
    });
    mocks.authApiMock.logoutSession.mockResolvedValue({ success: true });
    mocks.authApiMock.generateRecoveryCodes.mockResolvedValue({ success: true });
    mocks.authApiMock.setupTotp.mockResolvedValue({ success: true });
    mocks.authApiMock.verifyTotpSetup.mockResolvedValue({ success: true });
    mocks.authApiMock.registerMfaPasskey.mockResolvedValue({ success: true });
    mocks.authApiMock.regenerateMfaRecoveryCodes.mockResolvedValue({ success: true });
    mocks.authApiMock.verifyDeviceChallenge.mockResolvedValue({
      success: true,
      status: 'authenticated',
      deviceSessionToken: 'trusted-device-session-token',
      expiresAt: '2026-04-12T14:00:00.000Z',
      deviceChallenge: null,
      session: {
        sessionId: 'server-session-1',
        uid: 'firebase-user-1',
        email: 'stale@example.com',
        emailVerified: true,
        displayName: 'Stale Session',
        phone: '+919999999999',
        providerIds: [],
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
        phone: '+919999999999',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: true,
          hasPhone: true,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'password',
          rememberedIdentifier: 'email+phone',
          suggestedProvider: '',
          providerIds: [],
        },
      },
    });
  });

  it('clears stale firebase sessions when the backend rejects the auth token', async () => {
    mocks.authApiMock.getSession.mockRejectedValue(
      Object.assign(new Error('Not authorized, token failed'), {
        status: 401,
      })
    );

    const AuthProbe = () => {
      const { currentUser, status } = useAuth();
      return (
        <>
          <div data-testid="auth-status">{status}</div>
          <div data-testid="auth-user">{currentUser?.email || 'none'}</div>
        </>
      );
    };

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('signed_out');
    });

    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
    expect(mocks.clearCsrfTokenCacheMock).toHaveBeenCalled();
    expect(mocks.clearTrustedDeviceSessionTokenMock).toHaveBeenCalled();
    expect(mocks.authApiMock.logoutSession).toHaveBeenCalled();
    expect(mocks.authApiMock.exchangeSession).not.toHaveBeenCalled();
  });

  it('reset clears local app storage during browser session recovery', async () => {
    window.localStorage.setItem('aura_trusted_device_id_v1', 'device-1');
    window.localStorage.setItem('firebase:authUser:project:web', 'firebase-user');
    window.sessionStorage.setItem('aura_trusted_device_session_v1', 'trusted-session');
    window.sessionStorage.setItem('aura-social-auth-redirect-pending', '1');

    const result = await resetBrowserSessionState({
      redirect: false,
      windowRef: window,
      cacheStorage: null,
      serviceWorkerContainer: null,
      indexedDBRef: null,
    });

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(result.clearedLocalStorageKeys).toEqual(expect.arrayContaining([
      'aura_trusted_device_id_v1',
      'firebase:authUser:project:web',
    ]));
    expect(result.clearedSessionStorageKeys).toEqual(expect.arrayContaining([
      'aura_trusted_device_session_v1',
      'aura-social-auth-redirect-pending',
    ]));
  });

  it('reset clears origin caches and unregisters service workers when present', async () => {
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['aura-runtime-v4', 'old-aura-runtime']),
      delete: vi.fn().mockResolvedValue(true),
    };
    const firstUnregister = vi.fn().mockResolvedValue(true);
    const secondUnregister = vi.fn().mockResolvedValue(true);
    const serviceWorkerContainer = {
      getRegistrations: vi.fn().mockResolvedValue([
        { unregister: firstUnregister },
        { unregister: secondUnregister },
      ]),
    };

    const result = await resetBrowserSessionState({
      redirect: false,
      windowRef: null,
      cacheStorage,
      serviceWorkerContainer,
      indexedDBRef: null,
    });

    expect(cacheStorage.keys).toHaveBeenCalledTimes(1);
    expect(cacheStorage.delete).toHaveBeenCalledWith('aura-runtime-v4');
    expect(cacheStorage.delete).toHaveBeenCalledWith('old-aura-runtime');
    expect(serviceWorkerContainer.getRegistrations).toHaveBeenCalledTimes(1);
    expect(firstUnregister).toHaveBeenCalledTimes(1);
    expect(secondUnregister).toHaveBeenCalledTimes(1);
    expect(result.unregisteredServiceWorkerCount).toBe(2);
  });

  it('reset calls backend logout and Firebase signOut before local cleanup', async () => {
    const firebaseAuth = { currentUser: mocks.mockUser };
    const logoutSession = vi.fn().mockResolvedValue({ success: true });
    const firebaseSignOut = vi.fn().mockResolvedValue(undefined);

    const result = await resetBrowserSessionState({
      redirect: false,
      windowRef: null,
      cacheStorage: null,
      serviceWorkerContainer: null,
      indexedDBRef: null,
      logoutSession,
      firebaseAuth,
      firebaseSignOut,
    });

    expect(logoutSession).toHaveBeenCalledWith({ firebaseUser: mocks.mockUser });
    expect(firebaseSignOut).toHaveBeenCalledWith(firebaseAuth);
    expect(result.backendLogout).toBe(true);
    expect(result.firebaseSignOut).toBe(true);
  });

  it('reset redirects to login after browser session recovery cleanup', async () => {
    const redirectFn = vi.fn();

    const result = await resetBrowserSessionState({
      windowRef: null,
      cacheStorage: null,
      serviceWorkerContainer: null,
      indexedDBRef: null,
      redirectFn,
    });

    expect(redirectFn).toHaveBeenCalledWith('/login');
    expect(result.redirectedTo).toBe('/login');
  });

  it('softens masked backend 500s during session bootstrap into a recoverable sync message', async () => {
    mocks.authApiMock.getSession.mockRejectedValue(
      Object.assign(new Error('Something went wrong!'), {
        status: 500,
        serverRequestId: 'srv-session-sync-1',
      })
    );

    const AuthProbe = () => {
      const { status, sessionError } = useAuth();
      return (
        <>
          <div data-testid="auth-status">{status}</div>
          <div data-testid="auth-error">{sessionError?.message || 'none'}</div>
        </>
      );
    };

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('recoverable_error');
    });

    expect(screen.getByTestId('auth-error')).toHaveTextContent('server could not finish session sync');
    expect(screen.getByTestId('auth-error')).toHaveTextContent('srv-session-sync-1');
  });

  it('refreshes the shared backend session when the window regains focus', async () => {
    const Probe = () => {
      const { status } = useAuth();
      return <div data-testid="focus-status">{status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('focus-status')).toHaveTextContent('authenticated');
      expect(mocks.authApiMock.getSession).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(mocks.authApiMock.getSession).toHaveBeenCalledTimes(2);
    });
  });

  it('syncs X sign-in even when the provider does not return an email', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    mocks.authApiMock.syncSession.mockResolvedValue({
      status: 'authenticated',
      session: {
        uid: 'oauth-user-1',
        email: '',
        emailVerified: false,
        displayName: 'X User',
        phone: '',
        providerIds: ['twitter.com'],
      },
      profile: {
        _id: 'db-user-1',
        name: 'X User',
        email: '',
        phone: '',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: false,
          hasPhone: false,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'social',
          rememberedIdentifier: 'email',
          suggestedProvider: 'twitter.com',
          providerIds: ['twitter.com'],
        },
      },
    });
    mocks.signInWithPopupMock.mockResolvedValue({
      user: {
        uid: 'oauth-user-1',
        email: '',
        displayName: 'X User',
        phoneNumber: '',
        providerData: [],
        getIdToken: vi.fn().mockResolvedValue('oauth-user-token'),
      },
    });

    const Probe = () => {
      const { currentUser, signInWithX, status } = useAuth();
      const [error, setError] = React.useState('');

      React.useEffect(() => {
        signInWithX().catch((err) => setError(err.message));
      }, [signInWithX]);

      return (
        <>
          <div data-testid="oauth-status">{status}</div>
          <div data-testid="oauth-user">{currentUser?.email || 'none'}</div>
          <div data-testid="oauth-error">{error || 'none'}</div>
        </>
      );
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('oauth-status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('oauth-error')).toHaveTextContent('none');
    });

    expect(screen.getByTestId('oauth-user')).toHaveTextContent('none');
    expect(mocks.authApiMock.exchangeSession).not.toHaveBeenCalled();
    expect(mocks.authApiMock.syncSession).toHaveBeenCalled();
    expect(mocks.signOutMock).not.toHaveBeenCalled();
  });

  it('prevents popup X sign-in from being cancelled by an auth-state refresh race', async () => {
    let authStateCallback = null;

    mocks.onAuthStateChangedMock.mockImplementation((_auth, callback) => {
      authStateCallback = callback;
      return () => {};
    });

    const oauthUser = {
      uid: 'oauth-race-user-1',
      email: '',
      emailVerified: false,
      displayName: 'Race Safe User',
      phoneNumber: '',
      providerData: [{ providerId: 'twitter.com' }],
      getIdToken: vi.fn().mockResolvedValue('oauth-race-token'),
    };

    mocks.authApiMock.syncSession.mockResolvedValue({
      status: 'authenticated',
      session: {
        uid: oauthUser.uid,
        email: '',
        emailVerified: false,
        displayName: oauthUser.displayName,
        phone: '',
        providerIds: ['twitter.com'],
      },
      profile: {
        _id: 'db-user-race-1',
        name: oauthUser.displayName,
        email: '',
        phone: '',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: false,
          hasPhone: false,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'social',
          rememberedIdentifier: 'email',
          suggestedProvider: 'twitter.com',
          providerIds: ['twitter.com'],
        },
      },
    });

    mocks.signInWithPopupMock.mockImplementation(async () => {
      authStateCallback?.(oauthUser);
      return {
        user: oauthUser,
        _tokenResponse: { isNewUser: false },
      };
    });

    const Probe = () => {
      const { signInWithX, status } = useAuth();
      const [error, setError] = React.useState('');

      React.useEffect(() => {
        signInWithX().catch((err) => setError(err.message));
      }, [signInWithX]);

      return (
        <>
          <div data-testid="oauth-status">{status}</div>
          <div data-testid="oauth-error">{error || 'none'}</div>
        </>
      );
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('oauth-status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('oauth-error')).toHaveTextContent('none');
    });

    expect(mocks.authApiMock.exchangeSession).not.toHaveBeenCalled();
    expect(mocks.authApiMock.getSession).not.toHaveBeenCalled();
    expect(mocks.authApiMock.syncSession).toHaveBeenCalled();
    expect(mocks.signOutMock).not.toHaveBeenCalled();
  });

  it('uses redirect social auth when the host policy prefers redirect-first', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    mocks.shouldPreferFirebaseRedirectAuthMock.mockReturnValue(true);

    const Probe = () => {
      const { signInWithGoogle } = useAuth();
      const [result, setResult] = React.useState('idle');

      React.useEffect(() => {
        signInWithGoogle()
          .then((value) => setResult(value?.redirecting ? 'redirecting' : 'done'))
          .catch((error) => setResult(error.message));
      }, [signInWithGoogle]);

      return <div data-testid="oauth-route">{result}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('oauth-route')).toHaveTextContent('redirecting');
    });

    expect(mocks.signInWithRedirectMock).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPopupMock).not.toHaveBeenCalled();
  });

  it('keeps popup social auth on safe hosts when redirect is not preferred', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    mocks.shouldPreferFirebaseRedirectAuthMock.mockReturnValue(false);
    mocks.authApiMock.syncSession.mockResolvedValue({
      status: 'authenticated',
      session: {
        uid: 'popup-user-1',
        email: 'popup@example.com',
        emailVerified: true,
        displayName: 'Popup User',
        phone: '',
        providerIds: ['google.com'],
      },
      profile: {
        _id: 'db-popup-user-1',
        name: 'Popup User',
        email: 'popup@example.com',
        phone: '',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: true,
          hasPhone: false,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'social',
          rememberedIdentifier: 'email',
          suggestedProvider: 'google.com',
          providerIds: ['google.com'],
        },
      },
    });
    mocks.signInWithPopupMock.mockResolvedValue({
      user: {
        uid: 'popup-user-1',
        email: 'popup@example.com',
        displayName: 'Popup User',
        phoneNumber: '',
        providerData: [{ providerId: 'google.com' }],
      },
      _tokenResponse: { isNewUser: false },
    });

    const Probe = () => {
      const { signInWithGoogle } = useAuth();
      const [result, setResult] = React.useState('idle');

      React.useEffect(() => {
        signInWithGoogle()
          .then(() => setResult('popup'))
          .catch((error) => setResult(error.message));
      }, [signInWithGoogle]);

      return <div data-testid="oauth-route">{result}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('oauth-route')).toHaveTextContent('popup');
    });

    expect(mocks.signInWithPopupMock).toHaveBeenCalled();
    expect(mocks.signInWithRedirectMock).not.toHaveBeenCalled();
  });

  it('links Microsoft to the currently signed-in account with popup OAuth', async () => {
    mocks.onAuthStateChangedMock.mockImplementation((_auth, callback) => {
      callback({
        ...mocks.mockUser,
        providerData: [{ providerId: 'password' }],
      });
      return () => {};
    });
    mocks.linkWithPopupMock.mockResolvedValue({
      user: {
        ...mocks.mockUser,
        providerData: [{ providerId: 'password' }, { providerId: 'microsoft.com' }],
      },
    });

    const Probe = () => {
      const { currentUser, linkMicrosoftProvider } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (!currentUser?.uid || startedRef.current) return;
        startedRef.current = true;
        linkMicrosoftProvider()
          .then(() => setResult('linked'))
          .catch((error) => setResult(error.message));
      }, [currentUser?.uid, linkMicrosoftProvider]);

      return <div data-testid="provider-link-result">{result}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('provider-link-result')).toHaveTextContent('linked');
    });

    expect(mocks.linkWithPopupMock).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'firebase-user-1' }),
      expect.objectContaining({ providerId: 'microsoft.com' }),
    );
    expect(mocks.authApiMock.getSession).toHaveBeenCalled();
  });

  it('short-circuits Microsoft linking when the provider is already attached', async () => {
    mocks.onAuthStateChangedMock.mockImplementation((_auth, callback) => {
      callback({
        ...mocks.mockUser,
        providerData: [{ providerId: 'password' }, { providerId: 'microsoft.com' }],
      });
      return () => {};
    });

    const Probe = () => {
      const { currentUser, linkMicrosoftProvider } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (!currentUser?.uid || startedRef.current) return;
        startedRef.current = true;
        linkMicrosoftProvider()
          .then((value) => setResult(value?.alreadyLinked ? 'already-linked' : 'linked'))
          .catch((error) => setResult(error.message));
      }, [currentUser?.uid, linkMicrosoftProvider]);

      return <div data-testid="provider-link-result">{result}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('provider-link-result')).toHaveTextContent('already-linked');
    });

    expect(mocks.linkWithPopupMock).not.toHaveBeenCalled();
    expect(mocks.linkWithRedirectMock).not.toHaveBeenCalled();
  });

  it('uses native Capacitor social auth on mobile instead of popup or redirect OAuth', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    mocks.shouldUseNativeSocialAuthMock.mockReturnValue(true);
    mocks.authApiMock.syncSession.mockResolvedValue({
      status: 'authenticated',
      session: {
        uid: 'native-google-user-1',
        email: 'native@example.com',
        emailVerified: true,
        displayName: 'Native Google User',
        phone: '',
        providerIds: ['google.com'],
      },
      profile: {
        _id: 'db-native-user-1',
        name: 'Native Google User',
        email: 'native@example.com',
        phone: '',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: true,
          hasPhone: false,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'social',
          rememberedIdentifier: 'email',
          suggestedProvider: 'google.com',
          providerIds: ['google.com'],
        },
      },
    });
    mocks.signInWithNativeSocialProviderMock.mockResolvedValue({
      user: {
        uid: 'native-google-user-1',
        email: 'native@example.com',
        displayName: 'Native Google User',
        phoneNumber: '',
        providerData: [{ providerId: 'google.com' }],
      },
      additionalUserInfo: { isNewUser: false },
    });

    const Probe = () => {
      const { signInWithGoogle } = useAuth();
      const [result, setResult] = React.useState('idle');

      React.useEffect(() => {
        signInWithGoogle()
          .then(() => setResult('native'))
          .catch((error) => setResult(error.message));
      }, [signInWithGoogle]);

      return <div data-testid="oauth-route">{result}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('oauth-route')).toHaveTextContent('native');
    });

    expect(mocks.signInWithNativeSocialProviderMock).toHaveBeenCalledWith('google', 'Google');
    expect(mocks.signInWithPopupMock).not.toHaveBeenCalled();
    expect(mocks.signInWithRedirectMock).not.toHaveBeenCalled();
  });

  it('adopts the verified session payload directly after trusted-device verification', async () => {
    let capturedContext = null;

    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'assert',
        availableMethods: ['browser_key'],
        challenge: 'challenge-value',
      },
      session: {
        sessionId: 'server-session-1',
        uid: 'firebase-user-1',
        email: 'stale@example.com',
        emailVerified: true,
        displayName: 'Stale Session',
        phone: '+919999999999',
        providerIds: [],
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
        phone: '+919999999999',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: true,
          hasPhone: true,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'password',
          rememberedIdentifier: 'email+phone',
          suggestedProvider: '',
          providerIds: [],
        },
      },
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="verify-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('verify-status')).toHaveTextContent('device_challenge_required');
    });

    await act(async () => {
      await capturedContext.verifyDeviceChallenge('challenge-token', {
        method: 'browser_key',
        proofBase64: 'proof',
        publicKeySpkiBase64: '',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('verify-status')).toHaveTextContent('authenticated');
    });

    expect(mocks.authApiMock.verifyDeviceChallenge).toHaveBeenCalledTimes(1);
    expect(mocks.authApiMock.verifyDeviceChallenge).toHaveBeenCalledWith(
      'challenge-token',
      expect.objectContaining({
        method: 'browser_key',
        proofBase64: 'proof',
      }),
      '',
      expect.objectContaining({
        firebaseUser: mocks.mockUser,
        forceRefreshAuth: true,
      })
    );
    expect(mocks.cacheTrustedDeviceSessionTokenMock).toHaveBeenCalledWith(
      'trusted-device-session-token',
      '2026-04-12T14:00:00.000Z'
    );
    expect(mocks.authApiMock.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.authApiMock.exchangeSession).not.toHaveBeenCalled();
  });

  it('reauthenticates once and retries trusted-device verification when recent auth is required', async () => {
    let capturedContext = null;
    const recentAuthError = new Error('Recent re-authentication is required for this action.');
    recentAuthError.status = 401;
    recentAuthError.data = { code: 'WEBAUTHN_RECENT_AUTH_REQUIRED' };
    mocks.mockUser.providerData = [{ providerId: 'google.com' }];
    mocks.reauthenticateWithPopupMock.mockResolvedValue({ user: mocks.mockUser });
    mocks.authApiMock.verifyDeviceChallenge.mockRejectedValueOnce(recentAuthError);
    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'enroll',
        availableMethods: ['webauthn'],
        challenge: 'challenge-value',
      },
      session: {
        sessionId: 'server-session-1',
        uid: 'firebase-user-1',
        email: 'stale@example.com',
        emailVerified: true,
        displayName: 'Stale Session',
        phone: '+919999999999',
        providerIds: ['google.com'],
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
        phone: '+919999999999',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          label: 'Verified session',
          verifiedAt: null,
          expiresAt: null,
          isRecent: false,
        },
        readiness: {
          hasVerifiedEmail: true,
          hasPhone: true,
          accountState: 'active',
          isPrivileged: false,
        },
        acceleration: {
          suggestedRoute: 'social',
          rememberedIdentifier: 'email',
          suggestedProvider: 'google.com',
          providerIds: ['google.com'],
        },
      },
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="verify-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('verify-status')).toHaveTextContent('device_challenge_required');
    });

    await act(async () => {
      await capturedContext.verifyDeviceChallenge('challenge-token', {
        method: 'webauthn',
        credential: { id: 'credential-1', response: { clientDataJSON: 'client-data' } },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('verify-status')).toHaveTextContent('authenticated');
    });

    expect(mocks.reauthenticateWithPopupMock).toHaveBeenCalledTimes(1);
    expect(mocks.reauthenticateWithPopupMock).toHaveBeenCalledWith(
      mocks.mockUser,
      expect.objectContaining({ providerId: 'google.com' })
    );
    expect(mocks.mockUser.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.authApiMock.verifyDeviceChallenge).toHaveBeenCalledTimes(2);
    expect(mocks.authApiMock.verifyDeviceChallenge).toHaveBeenNthCalledWith(
      2,
      'challenge-token',
      expect.objectContaining({
        method: 'webauthn',
        credential: expect.objectContaining({ id: 'credential-1' }),
      }),
      '',
      expect.objectContaining({
        firebaseUser: mocks.mockUser,
        forceRefreshAuth: true,
      })
    );
    expect(mocks.cacheTrustedDeviceSessionTokenMock).toHaveBeenCalledWith(
      'trusted-device-session-token',
      '2026-04-12T14:00:00.000Z'
    );
    expect(mocks.authApiMock.exchangeSession).not.toHaveBeenCalled();
  });

  it('falls back to redirect reauthentication when popup is blocked and does not retry trusted-device verification', async () => {
    let capturedContext = null;
    const recentAuthError = new Error('Recent re-authentication is required for this action.');
    recentAuthError.status = 401;
    recentAuthError.data = { code: 'WEBAUTHN_RECENT_AUTH_REQUIRED' };
    const popupBlockedError = new Error('Popup blocked');
    popupBlockedError.code = 'auth/popup-blocked';

    mocks.mockUser.providerData = [{ providerId: 'google.com' }];
    mocks.reauthenticateWithPopupMock.mockRejectedValueOnce(popupBlockedError);
    mocks.authApiMock.verifyDeviceChallenge.mockRejectedValueOnce(recentAuthError);

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="verify-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('verify-status')).toHaveTextContent('authenticated');
    });

    let redirectError;
    await act(async () => {
      try {
        await capturedContext.verifyDeviceChallenge('challenge-token', {
          method: 'webauthn',
          credential: { id: 'credential-1', response: { clientDataJSON: 'client-data' } },
        });
      } catch (error) {
        redirectError = error;
      }
    });

    expect(redirectError).toMatchObject({
      code: 'auth/redirect-pending',
      redirecting: true,
    });
    expect(mocks.reauthenticateWithPopupMock).toHaveBeenCalledTimes(1);
    expect(mocks.reauthenticateWithRedirectMock).toHaveBeenCalledTimes(1);
    expect(mocks.reauthenticateWithRedirectMock).toHaveBeenCalledWith(
      mocks.mockUser,
      expect.objectContaining({ providerId: 'google.com' })
    );
    expect(mocks.authApiMock.verifyDeviceChallenge).toHaveBeenCalledTimes(1);
    expect(mocks.mockUser.getIdToken).not.toHaveBeenCalledWith(true);
  });

  it('reauthenticates password users with an email credential for sensitive actions', async () => {
    let capturedContext = null;
    mocks.mockUser.providerData = [{ providerId: 'password' }];
    mocks.reauthenticateWithCredentialMock.mockResolvedValue({ user: mocks.mockUser });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="password-reauth-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('password-reauth-status')).toHaveTextContent('authenticated');
    });

    await act(async () => {
      await capturedContext.reauthenticateForSensitiveAction({ password: 'valid-password' });
    });

    expect(mocks.emailCredentialMock).toHaveBeenCalledWith('stale@example.com', 'valid-password');
    expect(mocks.reauthenticateWithCredentialMock).toHaveBeenCalledWith(
      mocks.mockUser,
      expect.objectContaining({
        providerId: 'password',
        email: 'stale@example.com',
        password: 'valid-password',
      })
    );
    expect(mocks.mockUser.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.reauthenticateWithPopupMock).not.toHaveBeenCalled();
  });

  it('requests a password before sensitive reauthentication for password-only users', async () => {
    let capturedContext = null;
    mocks.mockUser.providerData = [{ providerId: 'password' }];

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="password-required-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('password-required-status')).toHaveTextContent('authenticated');
    });

    let capturedError;
    await act(async () => {
      try {
        await capturedContext.reauthenticateForSensitiveAction();
      } catch (error) {
        capturedError = error;
      }
    });

    expect(capturedError).toMatchObject({
      code: 'auth/password-reauth-required',
      requiresPasswordReauth: true,
      email: 'stale@example.com',
    });
    expect(mocks.emailCredentialMock).not.toHaveBeenCalled();
    expect(mocks.reauthenticateWithCredentialMock).not.toHaveBeenCalled();
  });

  it('reauthenticates before registering an MFA passkey when sensitive auth posture is stale', async () => {
    let capturedContext = null;
    const events = [];
    mocks.mockUser.providerData = [{ providerId: 'google.com' }];
    mocks.reauthenticateWithPopupMock.mockImplementation(async () => {
      events.push('reauth');
      return { user: mocks.mockUser };
    });
    mocks.authApiMock.registerMfaPasskey.mockImplementation(async () => {
      events.push('register');
      return { success: true };
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="mfa-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('mfa-status')).toHaveTextContent('authenticated');
    });

    await act(async () => {
      await capturedContext.registerMfaPasskey();
    });

    expect(events).toEqual(['reauth', 'register']);
    expect(mocks.reauthenticateWithPopupMock).toHaveBeenCalledWith(
      mocks.mockUser,
      expect.objectContaining({ providerId: 'google.com' })
    );
    expect(mocks.authApiMock.registerMfaPasskey).toHaveBeenCalledWith({
      firebaseUser: mocks.mockUser,
      forceRefreshAuth: true,
    });
  });

  it('reauthenticates once and retries sensitive MFA recovery-code generation when recent auth is required', async () => {
    let capturedContext = null;
    const recentAuthError = new Error('Recent re-authentication is required for this action.');
    recentAuthError.status = 401;
    recentAuthError.data = { code: 'AUTH_FACTOR_CHANGE_RECENT_AUTH_REQUIRED' };
    mocks.mockUser.providerData = [{ providerId: 'google.com' }];
    mocks.reauthenticateWithPopupMock.mockResolvedValue({ user: mocks.mockUser });
    mocks.authApiMock.generateRecoveryCodes
      .mockRejectedValueOnce(recentAuthError)
      .mockResolvedValueOnce({ success: true });
    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'authenticated',
      session: {
        sessionId: 'server-session-1',
        uid: 'firebase-user-1',
        email: 'stale@example.com',
        emailVerified: true,
        displayName: 'Stale Session',
        phone: '+919999999999',
        providerIds: ['google.com'],
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
        phone: '+919999999999',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'password',
          stepUpFresh: false,
        },
        posture: {
          session: {
            authAgeSeconds: 60,
            freshForSensitiveActions: true,
            stepUpActive: false,
          },
        },
      },
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="mfa-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('mfa-status')).toHaveTextContent('authenticated');
    });

    await act(async () => {
      await capturedContext.generateRecoveryCodes();
    });

    expect(mocks.reauthenticateWithPopupMock).toHaveBeenCalledTimes(1);
    expect(mocks.authApiMock.generateRecoveryCodes).toHaveBeenCalledTimes(2);
    expect(mocks.authApiMock.generateRecoveryCodes).toHaveBeenNthCalledWith(1, {
      firebaseUser: mocks.mockUser,
      forceRefreshAuth: true,
    });
    expect(mocks.authApiMock.generateRecoveryCodes).toHaveBeenNthCalledWith(2, {
      firebaseUser: mocks.mockUser,
      forceRefreshAuth: true,
    });
  });
});
