import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteApp: vi.fn(),
  getAuth: vi.fn(),
  initializeApp: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  assertFirebaseReady: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  deleteApp: mocks.deleteApp,
  initializeApp: mocks.initializeApp,
}));

vi.mock('firebase/auth', () => ({
  getAuth: mocks.getAuth,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: mocks.signOut,
}));

vi.mock('@/config/firebase', () => ({
  assertFirebaseReady: mocks.assertFirebaseReady,
  firebaseConfig: { projectId: 'test-project' },
}));

import { verifyCredentialsWithoutSession } from './precheckCredentials';

describe('verifyCredentialsWithoutSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the fresh password sign-in token without forcing a second refresh', async () => {
    const getIdToken = vi.fn().mockResolvedValue('fresh-sign-in-token');
    const user = {
      uid: 'user-1',
      email: 'user@example.com',
      getIdToken,
    };
    const tempAuth = { currentUser: user };
    const tempApp = { name: 'temp-app' };

    mocks.initializeApp.mockReturnValue(tempApp);
    mocks.getAuth.mockReturnValue(tempAuth);
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });

    await expect(verifyCredentialsWithoutSession('user@example.com', 'password'))
      .resolves.toEqual({
        credentialProofToken: 'fresh-sign-in-token',
        uid: 'user-1',
        email: 'user@example.com',
      });

    expect(getIdToken).toHaveBeenCalledOnce();
    expect(getIdToken).toHaveBeenCalledWith();
    expect(mocks.signOut).toHaveBeenCalledWith(tempAuth);
    expect(mocks.deleteApp).toHaveBeenCalledWith(tempApp);
  });

  it('still disposes the temporary Firebase app when credential verification fails', async () => {
    const tempAuth = { currentUser: null };
    const tempApp = { name: 'temp-app' };
    const authError = Object.assign(new Error('invalid credential'), {
      code: 'auth/invalid-credential',
    });

    mocks.initializeApp.mockReturnValue(tempApp);
    mocks.getAuth.mockReturnValue(tempAuth);
    mocks.signInWithEmailAndPassword.mockRejectedValue(authError);

    await expect(verifyCredentialsWithoutSession('user@example.com', 'wrong-password'))
      .rejects.toMatchObject({ code: 'auth/invalid-credential' });

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.deleteApp).toHaveBeenCalledWith(tempApp);
  });
});
