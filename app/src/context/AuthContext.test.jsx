import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    adoptTrustedDeviceSessionMock: vi.fn(),
    cacheTrustedDeviceSessionTokenMock: vi.fn(),
    clearTrustedDeviceSessionTokenMock: vi.fn(),
    ensureDesktopHandoffTargetIdentityMock: vi.fn().mockResolvedValue({
      deviceId: 'aura_desktop_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rotated: true,
    }),
    resetTrustedDeviceIdentityMock: vi.fn(),
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
      renameTrustedDevice: vi.fn(),
      revokeTrustedDevice: vi.fn(),
      revokeOtherTrustedDevices: vi.fn(),
      regenerateMfaRecoveryCodes: vi.fn(),
      verifyDeviceChallenge: vi.fn(),
      verifyMfaPasskeyLogin: vi.fn(),
      verifyMfaRecoveryCode: vi.fn(),
      verifyTotpLogin: vi.fn(),
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
    adoptTrustedDeviceSession: mocks.adoptTrustedDeviceSessionMock,
    cacheTrustedDeviceSessionToken: mocks.cacheTrustedDeviceSessionTokenMock,
    clearTrustedDeviceSessionToken: mocks.clearTrustedDeviceSessionTokenMock,
    ensureDesktopHandoffTargetIdentity: mocks.ensureDesktopHandoffTargetIdentityMock,
    resetTrustedDeviceIdentity: mocks.resetTrustedDeviceIdentityMock,
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
    mocks.authApiMock.renameTrustedDevice.mockResolvedValue({ success: true });
    mocks.authApiMock.revokeTrustedDevice.mockResolvedValue({ success: true, revokedCurrentDevice: false });
    mocks.authApiMock.revokeOtherTrustedDevices.mockResolvedValue({ success: true });
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
    mocks.authApiMock.verifyMfaPasskeyLogin.mockResolvedValue({
      success: true,
      status: 'authenticated',
      deviceSessionToken: 'rotated-passkey-device-token',
      expiresAt: '2026-04-12T15:00:00.000Z',
      session: {
        sessionId: 'server-session-passkey-1',
        uid: 'firebase-user-1',
        email: 'stale@example.com',
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
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

  it('does not start a focus refresh while trusted-device proof is pending', async () => {
    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'focus-safe-challenge',
        mode: 'assert',
        availableMethods: ['webauthn'],
        challenge: 'focus-safe-value',
      },
      session: {
        uid: 'firebase-user-1',
        email: 'stale@example.com',
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
    });

    const Probe = () => {
      const { status } = useAuth();
      return <div data-testid="focus-proof-status">{status}</div>;
    };

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('focus-proof-status')).toHaveTextContent('device_challenge_required');
      expect(mocks.authApiMock.getSession).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    expect(mocks.authApiMock.getSession).toHaveBeenCalledTimes(1);
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

  it('uses desktop owner access custom tokens only through the Electron bridge', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});

    const ownerUser = {
      uid: 'owner-firebase-uid',
      email: 'owner@example.com',
      emailVerified: true,
      displayName: 'Owner User',
      phoneNumber: '',
      providerData: [],
      getIdToken: vi.fn().mockResolvedValue('owner-firebase-token'),
    };
    const signInWithOwnerAccess = vi.fn().mockResolvedValue({
      success: true,
      customToken: 'owner-custom-token',
    });
    window.auraDesktop = {
      isDesktop: true,
      signInWithOwnerAccess,
    };

    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: ownerUser });
    mocks.authApiMock.syncSession.mockResolvedValue({
      status: 'authenticated',
      session: {
        uid: ownerUser.uid,
        email: ownerUser.email,
        emailVerified: true,
        displayName: ownerUser.displayName,
        phone: '',
        providerIds: [],
      },
      profile: {
        _id: 'db-owner-1',
        name: ownerUser.displayName,
        email: ownerUser.email,
        phone: '',
        isAdmin: true,
        isVerified: true,
        isSeller: false,
        sellerActivatedAt: null,
        accountState: 'active',
        moderation: {},
        loyalty: {},
        createdAt: null,
      },
      roles: {
        isAdmin: true,
        isSeller: false,
        isVerified: true,
      },
      intelligence: {
        assurance: {
          level: 'owner_access',
          label: 'Owner access',
          verifiedAt: null,
          expiresAt: null,
          isRecent: true,
        },
        readiness: {
          hasVerifiedEmail: true,
          hasPhone: false,
          accountState: 'active',
          isPrivileged: true,
        },
        acceleration: {
          suggestedRoute: 'owner_access',
          rememberedIdentifier: 'email',
          suggestedProvider: '',
          providerIds: [],
        },
      },
    });

    const Probe = () => {
      const { signInWithDesktopOwnerAccess, status } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopOwnerAccess()
          .then((value) => setResult(value?.dbUser?.email || 'done'))
          .catch((error) => setResult(error.message));
      }, [signInWithDesktopOwnerAccess]);

      return (
        <>
          <div data-testid="desktop-owner-status">{status}</div>
          <div data-testid="desktop-owner-result">{result}</div>
        </>
      );
    };

    try {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-owner-status')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('desktop-owner-result')).toHaveTextContent('owner@example.com');
      });

      expect(signInWithOwnerAccess).toHaveBeenCalledTimes(1);
      expect(mocks.signInWithCustomTokenMock).toHaveBeenCalledWith({}, 'owner-custom-token');
      expect(mocks.ensureDesktopHandoffTargetIdentityMock).toHaveBeenCalledTimes(1);
      expect(mocks.authApiMock.syncSession).toHaveBeenCalled();
      expect(mocks.ensureDesktopHandoffTargetIdentityMock.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.authApiMock.syncSession.mock.invocationCallOrder[0]);
    } finally {
      delete window.auraDesktop;
    }
  });

  it('rolls back desktop owner access when local identity rotation fails', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    const ownerUser = {
      uid: 'owner-rotation-failure-uid',
      email: 'owner-rotation-failure@example.com',
      providerData: [],
    };
    const failure = new Error('desktop owner identity rotation failed');
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: ownerUser });
    mocks.ensureDesktopHandoffTargetIdentityMock.mockRejectedValue(failure);
    window.auraDesktop = {
      isDesktop: true,
      signInWithOwnerAccess: vi.fn().mockResolvedValue({
        success: true,
        customToken: 'owner-rotation-failure-token',
      }),
    };

    const Probe = () => {
      const { signInWithDesktopOwnerAccess } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopOwnerAccess()
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(error.message));
      }, [signInWithDesktopOwnerAccess]);
      return <div data-testid="desktop-owner-rotation-failure">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(screen.getByTestId('desktop-owner-rotation-failure'))
          .toHaveTextContent(failure.message);
      });
      expect(mocks.authApiMock.logoutSession).toHaveBeenCalledWith({ firebaseUser: ownerUser });
      expect(mocks.signOutMock).toHaveBeenCalledWith(expect.anything());
      expect(mocks.authApiMock.syncSession).not.toHaveBeenCalled();
    } finally {
      delete window.auraDesktop;
    }
  });

  it('polls desktop browser sign-in results if the completion event is missed', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});

    const desktopUser = {
      uid: 'desktop-browser-user-1',
      email: 'desktop-browser@example.com',
      emailVerified: true,
      displayName: 'Desktop Browser User',
      phoneNumber: '',
      providerData: [{ providerId: 'google.com' }],
      getIdToken: vi.fn().mockResolvedValue('desktop-browser-firebase-token'),
      getIdTokenResult: vi.fn().mockResolvedValue({
        claims: {
          desktop_handoff: true,
          desktop_request_id: 'desktop-browser-request-1',
          desktop_handoff_grant_id: 'g'.repeat(43),
          desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 300,
        },
      }),
    };
    const startBrowserSignIn = vi.fn().mockResolvedValue({
      requestId: 'desktop-browser-request-1',
      expiresAt: Date.now() + 60_000,
    });
    const consumeBrowserSignIn = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        message: 'Desktop browser sign-in is not ready or has expired.',
      })
      .mockResolvedValueOnce({
        success: true,
        customToken: 'desktop-browser-custom-token',
      });
    const onBrowserSignInStatus = vi.fn(() => () => {});
    const onRequestStarted = vi.fn();

    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn: vi.fn().mockResolvedValue({ success: true }),
      consumeBrowserSignIn,
      onBrowserSignInStatus,
      startBrowserSignIn,
    };

    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });
    mocks.authApiMock.syncSession.mockResolvedValue({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'desktop-target-challenge-token',
        scope: 'desktop_handoff_target',
        mode: 'register',
        availableMethods: ['browser_key'],
      },
      session: {
        uid: desktopUser.uid,
        email: desktopUser.email,
        emailVerified: true,
        displayName: desktopUser.displayName,
        phone: '',
        providerIds: ['google.com'],
      },
      profile: {
        _id: 'db-desktop-browser-1',
        name: desktopUser.displayName,
        email: desktopUser.email,
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
          level: 'desktop_browser',
          label: 'Desktop browser',
          verifiedAt: null,
          expiresAt: null,
          isRecent: true,
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

    const Probe = () => {
      const { signInWithDesktopBrowser, status } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser({ onRequestStarted })
          .then((value) => setResult(value?.dbUser?.email || 'done'))
          .catch((error) => setResult(error.message));
      }, [signInWithDesktopBrowser]);

      return (
        <>
          <div data-testid="desktop-browser-status">{status}</div>
          <div data-testid="desktop-browser-result">{result}</div>
        </>
      );
    };

    try {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-status')).toHaveTextContent('device_challenge_required');
        expect(screen.getByTestId('desktop-browser-result')).toHaveTextContent('desktop-browser@example.com');
      }, { timeout: 4000 });

      expect(startBrowserSignIn).toHaveBeenCalledWith({
        path: '/desktop-login',
        returnTo: '/',
      });
      expect(onRequestStarted).toHaveBeenCalledWith({
        requestId: 'desktop-browser-request-1',
        expiresAt: expect.any(Number),
      });
      expect(onBrowserSignInStatus).toHaveBeenCalled();
      expect(consumeBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(mocks.signInWithCustomTokenMock).toHaveBeenCalledWith({}, 'desktop-browser-custom-token');
      expect(desktopUser.getIdTokenResult).toHaveBeenCalledWith(true);
      expect(mocks.ensureDesktopHandoffTargetIdentityMock).toHaveBeenCalledTimes(1);
      expect(mocks.authApiMock.syncSession).toHaveBeenCalledWith(
        desktopUser.email,
        desktopUser.displayName,
        '',
        expect.objectContaining({
          desktopHandoffRequestId: 'desktop-browser-request-1',
          firebaseUser: desktopUser,
        })
      );
      expect(desktopUser.getIdTokenResult.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.ensureDesktopHandoffTargetIdentityMock.mock.invocationCallOrder[0]);
      expect(mocks.ensureDesktopHandoffTargetIdentityMock.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.authApiMock.syncSession.mock.invocationCallOrder[0]);
      expect(mocks.adoptTrustedDeviceSessionMock).not.toHaveBeenCalled();
      expect(mocks.cacheTrustedDeviceSessionTokenMock).not.toHaveBeenCalled();
    } finally {
      delete window.auraDesktop;
    }
  });

  it.each([
    ['forced claim refresh', 'claim_refresh'],
    ['target identity rotation', 'identity_rotation'],
  ])('rolls back the Firebase session when desktop %s fails', async (_label, failureStage) => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});

    const requestId = `desktop-browser-rollback-${failureStage}`;
    const failure = new Error(`desktop ${failureStage} failed`);
    const desktopUser = {
      uid: `desktop-browser-${failureStage}-user`,
      email: `${failureStage}@example.com`,
      displayName: 'Desktop Rollback User',
      providerData: [],
      getIdTokenResult: vi.fn().mockResolvedValue({
        claims: {
          desktop_handoff: true,
          desktop_request_id: requestId,
          desktop_handoff_grant_id: 'g'.repeat(43),
          desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
        },
      }),
    };
    if (failureStage === 'claim_refresh') {
      desktopUser.getIdTokenResult.mockRejectedValue(failure);
    } else {
      mocks.ensureDesktopHandoffTargetIdentityMock.mockRejectedValue(failure);
    }
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });

    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn: vi.fn().mockResolvedValue({ success: true }),
      consumeBrowserSignIn: vi.fn().mockResolvedValue({
        success: true,
        customToken: `desktop-browser-${failureStage}-token`,
      }),
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn: vi.fn().mockResolvedValue({
        requestId,
        expiresAt: Date.now() + 60_000,
      }),
    };

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(error.message));
      }, [signInWithDesktopBrowser]);
      return <div data-testid={`desktop-browser-${failureStage}-result`}>{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(screen.getByTestId(`desktop-browser-${failureStage}-result`))
          .toHaveTextContent(failure.message);
      });

      expect(mocks.authApiMock.logoutSession).toHaveBeenCalledWith({ firebaseUser: desktopUser });
      expect(mocks.signOutMock).toHaveBeenCalledWith(expect.anything());
      expect(mocks.clearCsrfTokenCacheMock).toHaveBeenCalled();
      expect(mocks.clearTrustedDeviceSessionTokenMock).toHaveBeenCalled();
      expect(mocks.authApiMock.syncSession).not.toHaveBeenCalled();
      if (failureStage === 'claim_refresh') {
        expect(mocks.ensureDesktopHandoffTargetIdentityMock).not.toHaveBeenCalled();
      } else {
        expect(mocks.ensureDesktopHandoffTargetIdentityMock).toHaveBeenCalledTimes(1);
      }
    } finally {
      delete window.auraDesktop;
    }
  });

  it('force-rotates a colliding desktop identity and restarts the handoff once', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    const requestIds = ['desktop-collision-request-1', 'desktop-collision-request-2'];
    const collisionError = new Error('Desktop target identity must be rotated.');
    collisionError.status = 409;
    collisionError.code = 'DESKTOP_TARGET_IDENTITY_ROTATION_REQUIRED';
    const desktopUser = {
      uid: 'desktop-collision-user',
      email: 'desktop-collision@example.com',
      displayName: 'Desktop Collision User',
      providerData: [],
      getIdTokenResult: vi.fn()
        .mockResolvedValueOnce({
          claims: {
            desktop_handoff: true,
            desktop_request_id: requestIds[0],
            desktop_handoff_grant_id: 'c'.repeat(43),
            desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
          },
        })
        .mockResolvedValueOnce({
          claims: {
            desktop_handoff: true,
            desktop_request_id: requestIds[1],
            desktop_handoff_grant_id: 'd'.repeat(43),
            desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
          },
        }),
    };
    const startBrowserSignIn = vi.fn()
      .mockResolvedValueOnce({ requestId: requestIds[0], expiresAt: Date.now() + 60_000 })
      .mockResolvedValueOnce({ requestId: requestIds[1], expiresAt: Date.now() + 60_000 });
    const cancelBrowserSignIn = vi.fn().mockResolvedValue({ success: true });
    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn,
      consumeBrowserSignIn: vi.fn()
        .mockResolvedValueOnce({ success: true, customToken: 'collision-custom-token-1' })
        .mockResolvedValueOnce({ success: true, customToken: 'collision-custom-token-2' }),
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn,
    };
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });
    mocks.authApiMock.syncSession
      .mockRejectedValueOnce(collisionError)
      .mockResolvedValueOnce({
        status: 'device_challenge_required',
        deviceChallenge: {
          token: 'rotated-desktop-target-challenge',
          scope: 'desktop_handoff_target',
          mode: 'enroll',
          availableMethods: ['browser_key'],
        },
        session: { uid: desktopUser.uid, email: desktopUser.email },
        profile: {
          _id: 'desktop-collision-profile',
          email: desktopUser.email,
          name: desktopUser.displayName,
          isAdmin: false,
          isVerified: true,
          isSeller: false,
        },
        roles: { isAdmin: false, isVerified: true, isSeller: false },
      });

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('success'))
          .catch((error) => setResult(error.code || error.message));
      }, [signInWithDesktopBrowser]);
      return <div data-testid="desktop-collision-retry-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(screen.getByTestId('desktop-collision-retry-result')).toHaveTextContent('success');
      });

      expect(startBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(cancelBrowserSignIn).toHaveBeenCalledTimes(1);
      expect(cancelBrowserSignIn).toHaveBeenCalledWith(requestIds[0]);
      expect(mocks.ensureDesktopHandoffTargetIdentityMock.mock.calls).toEqual([
        [],
        [{ force: true }],
        [],
      ]);
      expect(cancelBrowserSignIn.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.ensureDesktopHandoffTargetIdentityMock.mock.invocationCallOrder[1]);
      expect(mocks.ensureDesktopHandoffTargetIdentityMock.mock.invocationCallOrder[1])
        .toBeLessThan(startBrowserSignIn.mock.invocationCallOrder[1]);
      expect(mocks.authApiMock.syncSession).toHaveBeenCalledTimes(2);
    } finally {
      delete window.auraDesktop;
    }
  });

  it('does not loop when the rotated desktop identity is rejected again', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    const requestIds = ['desktop-collision-repeat-1', 'desktop-collision-repeat-2'];
    const collisionError = new Error('Desktop target identity still collides.');
    collisionError.status = 409;
    collisionError.code = 'DESKTOP_TARGET_IDENTITY_ROTATION_REQUIRED';
    const desktopUser = {
      uid: 'desktop-repeat-collision-user',
      email: 'desktop-repeat-collision@example.com',
      providerData: [],
      getIdTokenResult: vi.fn()
        .mockResolvedValueOnce({
          claims: {
            desktop_handoff: true,
            desktop_request_id: requestIds[0],
            desktop_handoff_grant_id: 'r'.repeat(43),
            desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
          },
        })
        .mockResolvedValueOnce({
          claims: {
            desktop_handoff: true,
            desktop_request_id: requestIds[1],
            desktop_handoff_grant_id: 's'.repeat(43),
            desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
          },
        }),
    };
    const startBrowserSignIn = vi.fn()
      .mockResolvedValueOnce({ requestId: requestIds[0], expiresAt: Date.now() + 60_000 })
      .mockResolvedValueOnce({ requestId: requestIds[1], expiresAt: Date.now() + 60_000 });
    const cancelBrowserSignIn = vi.fn().mockResolvedValue({ success: true });
    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn,
      consumeBrowserSignIn: vi.fn()
        .mockResolvedValueOnce({ success: true, customToken: 'repeat-collision-token-1' })
        .mockResolvedValueOnce({ success: true, customToken: 'repeat-collision-token-2' }),
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn,
    };
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });
    mocks.authApiMock.syncSession.mockRejectedValue(collisionError);

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(error.code || error.message));
      }, [signInWithDesktopBrowser]);
      return <div data-testid="desktop-collision-bounded-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(screen.getByTestId('desktop-collision-bounded-result'))
          .toHaveTextContent('DESKTOP_TARGET_IDENTITY_ROTATION_REQUIRED');
      });

      expect(startBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(cancelBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(mocks.authApiMock.syncSession).toHaveBeenCalledTimes(2);
      expect(mocks.ensureDesktopHandoffTargetIdentityMock.mock.calls.filter(
        ([options]) => options?.force === true
      )).toHaveLength(1);
    } finally {
      delete window.auraDesktop;
    }
  });

  it.each([
    ['DESKTOP_HANDOFF_ASSURANCE_SESSION_STORE_UNAVAILABLE', false],
    ['DESKTOP_HANDOFF_TARGET_CHALLENGE_UNAVAILABLE', true],
  ])('restarts a fresh handoff at most once for %s', async (failureCode, rejectAgain) => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    const requestIds = [
      `desktop-transient-${failureCode.toLowerCase()}-1`,
      `desktop-transient-${failureCode.toLowerCase()}-2`,
    ];
    const transientError = new Error('Desktop handoff must restart after a consumed grant failure.');
    transientError.status = 503;
    transientError.data = { code: failureCode };
    const desktopUser = {
      uid: 'desktop-transient-user',
      email: 'desktop-transient@example.com',
      displayName: 'Desktop Transient User',
      providerData: [],
      getIdTokenResult: vi.fn()
        .mockResolvedValueOnce({
          claims: {
            desktop_handoff: true,
            desktop_request_id: requestIds[0],
            desktop_handoff_grant_id: 't'.repeat(43),
            desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
          },
        })
        .mockResolvedValueOnce({
          claims: {
            desktop_handoff: true,
            desktop_request_id: requestIds[1],
            desktop_handoff_grant_id: 'u'.repeat(43),
            desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
          },
        }),
    };
    const startBrowserSignIn = vi.fn()
      .mockResolvedValueOnce({ requestId: requestIds[0], expiresAt: Date.now() + 60_000 })
      .mockResolvedValueOnce({ requestId: requestIds[1], expiresAt: Date.now() + 60_000 });
    const cancelBrowserSignIn = vi.fn().mockResolvedValue({ success: true });
    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn,
      consumeBrowserSignIn: vi.fn()
        .mockResolvedValueOnce({ success: true, customToken: 'transient-custom-token-1' })
        .mockResolvedValueOnce({ success: true, customToken: 'transient-custom-token-2' }),
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn,
    };
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });
    mocks.authApiMock.syncSession.mockRejectedValueOnce(transientError);
    if (rejectAgain) {
      mocks.authApiMock.syncSession.mockRejectedValueOnce(transientError);
    } else {
      mocks.authApiMock.syncSession.mockResolvedValueOnce({
        status: 'device_challenge_required',
        deviceChallenge: {
          token: 'fresh-desktop-target-challenge',
          scope: 'desktop_handoff_target',
          mode: 'enroll',
          availableMethods: ['browser_key'],
        },
        session: { uid: desktopUser.uid, email: desktopUser.email },
        profile: {
          _id: 'desktop-transient-profile',
          email: desktopUser.email,
          name: desktopUser.displayName,
          isAdmin: false,
          isVerified: true,
          isSeller: false,
        },
        roles: { isAdmin: false, isVerified: true, isSeller: false },
      });
    }

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('success'))
          .catch((error) => setResult(error.code || error.data?.code || error.message));
      }, [signInWithDesktopBrowser]);
      return <div data-testid="desktop-transient-retry-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(screen.getByTestId('desktop-transient-retry-result'))
          .toHaveTextContent(rejectAgain ? failureCode : 'success');
      });

      expect(startBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(mocks.authApiMock.syncSession).toHaveBeenCalledTimes(2);
      expect(cancelBrowserSignIn).toHaveBeenCalledTimes(rejectAgain ? 2 : 1);
      expect(cancelBrowserSignIn).toHaveBeenNthCalledWith(1, requestIds[0]);
      if (rejectAgain) {
        expect(cancelBrowserSignIn).toHaveBeenNthCalledWith(2, requestIds[1]);
      }
    } finally {
      delete window.auraDesktop;
    }
  });

  it('retries once after a completion event overtakes an older not-ready poll', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});

    let statusListener = null;
    let resolveConsume;
    const stalePollResult = new Promise((resolve) => {
      resolveConsume = resolve;
    });
    const consumeBrowserSignIn = vi.fn()
      .mockImplementationOnce(() => stalePollResult)
      .mockResolvedValueOnce({
        success: true,
        customToken: 'desktop-browser-race-token',
      });
    const cancelBrowserSignIn = vi.fn().mockResolvedValue({ success: true });

    const desktopUser = {
      uid: 'desktop-browser-race-user',
      email: 'desktop-race@example.com',
      displayName: 'Desktop Race User',
      providerData: [],
      getIdTokenResult: vi.fn().mockResolvedValue({
        claims: {
          desktop_handoff: true,
          desktop_request_id: 'desktop-browser-consume-race-1',
          desktop_handoff_grant_id: 'r'.repeat(43),
          desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) + 60,
        },
      }),
    };
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });
    mocks.authApiMock.syncSession.mockResolvedValue({
      user: { email: desktopUser.email },
      trustedDevice: null,
    });

    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn,
      consumeBrowserSignIn,
      onBrowserSignInStatus: vi.fn((listener) => {
        statusListener = listener;
        return () => {};
      }),
      startBrowserSignIn: vi.fn().mockResolvedValue({
        requestId: 'desktop-browser-consume-race-1',
        expiresAt: Date.now() + 60_000,
      }),
    };

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('success'))
          .catch((error) => setResult(error.message));
      }, [signInWithDesktopBrowser]);

      return <div data-testid="desktop-browser-consume-race-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(statusListener).toEqual(expect.any(Function));
        expect(consumeBrowserSignIn).toHaveBeenCalledTimes(1);
      });

      let completion;
      act(() => {
        completion = statusListener({
          type: 'completed',
          requestId: 'desktop-browser-consume-race-1',
        });
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(consumeBrowserSignIn).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveConsume({
          success: false,
          message: 'Desktop browser sign-in is not ready or has expired.',
        });
        await completion;
      });

      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-consume-race-result'))
          .toHaveTextContent('success');
      });
      expect(consumeBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(mocks.signInWithCustomTokenMock).toHaveBeenCalledWith(
        {},
        'desktop-browser-race-token'
      );
      expect(cancelBrowserSignIn).not.toHaveBeenCalled();
    } finally {
      delete window.auraDesktop;
    }
  });

  it('rejects a desktop browser token that is not bound to the pending request', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    const desktopUser = {
      uid: 'desktop-browser-user-mismatch',
      email: 'desktop-mismatch@example.com',
      providerData: [],
      getIdTokenResult: vi.fn().mockResolvedValue({
        claims: {
          desktop_handoff: true,
          desktop_request_id: 'different-desktop-request',
        },
      }),
    };
    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn: vi.fn().mockResolvedValue({ success: true }),
      consumeBrowserSignIn: vi.fn().mockResolvedValue({
        success: true,
        customToken: 'mismatched-desktop-token',
      }),
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn: vi.fn().mockResolvedValue({
        requestId: 'expected-desktop-request',
        expiresAt: Date.now() + 60_000,
      }),
    };
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(`${error.code}:${error.message}`));
      }, [signInWithDesktopBrowser]);
      return <div data-testid="desktop-browser-mismatch-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-mismatch-result'))
          .toHaveTextContent('auth/desktop-browser-sign-in-token-mismatch');
      });
      expect(mocks.signOutMock).toHaveBeenCalledWith(expect.anything());
      expect(mocks.ensureDesktopHandoffTargetIdentityMock).not.toHaveBeenCalled();
      expect(mocks.authApiMock.syncSession).not.toHaveBeenCalled();
    } finally {
      delete window.auraDesktop;
    }
  });

  it('rejects an expired one-time desktop assurance before backend session sync', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    const desktopUser = {
      uid: 'desktop-browser-user-expired',
      email: 'desktop-expired@example.com',
      providerData: [],
      getIdTokenResult: vi.fn().mockResolvedValue({
        claims: {
          desktop_handoff: true,
          desktop_request_id: 'desktop-browser-expired-request',
          desktop_handoff_grant_id: 'e'.repeat(43),
          desktop_handoff_grant_exp: Math.floor(Date.now() / 1000) - 1,
        },
      }),
    };
    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn: vi.fn().mockResolvedValue({ success: true }),
      consumeBrowserSignIn: vi.fn().mockResolvedValue({
        success: true,
        customToken: 'expired-desktop-token',
      }),
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn: vi.fn().mockResolvedValue({
        requestId: 'desktop-browser-expired-request',
        expiresAt: Date.now() + 60_000,
      }),
    };
    mocks.signInWithCustomTokenMock.mockResolvedValue({ user: desktopUser });

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);
      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(`${error.code}:${error.message}`));
      }, [signInWithDesktopBrowser]);
      return <div data-testid="desktop-browser-expired-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-expired-result'))
          .toHaveTextContent('auth/desktop-browser-sign-in-assurance-expired');
      });
      expect(desktopUser.getIdTokenResult).toHaveBeenCalledWith(true);
      expect(mocks.signOutMock).toHaveBeenCalledWith(expect.anything());
      expect(mocks.ensureDesktopHandoffTargetIdentityMock).not.toHaveBeenCalled();
      expect(mocks.authApiMock.syncSession).not.toHaveBeenCalled();
      expect(window.auraDesktop.startBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(window.auraDesktop.cancelBrowserSignIn).toHaveBeenCalledTimes(2);
    } finally {
      delete window.auraDesktop;
    }
  });

  it('polls a desktop browser cancellation tombstone if the event is missed', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});

    const cancelBrowserSignIn = vi.fn().mockResolvedValue({ success: false });
    const consumeBrowserSignIn = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        message: 'Desktop browser sign-in is not ready or has expired.',
      })
      .mockResolvedValueOnce({
        success: false,
        cancelled: true,
        code: 'auth/desktop-browser-sign-in-cancelled',
        requestId: 'desktop-browser-cancel-poll-1',
        message: 'Desktop browser sign-in was cancelled.',
      });

    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn,
      consumeBrowserSignIn,
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn: vi.fn().mockResolvedValue({
        requestId: 'desktop-browser-cancel-poll-1',
        expiresAt: Date.now() + 10 * 60_000,
      }),
    };

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(`${error.code}:${error.message}`));
      }, [signInWithDesktopBrowser]);

      return <div data-testid="desktop-browser-cancel-poll-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-cancel-poll-result'))
          .toHaveTextContent('auth/desktop-browser-sign-in-cancelled');
      }, { timeout: 4000 });
      expect(consumeBrowserSignIn).toHaveBeenCalledTimes(2);
      expect(cancelBrowserSignIn).toHaveBeenCalledWith('desktop-browser-cancel-poll-1');
      expect(mocks.signInWithCustomTokenMock).not.toHaveBeenCalled();
    } finally {
      delete window.auraDesktop;
    }
  });

  it('reopens the exact pending desktop browser request through the native bridge', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});
    const reopenBrowserSignIn = vi.fn().mockResolvedValue({
      success: true,
      requestId: 'desktop-browser-reopen-1',
    });
    window.auraDesktop = {
      isDesktop: true,
      reopenBrowserSignIn,
    };

    const Probe = () => {
      const { reopenDesktopBrowserSignIn } = useAuth();
      const [result, setResult] = React.useState('idle');

      return (
        <>
          <button
            type="button"
            onClick={() => reopenDesktopBrowserSignIn('desktop-browser-reopen-1')
              .then(() => setResult('reopened'))}
          >
            Reopen
          </button>
          <div data-testid="desktop-browser-reopen-result">{result}</div>
        </>
      );
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-reopen-result')).toHaveTextContent('reopened');
      });
      expect(reopenBrowserSignIn).toHaveBeenCalledWith('desktop-browser-reopen-1');
    } finally {
      delete window.auraDesktop;
    }
  });

  it('cancels an abandoned desktop browser request without creating a Firebase session', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});

    const cancelBrowserSignIn = vi.fn().mockResolvedValue({ success: true });
    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn,
      consumeBrowserSignIn: vi.fn().mockResolvedValue({
        success: false,
        message: 'Desktop browser sign-in is not ready or has expired.',
      }),
      onBrowserSignInStatus: vi.fn(() => () => {}),
      startBrowserSignIn: vi.fn().mockResolvedValue({
        requestId: 'desktop-browser-cancel-1',
        expiresAt: Date.now() + 10 * 60_000,
      }),
    };

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (startedRef.current) return undefined;
        startedRef.current = true;
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 10);
        signInWithDesktopBrowser({ signal: controller.signal })
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(`${error.code}:${error.message}`));
        return () => window.clearTimeout(timer);
      }, [signInWithDesktopBrowser]);

      return <div data-testid="desktop-browser-cancel-result">{result}</div>;
    };

    try {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-cancel-result'))
          .toHaveTextContent('auth/desktop-browser-sign-in-cancelled');
      });

      expect(cancelBrowserSignIn).toHaveBeenCalledWith('desktop-browser-cancel-1');
      expect(mocks.signInWithCustomTokenMock).not.toHaveBeenCalled();
    } finally {
      delete window.auraDesktop;
    }
  });

  it('honors browser-side desktop cancellation events without creating a Firebase session', async () => {
    mocks.onAuthStateChangedMock.mockImplementation(() => () => {});

    let statusListener = null;
    const cancelBrowserSignIn = vi.fn().mockResolvedValue({ success: false });
    window.auraDesktop = {
      isDesktop: true,
      cancelBrowserSignIn,
      consumeBrowserSignIn: vi.fn().mockResolvedValue({
        success: false,
        message: 'Desktop browser sign-in is not ready or has expired.',
      }),
      onBrowserSignInStatus: vi.fn((listener) => {
        statusListener = listener;
        return () => {};
      }),
      startBrowserSignIn: vi.fn().mockResolvedValue({
        requestId: 'desktop-browser-cancel-event-1',
        expiresAt: Date.now() + 10 * 60_000,
      }),
    };

    const Probe = () => {
      const { signInWithDesktopBrowser } = useAuth();
      const [result, setResult] = React.useState('idle');
      const startedRef = React.useRef(false);

      React.useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        signInWithDesktopBrowser()
          .then(() => setResult('unexpected-success'))
          .catch((error) => setResult(`${error.code}:${error.message}`));
      }, [signInWithDesktopBrowser]);

      return <div data-testid="desktop-browser-cancel-event-result">{result}</div>;
    };

    try {
      render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => expect(statusListener).toEqual(expect.any(Function)));

      await act(async () => {
        await statusListener({
          type: 'cancelled',
          requestId: 'desktop-browser-cancel-event-1',
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-cancel-event-result'))
          .toHaveTextContent('auth/desktop-browser-sign-in-cancelled');
      });
      expect(cancelBrowserSignIn).toHaveBeenCalledWith('desktop-browser-cancel-event-1');
      expect(mocks.signInWithCustomTokenMock).not.toHaveBeenCalled();
    } finally {
      delete window.auraDesktop;
    }
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

  it('marks a desktop handoff target proof without affecting generic device refresh', async () => {
    let capturedContext = null;

    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'challenge-token',
        scope: 'desktop_handoff_target',
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
      expect(capturedContext?.deviceChallenge?.scope).toBe('desktop_handoff_target');
    });

    await act(async () => {
      await capturedContext.verifyDeviceChallenge('challenge-token', {
        method: 'browser_key',
        proofBase64: 'proof',
        publicKeySpkiBase64: '',
        challengeToken: 'challenge-token',
        challengeScope: 'desktop_handoff_target',
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
        desktopHandoffTarget: true,
      })
    );
    expect(mocks.cacheTrustedDeviceSessionTokenMock).toHaveBeenCalledWith(
      'trusted-device-session-token',
      '2026-04-12T14:00:00.000Z'
    );
    expect(mocks.authApiMock.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.authApiMock.exchangeSession).not.toHaveBeenCalled();
  });

  it('does not inherit desktop target scope from a different mutable challenge', async () => {
    let capturedContext = null;

    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'current-desktop-target-token',
        scope: 'desktop_handoff_target',
        mode: 'assert',
        availableMethods: ['browser_key'],
        challenge: 'current-desktop-target-challenge',
      },
      session: {
        sessionId: 'server-session-scope-binding',
        uid: 'firebase-user-1',
        email: 'stale@example.com',
      },
      profile: {
        _id: 'db-user-scope-binding',
        name: 'Scope Binding',
        email: 'stale@example.com',
        isAdmin: false,
        isVerified: true,
        isSeller: false,
      },
      roles: { isAdmin: false, isSeller: false, isVerified: true },
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="scope-binding-status">{authContext.status}</div>;
    };

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('scope-binding-status')).toHaveTextContent('device_challenge_required');
    });

    await act(async () => {
      await capturedContext.verifyDeviceChallenge('submitted-generic-token', {
        method: 'browser_key',
        proofBase64: 'generic-proof',
        challengeToken: 'submitted-generic-token',
        challengeScope: 'trusted_device',
      });
    });

    expect(mocks.authApiMock.verifyDeviceChallenge).toHaveBeenCalledWith(
      'submitted-generic-token',
      expect.objectContaining({
        challengeToken: 'submitted-generic-token',
        challengeScope: 'trusted_device',
      }),
      '',
      expect.objectContaining({
        desktopHandoffTarget: false,
      })
    );
  });

  it('preserves the MFA checkpoint returned after trusted-device verification', async () => {
    let capturedContext = null;
    const session = {
      sessionId: 'server-session-mfa-1',
      uid: 'firebase-user-1',
      email: 'stale@example.com',
      emailVerified: true,
      providerIds: [],
    };
    const profile = {
      _id: 'db-user-1',
      name: 'Stale Session',
      email: 'stale@example.com',
      isAdmin: false,
      isVerified: true,
      isSeller: false,
    };
    const roles = { isAdmin: false, isSeller: false, isVerified: true };
    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'assert',
        availableMethods: ['browser_key'],
        challenge: 'challenge-value',
      },
      session,
      profile,
      roles,
    });
    mocks.authApiMock.verifyDeviceChallenge.mockResolvedValueOnce({
      success: true,
      status: 'mfa_challenge_required',
      deviceSessionToken: 'trusted-device-session-token-mfa',
      expiresAt: '2026-04-12T14:00:00.000Z',
      deviceChallenge: null,
      mfaChallenge: {
        challengeId: 'mfa-challenge-1',
        purpose: 'login',
        allowedMethods: ['totp', 'recovery_code'],
        preferredMethod: 'totp',
      },
      mfaPolicy: { mfaRequired: true, reason: 'user_enabled' },
      session,
      profile,
      roles,
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return (
        <div>
          <span data-testid="verify-status">{authContext.status}</span>
          <span data-testid="mfa-method">{authContext.mfaChallenge?.preferredMethod || ''}</span>
        </div>
      );
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
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('verify-status')).toHaveTextContent('mfa_challenge_required');
      expect(screen.getByTestId('mfa-method')).toHaveTextContent('totp');
    });
    expect(capturedContext.isAuthenticated).toBe(false);
    expect(mocks.cacheTrustedDeviceSessionTokenMock).toHaveBeenCalledWith(
      'trusted-device-session-token-mfa',
      '2026-04-12T14:00:00.000Z'
    );
  });

  it('ignores an older session response that resolves after trusted-device verification', async () => {
    let capturedContext = null;
    let resolveStaleRefresh;
    const staleRefresh = new Promise((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const pendingPayload = {
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'initial-challenge-token',
        mode: 'assert',
        availableMethods: ['browser_key'],
        challenge: 'initial-challenge-value',
      },
      session: {
        uid: 'firebase-user-1',
        email: 'stale@example.com',
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
    };

    mocks.authApiMock.getSession
      .mockResolvedValueOnce(pendingPayload)
      .mockImplementationOnce(() => staleRefresh);

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="stale-response-status">{authContext.status}</div>;
    };

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('stale-response-status')).toHaveTextContent('device_challenge_required');
    });

    let refreshPromise;
    await act(async () => {
      refreshPromise = capturedContext.refreshSession(mocks.mockUser, {
        force: true,
        silent: true,
      });
      await Promise.resolve();
    });

    await act(async () => {
      await capturedContext.verifyDeviceChallenge('initial-challenge-token', {
        method: 'browser_key',
        proofBase64: 'proof',
      });
    });

    expect(screen.getByTestId('stale-response-status')).toHaveTextContent('authenticated');

    await act(async () => {
      resolveStaleRefresh({
        ...pendingPayload,
        deviceChallenge: {
          ...pendingPayload.deviceChallenge,
          token: 'stale-replacement-token',
        },
      });
      await refreshPromise;
    });

    expect(screen.getByTestId('stale-response-status')).toHaveTextContent('authenticated');
    expect(capturedContext.deviceChallenge).toBeNull();
  });

  it('stores the rotated device token returned by passkey MFA before authenticating', async () => {
    let capturedContext = null;
    mocks.authApiMock.getSession.mockResolvedValueOnce({
      status: 'mfa_challenge_required',
      mfaChallenge: {
        challengeId: 'mfa-passkey-1',
        purpose: 'login',
        allowedMethods: ['passkey'],
        preferredMethod: 'passkey',
      },
      mfaPolicy: {
        mfaRequired: true,
        allowedMethods: ['passkey'],
      },
      session: {
        uid: 'firebase-user-1',
        email: 'stale@example.com',
      },
      profile: {
        _id: 'db-user-1',
        name: 'Stale Session',
        email: 'stale@example.com',
      },
      roles: {
        isAdmin: false,
        isSeller: false,
        isVerified: true,
      },
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="passkey-mfa-status">{authContext.status}</div>;
    };

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('passkey-mfa-status')).toHaveTextContent('mfa_challenge_required');
    });

    await act(async () => {
      await capturedContext.verifyMfaPasskeyChallenge({
        challengeId: 'mfa-passkey-1',
        purpose: 'login',
      });
    });

    expect(mocks.cacheTrustedDeviceSessionTokenMock).toHaveBeenCalledWith(
      'rotated-passkey-device-token',
      '2026-04-12T15:00:00.000Z'
    );
    expect(screen.getByTestId('passkey-mfa-status')).toHaveTextContent('authenticated');
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

  it('clears local trust and signs out after revoking the current device', async () => {
    let capturedContext = null;
    mocks.mockUser.providerData = [{ providerId: 'google.com' }];
    mocks.reauthenticateWithPopupMock.mockResolvedValue({ user: mocks.mockUser });
    mocks.authApiMock.revokeTrustedDevice.mockResolvedValue({
      success: true,
      revokedCurrentDevice: true,
      revokedDeviceIds: ['device-current'],
    });

    const Probe = () => {
      const authContext = useAuth();
      React.useEffect(() => {
        capturedContext = authContext;
      }, [authContext]);
      return <div data-testid="revoke-status">{authContext.status}</div>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('revoke-status')).toHaveTextContent('authenticated');
    });

    await act(async () => {
      await capturedContext.revokeTrustedDevice({ deviceId: 'device-current' });
    });

    expect(mocks.authApiMock.revokeTrustedDevice).toHaveBeenCalledWith(
      { deviceId: 'device-current' },
      { firebaseUser: mocks.mockUser, forceRefreshAuth: true }
    );
    expect(mocks.resetTrustedDeviceIdentityMock).toHaveBeenCalledTimes(1);
    expect(mocks.signOutMock).toHaveBeenCalled();
    expect(screen.getByTestId('revoke-status')).toHaveTextContent('signed_out');
  });

  it('reauthenticates at most once when local posture is stale and recovery-code generation also requires recent auth', async () => {
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
            freshForSensitiveActions: false,
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
