import { deleteApp, initializeApp } from 'firebase/app';
import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  getAuth,
  linkWithPhoneNumber,
  reauthenticateWithPhoneNumber,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
} from 'firebase/auth';
import { assertFirebaseReady, firebaseConfig } from '@/config/firebase';

const PHONE_PROVIDER_ID = 'phone';
const DEFAULT_COUNTRY_CODE = String(
  import.meta.env.VITE_DEFAULT_PHONE_COUNTRY_CODE || '+91'
).trim();

const createTempAppName = () => `aura-phone-factor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizePhoneDigits = (value = '') => String(value).replace(/\D/g, '');

export const normalizePhoneToE164 = (value = '') => {
  const raw = String(value || '').trim();
  const digits = normalizePhoneDigits(raw);

  if (!digits || digits.length < 10 || digits.length > 15) {
    throw new Error('Valid phone number is required');
  }

  if (raw.startsWith('+')) {
    return `+${digits}`;
  }

  if (digits.length > 10) {
    return `+${digits}`;
  }

  const countryDigits = normalizePhoneDigits(DEFAULT_COUNTRY_CODE) || '91';
  return `+${countryDigits}${digits}`;
};

const buildRecaptchaVerifier = (auth, container) => {
  if (!container) {
    throw new Error('Phone verification container is unavailable');
  }

  return new RecaptchaVerifier(auth, container, {
    size: 'invisible',
  });
};

const cleanupRecaptcha = (verifier) => {
  if (!verifier) return;
  try {
    verifier.clear();
  } catch {
    // best-effort cleanup
  }
};

const cleanupTempAuth = async ({ auth, app, verifier } = {}) => {
  cleanupRecaptcha(verifier);

  try {
    if (auth?.currentUser) {
      await signOut(auth);
    }
  } catch {
    // best-effort cleanup
  }

  if (app) {
    try {
      await deleteApp(app);
    } catch {
      // best-effort cleanup
    }
  }
};

const createPhoneMismatchError = (linkedPhone) => {
  const error = new Error(`Phone mismatch. This account is already linked to ${linkedPhone}.`);
  error.code = 'auth/phone-mismatch';
  return error;
};

const hasLinkedPhoneProvider = (user) => (
  Array.isArray(user?.providerData)
    && user.providerData.some((provider) => provider?.providerId === PHONE_PROVIDER_ID)
);

export const startFirebasePhoneLoginChallenge = async ({
  email,
  password,
  phone,
  recaptchaContainer,
}) => {
  assertFirebaseReady('Firebase phone verification');

  const phoneE164 = normalizePhoneToE164(phone);
  const tempApp = initializeApp(firebaseConfig, createTempAppName());
  const tempAuth = getAuth(tempApp);

  let verifier = null;

  try {
    const userCredential = await signInWithEmailAndPassword(tempAuth, email, password);
    const { user } = userCredential;
    const credentialProofToken = await user.getIdToken(true);
    const linkedPhone = user?.phoneNumber ? normalizePhoneToE164(user.phoneNumber) : '';
    const useReauthFlow = Boolean(linkedPhone || hasLinkedPhoneProvider(user));

    if (linkedPhone && linkedPhone !== phoneE164) {
      throw createPhoneMismatchError(linkedPhone);
    }

    verifier = buildRecaptchaVerifier(tempAuth, recaptchaContainer);

    const confirmationResult = useReauthFlow
      ? await reauthenticateWithPhoneNumber(user, phoneE164, verifier)
      : await linkWithPhoneNumber(user, phoneE164, verifier);

    return {
      app: tempApp,
      auth: tempAuth,
      verifier,
      confirmationResult,
      credentialProofToken,
      phoneE164,
      mode: useReauthFlow ? 'reauth' : 'link',
    };
  } catch (error) {
    await cleanupTempAuth({ auth: tempAuth, app: tempApp, verifier });
    throw error;
  }
};

export const startFirebasePhoneCodeChallenge = async ({
  phone,
  recaptchaContainer,
}) => {
  assertFirebaseReady('Firebase phone verification');

  const phoneE164 = normalizePhoneToE164(phone);
  const tempApp = initializeApp(firebaseConfig, createTempAppName());
  const tempAuth = getAuth(tempApp);

  let verifier = null;

  try {
    verifier = buildRecaptchaVerifier(tempAuth, recaptchaContainer);
    const confirmationResult = await signInWithPhoneNumber(tempAuth, phoneE164, verifier);

    return {
      app: tempApp,
      auth: tempAuth,
      verifier,
      confirmationResult,
      phoneE164,
      mode: 'phone_sign_in',
    };
  } catch (error) {
    await cleanupTempAuth({ auth: tempAuth, app: tempApp, verifier });
    throw error;
  }
};

export const completeFirebasePhoneLoginChallenge = async (challenge, otp) => {
  if (!challenge?.confirmationResult) {
    throw new Error('Phone verification challenge is unavailable');
  }

  const otpCode = String(otp || '').trim();
  const verificationId = String(challenge.confirmationResult.verificationId || '').trim();
  const credential = verificationId
    ? PhoneAuthProvider.credential(verificationId, otpCode)
    : null;
  const result = await challenge.confirmationResult.confirm(otpCode);
  const verifiedUser = result?.user || challenge.auth?.currentUser || null;

  if (!verifiedUser) {
    throw new Error('Firebase phone verification did not return an authenticated user');
  }

  await verifiedUser.getIdToken(true);

  return {
    user: verifiedUser,
    phoneE164: challenge.phoneE164,
    mode: challenge.mode,
    credential,
  };
};

export const completeFirebasePhoneCodeChallenge = completeFirebasePhoneLoginChallenge;

export const disposeFirebasePhoneLoginChallenge = async (challenge) => {
  await cleanupTempAuth({
    auth: challenge?.auth,
    app: challenge?.app,
    verifier: challenge?.verifier,
  });
};
