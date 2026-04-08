import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const signOutMock = vi.fn().mockResolvedValue(undefined);
  const onAuthStateChangedMock = vi.fn();
  const getRedirectResultMock = vi.fn().mockResolvedValue(null);
  const clearCsrfTokenCacheMock = vi.fn();
  const clearTrustedDeviceSessionTokenMock = vi.fn();
  const authApiMock = {
    getSession: vi.fn(),
    syncSession: vi.fn(),
  };
  const mockUser = {
    uid: 'firebase-user-1',
    email: 'stale@example.com',
    emailVerified: true,
    displayName: 'Stale Session',
    phoneNumber: '+919999999999',
    providerData: [],
    getIdToken: vi.fn().mockResolvedValue('firebase-token'),
  };

  return {
    signOutMock,
    onAuthStateChangedMock,
    getRedirectResultMock,
    clearCsrfTokenCacheMock,
    clearTrustedDeviceSessionTokenMock,
    authApiMock,
    mockUser,
  };
});

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  getRedirectResult: hoisted.getRedirectResultMock,
  signInWithEmailAndPassword: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: hoisted.signOutMock,
  onAuthStateChanged: hoisted.onAuthStateChangedMock,
  updateProfile: vi.fn(),
  signInWithPopup: vi.fn(),
}));

vi.mock('../config/firebase', () => ({
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

vi.mock('../services/api', () => ({
  authApi: hoisted.authApiMock,
  userApi: {
    updateProfile: vi.fn(),
    activateSeller: vi.fn(),
    deactivateSeller: vi.fn(),
  },
}));

vi.mock('../services/csrfTokenManager', () => ({
  clearCsrfTokenCache: hoisted.clearCsrfTokenCacheMock,
}));

vi.mock('../services/deviceTrustClient', () => ({
  cacheTrustedDeviceSessionToken: vi.fn(),
  clearTrustedDeviceSessionToken: hoisted.clearTrustedDeviceSessionTokenMock,
}));

vi.mock('../utils/authAcceleration', () => ({
  clearAuthJourneyDraft: vi.fn(),
  writeAuthIdentityMemory: vi.fn(),
}));

import { AuthProvider, useAuth } from './AuthContext';

const AuthProbe = () => {
  const { currentUser, status } = useAuth();
  return (
    <>
      <div data-testid="auth-status">{status}</div>
      <div data-testid="auth-user">{currentUser?.email || 'none'}</div>
    </>
  );
};

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getRedirectResultMock.mockResolvedValue(null);
    hoisted.onAuthStateChangedMock.mockImplementation((_auth, callback) => {
      callback(hoisted.mockUser);
      return () => {};
    });
    hoisted.authApiMock.getSession.mockRejectedValue(
      Object.assign(new Error('CSRF token fetch failed for /auth/sync: HTTP 401: Unauthorized'), {
        status: 401,
      })
    );
  });

  it('clears stale firebase sessions when the backend rejects the auth token', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('signed_out');
    });

    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
    expect(hoisted.clearCsrfTokenCacheMock).toHaveBeenCalled();
    expect(hoisted.clearTrustedDeviceSessionTokenMock).toHaveBeenCalled();
  });
});
