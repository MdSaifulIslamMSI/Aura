import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';

let AuthProvider;
let useAuth;
let mocks;

const loadAuthContext = async () => {
  vi.resetModules();

  mocks = {
    signOutMock: vi.fn().mockResolvedValue(undefined),
    onAuthStateChangedMock: vi.fn(),
    getRedirectResultMock: vi.fn().mockResolvedValue(null),
    signInWithRedirectMock: vi.fn().mockResolvedValue(undefined),
    signInWithPopupMock: vi.fn(),
    shouldUseNativeSocialAuthMock: vi.fn().mockReturnValue(false),
    signInWithNativeSocialProviderMock: vi.fn(),
    signOutNativeSocialAuthMock: vi.fn().mockResolvedValue(undefined),
    shouldPreferFirebaseRedirectAuthMock: vi.fn().mockReturnValue(false),
    clearCsrfTokenCacheMock: vi.fn(),
    clearTrustedDeviceSessionTokenMock: vi.fn(),
    authApiMock: {
      exchangeSession: vi.fn(),
      getSession: vi.fn(),
      generateRecoveryCodes: vi.fn(),
      logoutSession: vi.fn(),
      syncSession: vi.fn(),
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
    getRedirectResult: mocks.getRedirectResultMock,
    signInWithEmailAndPassword: vi.fn(),
    signInWithCredential: vi.fn(),
    signInWithRedirect: mocks.signInWithRedirectMock,
    signOut: mocks.signOutMock,
    onAuthStateChanged: mocks.onAuthStateChangedMock,
    updateProfile: vi.fn(),
    signInWithPopup: mocks.signInWithPopupMock,
  }));

  vi.doMock('../config/firebase', () => ({
    auth: {},
    googleProvider: {},
    facebookProvider: {},
    xProvider: {},
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
    cacheTrustedDeviceSessionToken: vi.fn(),
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
};

describe('AuthProvider', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
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
    mocks.authApiMock.verifyDeviceChallenge.mockResolvedValue({
      success: true,
      status: 'authenticated',
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
      const { signInWithX, currentUser, status } = useAuth();
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
      const { signInWithX, currentUser, status } = useAuth();
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
    expect(mocks.authApiMock.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.authApiMock.exchangeSession).not.toHaveBeenCalled();
  });
});
