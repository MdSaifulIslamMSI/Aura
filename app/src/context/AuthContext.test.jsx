import { render, screen, waitFor } from '@testing-library/react';
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
    signInWithPopupMock: vi.fn(),
    clearCsrfTokenCacheMock: vi.fn(),
    clearTrustedDeviceSessionTokenMock: vi.fn(),
    authApiMock: {
      getSession: vi.fn(),
      syncSession: vi.fn(),
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
    signInWithRedirect: vi.fn(),
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
    shouldPreferFirebaseRedirectAuth: vi.fn().mockReturnValue(false),
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
    mocks.authApiMock.getSession.mockRejectedValue(
      Object.assign(new Error('CSRF token fetch failed for /auth/sync: HTTP 401: Unauthorized'), {
        status: 401,
      })
    );
  });

  it('clears stale firebase sessions when the backend rejects the auth token', async () => {
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
    expect(mocks.authApiMock.syncSession).toHaveBeenCalled();
    expect(mocks.signOutMock).not.toHaveBeenCalled();
  });
});
