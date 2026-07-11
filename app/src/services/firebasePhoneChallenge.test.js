import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteApp: vi.fn(),
  initializeApp: vi.fn(),
  getAuth: vi.fn(),
  linkWithPhoneNumber: vi.fn(),
  reauthenticateWithPhoneNumber: vi.fn(),
  RecaptchaVerifier: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPhoneNumber: vi.fn(),
  signOut: vi.fn(),
  assertFirebaseReady: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  deleteApp: mocks.deleteApp,
  initializeApp: mocks.initializeApp,
}));

vi.mock('firebase/auth', () => ({
  PhoneAuthProvider: { credential: vi.fn() },
  RecaptchaVerifier: mocks.RecaptchaVerifier,
  getAuth: mocks.getAuth,
  linkWithPhoneNumber: mocks.linkWithPhoneNumber,
  reauthenticateWithPhoneNumber: mocks.reauthenticateWithPhoneNumber,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signInWithPhoneNumber: mocks.signInWithPhoneNumber,
  signOut: mocks.signOut,
}));

vi.mock('@/config/firebase', () => ({
  assertFirebaseReady: mocks.assertFirebaseReady,
  firebaseConfig: { projectId: 'test-project' },
}));

import {
  completeFirebasePhoneLoginChallenge,
  startFirebasePhoneLoginChallenge,
} from './firebasePhoneChallenge';

describe('Firebase phone login challenge token handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the token issued by password sign-in without an immediate forced refresh', async () => {
    const getIdToken = vi.fn().mockResolvedValue('fresh-sign-in-token');
    const user = {
      phoneNumber: '+911234567890',
      providerData: [{ providerId: 'phone' }],
      getIdToken,
    };
    const verifier = { clear: vi.fn() };
    const confirmationResult = { verificationId: 'verification-1' };

    mocks.initializeApp.mockReturnValue({ name: 'temp-app' });
    mocks.getAuth.mockReturnValue({ currentUser: user });
    mocks.RecaptchaVerifier.mockImplementation(function RecaptchaVerifierMock() {
      return verifier;
    });
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });
    mocks.reauthenticateWithPhoneNumber.mockResolvedValue(confirmationResult);

    await expect(startFirebasePhoneLoginChallenge({
      email: 'user@example.com',
      password: 'password',
      phone: '+911234567890',
      recaptchaContainer: document.createElement('div'),
    })).resolves.toMatchObject({
      credentialProofToken: 'fresh-sign-in-token',
      confirmationResult,
      mode: 'reauth',
    });

    expect(getIdToken).toHaveBeenCalledOnce();
    expect(getIdToken).toHaveBeenCalledWith();
  });

  it('does not force-refresh again after the phone code returns an authenticated user', async () => {
    const getIdToken = vi.fn().mockResolvedValue('phone-verified-token');
    const user = { getIdToken };
    const challenge = {
      confirmationResult: {
        verificationId: '',
        confirm: vi.fn().mockResolvedValue({ user }),
      },
      auth: { currentUser: user },
      phoneE164: '+911234567890',
      mode: 'reauth',
    };

    await expect(completeFirebasePhoneLoginChallenge(challenge, '123456'))
      .resolves.toMatchObject({ user, mode: 'reauth' });

    expect(getIdToken).toHaveBeenCalledOnce();
    expect(getIdToken).toHaveBeenCalledWith();
  });
});
