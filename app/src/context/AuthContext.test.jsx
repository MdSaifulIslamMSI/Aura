import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let AuthProvider;
let useAuth;
let mocks;

const loadAuthContext = async () => {
  vi.resetModules();

  mocks = {
    signOutMock: vi.fn().mockResolvedValue(undefined),
    onAuthStateChangedMock: vi.fn(),
    getRedirectResultMock: vi.fn().mockResolvedValue(null),
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
    signInWithPopup: vi.fn(),
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
});
