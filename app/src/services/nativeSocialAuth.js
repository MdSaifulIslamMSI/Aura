import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  auth,
  assertFirebaseSocialAuthReady,
  facebookProvider,
  googleProvider,
  xProvider,
} from '../config/firebase';
import { isCapacitorNativeRuntime, getNativeMobilePlatform } from '../utils/nativeRuntime';
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  TwitterAuthProvider,
  signInWithCredential,
} from 'firebase/auth';

const NATIVE_PROVIDER_KEYS = ['google', 'facebook', 'x'];
const NATIVE_CONFIG_ERROR_PATTERNS = [
  'default_web_client_id',
  'will_be_overridden',
  'google-services',
  'google services',
  'developer_error',
  'api exception: 10',
  'status{statuscode=developer_error',
  'oauth client',
  'client id',
  'url scheme',
  'facebook app id',
  'twitter consumer',
  'x consumer',
];

const parseBooleanEnv = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const nativeSocialAuthEnabled = parseBooleanEnv(
  import.meta.env.VITE_MOBILE_NATIVE_SOCIAL_AUTH_ENABLED,
  false
);

const normalizeProviderKey = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return NATIVE_PROVIDER_KEYS.includes(normalized) ? normalized : '';
};

const buildProviderError = (message, code = 'auth/native-social-auth-unavailable') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const isNativeProviderConfigurationError = (error) => {
  const raw = `${error?.code || ''} ${error?.message || error || ''}`.toLowerCase();
  return NATIVE_CONFIG_ERROR_PATTERNS.some((pattern) => raw.includes(pattern));
};

const buildNativeProviderConfigurationError = (providerLabel = 'Social') => (
  buildProviderError(
    `${providerLabel} sign-in needs native mobile OAuth configuration before it can run in the installed app. Use email and OTP sign-in for now.`,
    'auth/native-social-auth-configuration-missing'
  )
);

const ensureNativeSocialAuthRuntime = (providerLabel = 'Social') => {
  assertFirebaseSocialAuthReady(`${providerLabel} sign-in`);

  if (!isCapacitorNativeRuntime()) {
    throw buildProviderError(
      `${providerLabel} sign-in is only available through the native mobile runtime here.`
    );
  }

  if (!nativeSocialAuthEnabled) {
    throw buildNativeProviderConfigurationError(providerLabel);
  }

  if (!auth) {
    throw buildProviderError(`${providerLabel} sign-in is not ready yet.`, 'auth/configuration-unavailable');
  }
};

const ensureFacebookTrackingPermission = async () => {
  if (getNativeMobilePlatform() !== 'ios') return;
  if (typeof FirebaseAuthentication.checkAppTrackingTransparencyPermission !== 'function') return;

  const current = await FirebaseAuthentication.checkAppTrackingTransparencyPermission();
  if (current?.status === 'granted') return;

  if (typeof FirebaseAuthentication.requestAppTrackingTransparencyPermission !== 'function') {
    throw buildProviderError(
      'Facebook sign-in on iPhone needs App Tracking Transparency permission so Aura can complete Firebase sign-in.',
      'auth/native-facebook-tracking-permission-required'
    );
  }

  const requested = await FirebaseAuthentication.requestAppTrackingTransparencyPermission();
  if (requested?.status === 'granted') return;

  throw buildProviderError(
    'Facebook sign-in on iPhone needs App Tracking Transparency permission so Aura can complete Firebase sign-in.',
    'auth/native-facebook-tracking-permission-required'
  );
};

const buildWebCredential = (providerKey, credential = {}) => {
  const normalizedProvider = normalizeProviderKey(providerKey);

  if (normalizedProvider === 'google') {
    const idToken = String(credential.idToken || '').trim();
    const accessToken = String(credential.accessToken || '').trim();
    if (!idToken && !accessToken) {
      throw buildProviderError('Google sign-in did not return a usable Firebase credential.');
    }
    return GoogleAuthProvider.credential(idToken || null, accessToken || null);
  }

  if (normalizedProvider === 'facebook') {
    const accessToken = String(credential.accessToken || '').trim();
    if (!accessToken) {
      throw buildProviderError('Facebook sign-in did not return a usable access token.');
    }
    return FacebookAuthProvider.credential(accessToken);
  }

  if (normalizedProvider === 'x') {
    const accessToken = String(credential.accessToken || '').trim();
    const secret = String(credential.secret || '').trim();
    if (!accessToken || !secret) {
      throw buildProviderError('X sign-in did not return the OAuth token and secret required by Firebase.');
    }
    return TwitterAuthProvider.credential(accessToken, secret);
  }

  throw buildProviderError('This native social provider is not configured.');
};

const runNativeProviderSignIn = async (providerKey) => {
  const normalizedProvider = normalizeProviderKey(providerKey);

  if (typeof FirebaseAuthentication.useAppLanguage === 'function') {
    try {
      await FirebaseAuthentication.useAppLanguage();
    } catch {
      // Best-effort only.
    }
  }

  if (normalizedProvider === 'google') {
    return FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
  }

  if (normalizedProvider === 'facebook') {
    await ensureFacebookTrackingPermission();
    return FirebaseAuthentication.signInWithFacebook({
      skipNativeAuth: true,
      useLimitedLogin: false,
    });
  }

  if (normalizedProvider === 'x') {
    return FirebaseAuthentication.signInWithTwitter({ skipNativeAuth: true });
  }

  throw buildProviderError('This native social provider is not configured.');
};

const resolveFallbackProvider = (providerKey) => {
  const normalizedProvider = normalizeProviderKey(providerKey);
  if (normalizedProvider === 'google') return googleProvider;
  if (normalizedProvider === 'facebook') return facebookProvider;
  if (normalizedProvider === 'x') return xProvider;
  return null;
};

export const shouldUseNativeSocialAuth = (providerKey = '') => (
  nativeSocialAuthEnabled && isCapacitorNativeRuntime() && Boolean(normalizeProviderKey(providerKey))
);

export const signInWithNativeSocialProvider = async (providerKey, providerLabel = 'Social') => {
  ensureNativeSocialAuthRuntime(providerLabel);

  let nativeResult = null;
  try {
    nativeResult = await runNativeProviderSignIn(providerKey);
  } catch (error) {
    if (isNativeProviderConfigurationError(error)) {
      throw buildNativeProviderConfigurationError(providerLabel);
    }
    throw error;
  }

  const webCredential = buildWebCredential(providerKey, nativeResult?.credential || {});
  const webResult = await signInWithCredential(auth, webCredential);

  return {
    ...webResult,
    additionalUserInfo: nativeResult?.additionalUserInfo || null,
    nativeUser: nativeResult?.user || null,
    provider: resolveFallbackProvider(providerKey),
  };
};

export const signOutNativeSocialAuth = async () => {
  if (!isCapacitorNativeRuntime()) return;
  if (typeof FirebaseAuthentication.signOut !== 'function') return;

  try {
    await FirebaseAuthentication.signOut();
  } catch {
    // Best-effort only. The web Firebase session is the source of truth for app state.
  }
};

export default signInWithNativeSocialProvider;
