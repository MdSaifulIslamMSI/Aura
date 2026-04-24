import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeAuthMocks = vi.hoisted(() => ({
  signInWithGoogle: vi.fn(),
  signInWithFacebook: vi.fn(),
  signInWithTwitter: vi.fn(),
  signOut: vi.fn(),
  useAppLanguage: vi.fn(),
  checkAppTrackingTransparencyPermission: vi.fn(),
  requestAppTrackingTransparencyPermission: vi.fn(),
}));

const firebaseAuthMocks = vi.hoisted(() => ({
  signInWithCredential: vi.fn(),
  googleCredential: vi.fn((idToken, accessToken) => ({ providerId: 'google.com', idToken, accessToken })),
  facebookCredential: vi.fn((accessToken) => ({ providerId: 'facebook.com', accessToken })),
  twitterCredential: vi.fn((accessToken, secret) => ({ providerId: 'twitter.com', accessToken, secret })),
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: nativeAuthMocks,
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: {
    credential: firebaseAuthMocks.googleCredential,
  },
  FacebookAuthProvider: {
    credential: firebaseAuthMocks.facebookCredential,
  },
  TwitterAuthProvider: {
    credential: firebaseAuthMocks.twitterCredential,
  },
  signInWithCredential: firebaseAuthMocks.signInWithCredential,
}));

vi.mock('../config/firebase', () => ({
  auth: { currentUser: null },
  assertFirebaseSocialAuthReady: vi.fn(),
  googleProvider: {},
  facebookProvider: {},
  xProvider: {},
}));

describe('nativeSocialAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_MOBILE_NATIVE_SOCIAL_AUTH_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps native social auth disabled until the mobile OAuth lane is explicitly enabled', async () => {
    vi.stubEnv('VITE_MOBILE_NATIVE_SOCIAL_AUTH_ENABLED', 'false');

    const nativeRuntimeModule = await import('../utils/nativeRuntime');
    vi.spyOn(nativeRuntimeModule, 'isCapacitorNativeRuntime').mockReturnValue(true);

    const { shouldUseNativeSocialAuth } = await import('./nativeSocialAuth');

    expect(shouldUseNativeSocialAuth('google')).toBe(false);
  });

  it('uses native Google sign-in inside Capacitor and exchanges the credential into Firebase JS auth', async () => {
    nativeAuthMocks.signInWithGoogle.mockResolvedValue({
      credential: {
        idToken: 'google-id-token',
        accessToken: 'google-access-token',
      },
      additionalUserInfo: {
        isNewUser: false,
      },
      user: {
        uid: 'native-google-user',
      },
    });
    firebaseAuthMocks.signInWithCredential.mockResolvedValue({
      user: {
        uid: 'web-google-user',
        email: 'member@example.com',
        providerData: [{ providerId: 'google.com' }],
      },
    });

    const nativeRuntimeModule = await import('../utils/nativeRuntime');
    vi.spyOn(nativeRuntimeModule, 'isCapacitorNativeRuntime').mockReturnValue(true);
    vi.spyOn(nativeRuntimeModule, 'getNativeMobilePlatform').mockReturnValue('android');

    const { signInWithNativeSocialProvider } = await import('./nativeSocialAuth');
    const result = await signInWithNativeSocialProvider('google', 'Google');

    expect(nativeAuthMocks.useAppLanguage).toHaveBeenCalled();
    expect(nativeAuthMocks.signInWithGoogle).toHaveBeenCalledWith({ skipNativeAuth: true });
    expect(firebaseAuthMocks.googleCredential).toHaveBeenCalledWith('google-id-token', 'google-access-token');
    expect(firebaseAuthMocks.signInWithCredential).toHaveBeenCalledWith(
      { currentUser: null },
      expect.objectContaining({ providerId: 'google.com' })
    );
    expect(result).toMatchObject({
      user: {
        uid: 'web-google-user',
      },
      additionalUserInfo: {
        isNewUser: false,
      },
    });
  });

  it('maps missing native OAuth configuration to a clear mobile social auth error', async () => {
    nativeAuthMocks.signInWithGoogle.mockRejectedValue(
      new Error('ApiException: 10 default_web_client_id WILL_BE_OVERRIDDEN')
    );

    const nativeRuntimeModule = await import('../utils/nativeRuntime');
    vi.spyOn(nativeRuntimeModule, 'isCapacitorNativeRuntime').mockReturnValue(true);
    vi.spyOn(nativeRuntimeModule, 'getNativeMobilePlatform').mockReturnValue('android');

    const { signInWithNativeSocialProvider } = await import('./nativeSocialAuth');

    await expect(signInWithNativeSocialProvider('google', 'Google')).rejects.toMatchObject({
      code: 'auth/native-social-auth-configuration-missing',
      message: expect.stringContaining('native mobile OAuth configuration'),
    });
  });

  it('requests App Tracking Transparency before native Facebook sign-in on iPhone', async () => {
    nativeAuthMocks.checkAppTrackingTransparencyPermission.mockResolvedValue({ status: 'prompt' });
    nativeAuthMocks.requestAppTrackingTransparencyPermission.mockResolvedValue({ status: 'granted' });
    nativeAuthMocks.signInWithFacebook.mockResolvedValue({
      credential: {
        accessToken: 'facebook-access-token',
      },
      additionalUserInfo: {
        isNewUser: true,
      },
      user: {
        uid: 'native-facebook-user',
      },
    });
    firebaseAuthMocks.signInWithCredential.mockResolvedValue({
      user: {
        uid: 'web-facebook-user',
        email: 'member@example.com',
        providerData: [{ providerId: 'facebook.com' }],
      },
    });

    const nativeRuntimeModule = await import('../utils/nativeRuntime');
    vi.spyOn(nativeRuntimeModule, 'isCapacitorNativeRuntime').mockReturnValue(true);
    vi.spyOn(nativeRuntimeModule, 'getNativeMobilePlatform').mockReturnValue('ios');

    const { signInWithNativeSocialProvider } = await import('./nativeSocialAuth');
    const result = await signInWithNativeSocialProvider('facebook', 'Facebook');

    expect(nativeAuthMocks.checkAppTrackingTransparencyPermission).toHaveBeenCalled();
    expect(nativeAuthMocks.requestAppTrackingTransparencyPermission).toHaveBeenCalled();
    expect(nativeAuthMocks.signInWithFacebook).toHaveBeenCalledWith({
      skipNativeAuth: true,
      useLimitedLogin: false,
    });
    expect(firebaseAuthMocks.facebookCredential).toHaveBeenCalledWith('facebook-access-token');
    expect(result).toMatchObject({
      user: {
        uid: 'web-facebook-user',
      },
      additionalUserInfo: {
        isNewUser: true,
      },
    });
  });
});
