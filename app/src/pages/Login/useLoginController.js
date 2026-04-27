import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { getPhoneCountryOption, getPhoneCountryOptionLabel, PHONE_COUNTRY_OPTIONS } from '@/config/phoneCountryOptions';
import { authApi, otpApi } from '@/services/api';
import {
  completeFirebasePhoneCodeChallenge,
  completeFirebasePhoneLoginChallenge,
  disposeFirebasePhoneLoginChallenge,
  startFirebasePhoneCodeChallenge,
  startFirebasePhoneLoginChallenge,
} from '@/services/firebasePhoneChallenge';
import {
  clearAuthJourneyDraft,
  describeAccelerationLane,
  readAuthIdentityMemory,
  readAuthJourneyDraft,
  writeAuthJourneyDraft,
} from '@/utils/authAcceleration';
import { AUTH_SUCCESS, resolveAuthError } from '@/utils/authErrors';
import { resolveFirebasePhoneFallback } from '@/utils/firebasePhoneFallback';
import { resolveNavigationTarget } from '@/utils/navigation';
import { verifyCredentialsWithoutSession } from '@/utils/precheckCredentials';
import { getFirebaseSocialAuthStatus } from '@/config/firebase';
import {
  buildGenericOtpFlowError,
  buildInternationalPhoneNumber,
  createEmptyFormData,
  createEmptyOtpValues,
  getPhoneNationalInputValue,
  getAuthPurpose,
  isEnumerationSensitiveOtpError,
  normalizeEmail,
  normalizePhone,
  OTP_LENGTH,
  OTP_STAGE,
  OTP_TRANSPORT,
  resolvePhoneCountryCode,
  resolveLaunchMode,
  resolveLaunchPrefill,
  shouldKeepSpecificOtpError,
  validateEmail,
  validatePhone,
} from './loginFlowHelpers';

const normalizeSocialAuthError = (error, providerLabel = 'Social', socialAuthStatus = null) => {
  const errorCode = String(error?.code || '').trim();
  const errorMessage = String(error?.message || '').trim();
  const errorStatus = Number(error?.status || error?.data?.statusCode || 0);
  const normalizedMessage = errorMessage.toLowerCase();
  const normalizedError = {
    ...error,
    provider: error?.provider || providerLabel,
    host: error?.host || socialAuthStatus?.runtimeHost || '',
  };

  if (errorCode === 'auth/invalid-credential') {
    return {
      ...normalizedError,
      code: 'auth/social-invalid-credential',
      provider: providerLabel,
      originalCode: errorCode,
      message: errorMessage || `${providerLabel} authentication could not be completed.`,
    };
  }

  if (errorCode === 'auth/account-exists-with-different-credential') {
    return {
      ...normalizedError,
      provider: providerLabel,
      email: error?.email || error?.customData?.email || '',
    };
  }

  if (
    errorMessage.toLowerCase().includes('did not provide an email')
    || errorMessage.toLowerCase().includes('authenticated account is missing email')
  ) {
    return {
      ...normalizedError,
      code: 'auth/social-email-missing',
      provider: providerLabel,
    };
  }

  if (
    errorStatus >= 500
    && (
      normalizedMessage.includes('something went wrong')
      || normalizedMessage.includes('request failed with status 500')
    )
  ) {
    return {
      ...normalizedError,
      code: 'auth/social-session-sync-failed',
      provider: providerLabel,
      originalStatus: errorStatus,
      requestId: error?.serverRequestId || error?.requestId || error?.data?.requestId || '',
      message: errorMessage || `${providerLabel} authenticated, but Aura could not finish opening your session.`,
    };
  }

  if (errorCode === 'auth/popup-closed-by-user') {
    return {
      ...normalizedError,
      provider: providerLabel,
      message: errorMessage || `${providerLabel} sign-in was cancelled before completion.`,
    };
  }

  return normalizedError;
};

export const useLoginController = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { countryCode: marketCountryCode, t } = useMarket();
  const launchMode = resolveLaunchMode(location.state?.authMode);
  const launchPrefill = resolveLaunchPrefill(location.state);
  const {
    currentUser,
    isAuthenticated,
    login,
    loginWithPhoneCredential,
    loading,
    signup,
    signInWithGoogle,
    signInWithFacebook,
    signInWithX,
  } = useContext(AuthContext);

  const [mode, setMode] = useState(launchMode);
  const [step, setStep] = useState('form');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [signInProofToken, setSignInProofToken] = useState('');
  const [loginFlowToken, setLoginFlowToken] = useState('');
  const [otpTransport, setOtpTransport] = useState(OTP_TRANSPORT.BACKEND_OTP);
  const [otpStage, setOtpStage] = useState(OTP_STAGE.SINGLE);
  const [firebasePhoneFallback, setFirebasePhoneFallback] = useState(null);
  const [resumeDraft, setResumeDraft] = useState(null);
  const [identityMemory, setIdentityMemory] = useState(null);
  const [formData, setFormData] = useState(() => createEmptyFormData({
    email: launchPrefill.email,
    phone: launchPrefill.phone,
  }));
  const [phoneCountryCode, setPhoneCountryCode] = useState(() => (
    resolvePhoneCountryCode(launchPrefill.phone, marketCountryCode)
  ));
  const [otpValues, setOtpValues] = useState(createEmptyOtpValues);

  const otpRefs = useRef([]);
  const recaptchaContainerRef = useRef(null);
  const firebasePhoneChallengeRef = useRef(null);
  const authAccelerationHydratedRef = useRef(false);
  const initialResolvedAuthRedirectCheckedRef = useRef(false);

  const from = useMemo(
    () => resolveNavigationTarget(location.state?.from, '/'),
    [location.state?.from]
  );
  const hasLaunchDirective = Boolean(location.state?.authMode || launchPrefill.email || launchPrefill.phone);
  const socialAuthStatus = getFirebaseSocialAuthStatus();
  const canUseMobileFirebasePhoneOtp = !socialAuthStatus.runtimeCapacitorMobile
    || socialAuthStatus.mobileFirebasePhoneOtpEnabled;
  const canUseFirebasePhoneOtp = step !== 'reset-password'
    && socialAuthStatus.ready
    && !firebasePhoneFallback?.disableFirebasePhoneOtp
    && canUseMobileFirebasePhoneOtp;
  const isEmailOtpStage = otpStage === OTP_STAGE.EMAIL;
  const isPhoneOtpStage = otpStage === OTP_STAGE.PHONE;
  const selectedPhoneCountry = useMemo(
    () => getPhoneCountryOption(phoneCountryCode),
    [phoneCountryCode]
  );
  const phoneCountryOptions = useMemo(
    () => PHONE_COUNTRY_OPTIONS.map((option) => ({
      ...option,
      label: getPhoneCountryOptionLabel(option),
    })),
    []
  );
  const phoneLocalValue = useMemo(
    () => getPhoneNationalInputValue(formData.phone, phoneCountryCode),
    [formData.phone, phoneCountryCode]
  );

  const setErr = (rawErr) => setAuthError(resolveAuthError(rawErr));

  const clearAuthFeedback = () => {
    setAuthError(null);
    setAuthSuccess(null);
  };

  const resetOtpFlowState = ({ resetCountdown = true, preserveFlowToken = false } = {}) => {
    if (resetCountdown) {
      setCountdown(0);
    }
    setOtpValues(createEmptyOtpValues());
    setSignInProofToken('');
    if (!preserveFlowToken) {
      setLoginFlowToken('');
    }
    setOtpStage(OTP_STAGE.SINGLE);
    setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
  };

  const clearFirebaseChallenge = async () => {
    const activeChallenge = firebasePhoneChallengeRef.current;
    firebasePhoneChallengeRef.current = null;

    if (!activeChallenge) return;
    await disposeFirebasePhoneLoginChallenge(activeChallenge);
  };

  const resetToFormStep = ({ resetFields = false } = {}) => {
    setStep('form');
    clearAuthFeedback();
    resetOtpFlowState();
    if (resetFields) {
      setFormData(createEmptyFormData());
    } else {
      setFormData((prev) => ({
        ...prev,
        password: '',
        confirmPassword: '',
      }));
    }
  };

  const openResetPasswordStep = (detail) => {
    setStep('reset-password');
    resetOtpFlowState({ preserveFlowToken: true });
    setFormData((prev) => ({
      ...prev,
      password: '',
      confirmPassword: '',
    }));
    setAuthSuccess({
      title: t('login.reset.verifiedTitle', {}, 'Recovery Verified'),
      detail,
    });
  };

  const finishAuthAndNavigate = (successState) => {
    setAuthSuccess(successState);
    setTimeout(() => navigate(from, { replace: true }), 1200);
  };

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (initialResolvedAuthRedirectCheckedRef.current) return;
    if (loading) return;

    initialResolvedAuthRedirectCheckedRef.current = true;

    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [from, isAuthenticated, loading, navigate]);

  useEffect(() => {
    const inferredCountryCode = resolvePhoneCountryCode(formData.phone, phoneCountryCode || marketCountryCode);
    if (inferredCountryCode && inferredCountryCode !== phoneCountryCode) {
      setPhoneCountryCode(inferredCountryCode);
    }
  }, [formData.phone, marketCountryCode, phoneCountryCode]);

  useEffect(() => {
    if (authAccelerationHydratedRef.current) return;
    authAccelerationHydratedRef.current = true;

    const storedIdentity = readAuthIdentityMemory();
    const storedDraft = readAuthJourneyDraft();

    if (storedIdentity) {
      setIdentityMemory(storedIdentity);
      if (!hasLaunchDirective) {
        setFormData((prev) => ({
          ...prev,
          email: prev.email || storedIdentity.email || '',
          phone: prev.phone || storedIdentity.phone || '',
        }));
      }
    }

    if (!storedDraft) return;

    setResumeDraft(storedDraft);
    setFormData((prev) => ({
      ...prev,
      name: prev.name || storedDraft.name || storedIdentity?.displayName || '',
      email: prev.email || storedDraft.email || storedIdentity?.email || '',
      phone: prev.phone || storedDraft.phone || storedIdentity?.phone || '',
    }));

    if (!hasLaunchDirective) {
      setMode(storedDraft.mode);
    }

    if (storedDraft.canResumeOtp) {
      setMode(storedDraft.mode);
      setStep('otp');
      setOtpStage(storedDraft.otpStage);
      setOtpTransport(storedDraft.otpTransport);
      setCountdown(storedDraft.countdown);
    }
  }, [hasLaunchDirective]);

  useEffect(() => () => {
    clearFirebaseChallenge().catch(() => {});
  }, []);

  useEffect(() => {
    if (currentUser) {
      clearAuthJourneyDraft();
      return;
    }

    const email = normalizeEmail(formData.email);
    const phone = normalizePhone(formData.phone);
    const name = formData.name.trim();
    const hasIdentity = Boolean(email || phone || name);

    if (!hasIdentity && step === 'form') {
      clearAuthJourneyDraft();
      return;
    }

    writeAuthJourneyDraft({
      mode,
      step,
      name,
      email,
      phone,
      otpStage,
      otpTransport,
      countdown,
      fallbackToBackupOtp: Boolean(firebasePhoneFallback?.disableFirebasePhoneOtp),
    });
  }, [
    countdown,
    currentUser,
    firebasePhoneFallback?.disableFirebasePhoneOtp,
    formData.email,
    formData.name,
    formData.phone,
    mode,
    otpStage,
    otpTransport,
    step,
  ]);

  const handleChange = (event) => {
    setFormData((prev) => ({
      ...prev,
      [event.target.name]: event.target.value,
    }));
    setAuthError(null);
  };

  const handlePhoneCountryChange = (event) => {
    const nextCountryCode = resolvePhoneCountryCode('', event.target.value);
    const nextPhone = buildInternationalPhoneNumber(phoneLocalValue, nextCountryCode);

    setPhoneCountryCode(nextCountryCode);
    setFormData((prev) => ({
      ...prev,
      phone: nextPhone,
    }));
    setAuthError(null);
  };

  const handlePhoneChange = (event) => {
    const rawPhone = event.target.value;
    const nextCountryCode = resolvePhoneCountryCode(rawPhone, phoneCountryCode);

    if (nextCountryCode !== phoneCountryCode) {
      setPhoneCountryCode(nextCountryCode);
    }

    setFormData((prev) => ({
      ...prev,
      phone: buildInternationalPhoneNumber(rawPhone, nextCountryCode),
    }));
    setAuthError(null);
  };

  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;

    const nextOtp = [...otpValues];
    nextOtp[index] = value.slice(-1);
    setOtpValues(nextOtp);
    setAuthError(null);

    if (value && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !otpValues[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (event) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    const nextOtp = [...otpValues];
    pasted.split('').forEach((digit, index) => {
      nextOtp[index] = digit;
    });
    setOtpValues(nextOtp);
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    otpRefs.current[focusIndex]?.focus();
  };

  const getOtpString = () => otpValues.join('');

  const applySavedIdentity = (memory = null) => {
    if (!memory) return;

    clearFirebaseChallenge().catch(() => {});
    setResumeDraft(null);
    setMode('signin');
    setStep('form');
    clearAuthFeedback();
    resetOtpFlowState();
    setFirebasePhoneFallback(null);
    setFormData((prev) => ({
      ...prev,
      name: prev.name || memory.displayName || '',
      email: memory.email || prev.email,
      phone: memory.phone || prev.phone,
      password: '',
      confirmPassword: '',
    }));
  };

  const startOtpStep = ({
    transport,
    stage = OTP_STAGE.SINGLE,
    success,
    resetCountdown = true,
  }) => {
    setOtpTransport(transport);
    setOtpStage(stage);
    setStep('otp');
    setOtpValues(createEmptyOtpValues());
    if (resetCountdown) {
      setCountdown(60);
    }
    setAuthSuccess(success);
    setTimeout(() => otpRefs.current[0]?.focus(), 300);
  };

  const buildOtpSuccessState = ({
    transport,
    stage = OTP_STAGE.SINGLE,
    resend = false,
    fallback = null,
  } = {}) => {
    const modeLabel = mode === 'signup'
      ? 'account setup'
      : mode === 'forgot-password'
        ? 'password recovery'
        : 'sign-in';
    const phoneOutcome = mode === 'signup'
      ? 'finish activating your account'
      : mode === 'forgot-password'
        ? 'unlock password reset'
        : 'finish signing in';

    if (fallback) {
      return resend ? fallback.resendSuccess : fallback.success;
    }

    if (stage === OTP_STAGE.EMAIL) {
      return {
        title: resend ? 'Codes Re-Sent' : 'Email Code Sent',
        detail: resend
          ? `Fresh ${modeLabel} codes were sent. Enter the email code first, then confirm the same flow with Firebase SMS.`
          : `Your email code is ready. After that, you will confirm the same ${modeLabel} with Firebase SMS on your phone.`,
      };
    }

    if (stage === OTP_STAGE.PHONE && transport === OTP_TRANSPORT.FIREBASE_SMS) {
      return {
        title: 'Email Verified',
        detail: `Step 1 is complete. Enter the Firebase SMS code sent to your phone to ${phoneOutcome}.`,
      };
    }

    if (transport === OTP_TRANSPORT.FIREBASE_SMS) {
      return {
        title: resend ? 'Firebase Code Re-Sent' : 'Firebase SMS Sent',
        detail: resend
          ? 'A fresh 6-digit Firebase verification code is on its way to your phone.'
          : 'A 6-digit Firebase verification code has been sent to your phone.',
      };
    }

    return {
      title: 'Check for a Code',
      detail: resend
        ? 'If the account details are valid, a fresh verification code has been sent.'
        : 'If the account details are valid, a 6-digit verification code has been sent.',
    };
  };

  const sendBackendOtp = async ({
    email,
    phone,
    purpose,
    password,
    resend = false,
    successOverride = null,
  }) => {
    let credentialProofToken = '';

    if (mode === 'signin') {
      const precheck = await verifyCredentialsWithoutSession(email, password);
      credentialProofToken = precheck?.credentialProofToken || '';
      if (!credentialProofToken) {
        throw new Error('Unable to verify credentials for secure OTP flow.');
      }
      setSignInProofToken(credentialProofToken);
    }

    await otpApi.sendOtp(email, phone, purpose, {
      ...(mode === 'signin' ? { credentialProofToken } : {}),
    });

    startOtpStep({
      transport: OTP_TRANSPORT.BACKEND_OTP,
      stage: OTP_STAGE.SINGLE,
      success: successOverride || buildOtpSuccessState({
        transport: OTP_TRANSPORT.BACKEND_OTP,
        stage: OTP_STAGE.SINGLE,
        resend,
      }),
    });
  };

  const startDualChannelFlow = async ({ email, phone, resend = false }) => {
    await clearFirebaseChallenge();
    setSignInProofToken('');
    setLoginFlowToken('');

    try {
      const purpose = getAuthPurpose(mode);

      if (mode === 'signin') {
        const challenge = await startFirebasePhoneLoginChallenge({
          email,
          password: formData.password,
          phone,
          recaptchaContainer: recaptchaContainerRef.current,
        });

        firebasePhoneChallengeRef.current = challenge;

        const credentialProofToken = String(challenge?.credentialProofToken || '').trim();
        if (!credentialProofToken) {
          throw new Error('Unable to start secure sign-in proof. Please try again.');
        }

        setSignInProofToken(credentialProofToken);

        await otpApi.sendOtp(email, phone, purpose, {
          credentialProofToken,
          skipSms: true,
          strictIdentity: true,
        });
      } else {
        const challenge = await startFirebasePhoneCodeChallenge({
          phone,
          recaptchaContainer: recaptchaContainerRef.current,
        });

        firebasePhoneChallengeRef.current = challenge;

        await otpApi.sendOtp(email, phone, purpose, {
          skipSms: true,
        });
      }

      startOtpStep({
        transport: OTP_TRANSPORT.BACKEND_OTP,
        stage: OTP_STAGE.EMAIL,
        success: buildOtpSuccessState({
          transport: OTP_TRANSPORT.BACKEND_OTP,
          stage: OTP_STAGE.EMAIL,
          resend,
        }),
      });
    } catch (error) {
      setSignInProofToken('');
      await clearFirebaseChallenge();
      throw error;
    }
  };

  const finalizePhoneBackedSignIn = async (email, verifiedPhoneFactor) => {
    const resolvedFlowToken = typeof loginFlowToken === 'string' ? loginFlowToken.trim() : '';
    if (!resolvedFlowToken) {
      throw new Error('Secure login token expired. Please request a fresh code.');
    }

    if (!verifiedPhoneFactor?.credential) {
      throw new Error('Secure phone-backed sign-in could not be completed. Please request a new code.');
    }

    await loginWithPhoneCredential(verifiedPhoneFactor.credential, {
      email,
      phone: verifiedPhoneFactor.phoneE164 || formData.phone,
      loginFlowToken: resolvedFlowToken,
    });
  };

  const validateStrongPasswordFields = ({ password, confirmPassword }) => {
    if (!password) { setErr({ message: t('login.error.passwordRequired', {}, 'Password is required') }); return false; }
    if (password.length < 12) { setErr({ message: t('login.error.passwordLength', {}, 'Password must be at least 12 characters') }); return false; }
    if (!/[A-Z]/.test(password)) { setErr({ message: t('login.error.passwordUppercase', {}, 'Password must contain an uppercase letter') }); return false; }
    if (!/[a-z]/.test(password)) { setErr({ message: t('login.error.passwordLowercase', {}, 'Password must contain a lowercase letter') }); return false; }
    if (!/[0-9]/.test(password)) { setErr({ message: t('login.error.passwordDigit', {}, 'Password must contain a digit') }); return false; }
    if (!/[!@#$%^&*]/.test(password)) { setErr({ message: t('login.error.passwordSpecial', {}, 'Password must contain a special character (!@#$%^&*)') }); return false; }
    if (password !== confirmPassword) { setErr({ message: t('login.error.passwordMismatch', {}, 'Passwords do not match') }); return false; }
    return true;
  };

  const validateForm = () => {
    if (!formData.phone) {
      setErr({ message: t('login.error.phoneRequired', {}, 'Phone number is required') });
      return false;
    }
    if (!validatePhone(formData.phone)) {
      setErr({ message: t('login.error.phoneValid', {}, 'Use international phone format with country code, for example +1 202 555 0142') });
      return false;
    }
    if (mode === 'signup') {
      if (!formData.name) { setErr({ message: t('login.error.fullNameRequired', {}, 'Full name is required') }); return false; }
      if (!formData.email) { setErr({ message: t('login.error.emailRequired', {}, 'Email address is required') }); return false; }
      if (!validateEmail(formData.email)) { setErr({ message: t('login.error.emailValid', {}, 'Valid email address is required') }); return false; }
      if (!validateStrongPasswordFields({
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      })) {
        return false;
      }
    }
    if (mode === 'signin') {
      if (!formData.email) { setErr({ message: t('login.error.emailRequired', {}, 'Email address is required') }); return false; }
      if (!validateEmail(formData.email)) { setErr({ message: t('login.error.emailValid', {}, 'Valid email address is required') }); return false; }
      if (!formData.password) { setErr({ message: t('login.error.passwordRequired', {}, 'Password is required') }); return false; }
    }
    if (mode === 'forgot-password') {
      if (!formData.email) { setErr({ message: t('login.error.emailRequired', {}, 'Email address is required') }); return false; }
      if (!validateEmail(formData.email)) { setErr({ message: t('login.error.emailValid', {}, 'Valid email address is required') }); return false; }
    }
    return true;
  };

  const handleSendOtp = async () => {
    if (!validateForm()) return;
    if (mode === 'signup' && currentUser) {
      setErr({ message: t('login.error.alreadySignedIn', {}, 'You are already signed in. Please log out before creating another account.') });
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    setLoginFlowToken('');
    setAuthSuccess(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = normalizePhone(formData.phone);
      const purpose = getAuthPurpose(mode);
      let backendSuccessOverride = null;

      if (canUseFirebasePhoneOtp) {
        try {
          await startDualChannelFlow({ email, phone });
          return;
        } catch (firebasePhoneError) {
          const fallback = resolveFirebasePhoneFallback(firebasePhoneError);
          if (!fallback) {
            setErr(firebasePhoneError);
            return;
          }
          if (fallback.disableFirebasePhoneOtp) {
            setFirebasePhoneFallback(fallback);
          }
          backendSuccessOverride = buildOtpSuccessState({
            transport: OTP_TRANSPORT.BACKEND_OTP,
            stage: OTP_STAGE.SINGLE,
            fallback,
          });
          await clearFirebaseChallenge();
        }
      }

      await sendBackendOtp({
        email,
        phone,
        purpose,
        password: formData.password,
        successOverride: backendSuccessOverride,
      });
    } catch (error) {
      if ((mode === 'signin' || mode === 'forgot-password')
        && isEnumerationSensitiveOtpError(error)
        && !shouldKeepSpecificOtpError(error)) {
        setErr(buildGenericOtpFlowError(t));
      } else {
        setErr(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otpString = getOtpString();
    if (otpString.length !== OTP_LENGTH) {
      setErr({ message: 'Enter complete 6-digit OTP' });
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = normalizePhone(formData.phone);
      const purpose = getAuthPurpose(mode);

      if (isEmailOtpStage) {
        const verificationResult = await otpApi.verifyOtp(phone, otpString, purpose, {
          email,
          factor: 'email',
        });
        const nextFlowToken = String(verificationResult?.flowToken || '').trim();
        if (mode === 'signin' && !nextFlowToken) {
          throw new Error('Secure login token expired. Please request a fresh code.');
        }
        setLoginFlowToken(nextFlowToken);
        startOtpStep({
          transport: OTP_TRANSPORT.FIREBASE_SMS,
          stage: OTP_STAGE.PHONE,
          success: buildOtpSuccessState({
            transport: OTP_TRANSPORT.FIREBASE_SMS,
            stage: OTP_STAGE.PHONE,
          }),
          resetCountdown: false,
        });
        return;
      }

      if (isPhoneOtpStage) {
        const activeChallenge = firebasePhoneChallengeRef.current;
        if (!activeChallenge) {
          setErr({ message: 'Secure phone challenge expired. Please request a new code.' });
          setStep('form');
          return;
        }

        const verifiedPhoneFactor = mode === 'signin'
          ? await completeFirebasePhoneLoginChallenge(activeChallenge, otpString)
          : await completeFirebasePhoneCodeChallenge(activeChallenge, otpString);

        try {
          if (mode !== 'signin') {
            const completionResult = await authApi.completePhoneFactorVerification(purpose, email, verifiedPhoneFactor.phoneE164, {
              firebaseUser: verifiedPhoneFactor.user,
            });
            if (mode === 'forgot-password') {
              const nextFlowToken = String(completionResult?.flowToken || '').trim();
              if (!nextFlowToken) {
                throw new Error('Secure recovery token expired. Please request a fresh code.');
              }
              setLoginFlowToken(nextFlowToken);
            }
          }
        } finally {
          await clearFirebaseChallenge();
        }

        if (mode === 'signin') {
          await finalizePhoneBackedSignIn(email, verifiedPhoneFactor);
          resetOtpFlowState();
          finishAuthAndNavigate(AUTH_SUCCESS.signin_success);
        } else if (mode === 'signup') {
          await signup(email, formData.password, formData.name.trim(), phone);
          resetOtpFlowState();
          finishAuthAndNavigate(AUTH_SUCCESS.signup_success);
        } else if (mode === 'forgot-password') {
          openResetPasswordStep(
            t(
              'login.reset.verifiedDual',
              {},
              'Your email OTP and Firebase phone verification are complete. Set a new password for this account now.'
            )
          );
        }
        return;
      }

      const otpResult = await otpApi.verifyOtp(phone, otpString, purpose);

      if (mode === 'signup') {
        await signup(email, formData.password, formData.name.trim(), phone);
        finishAuthAndNavigate(AUTH_SUCCESS.signup_success);
      } else if (mode === 'signin') {
        const flowToken = String(otpResult?.flowToken || '').trim();
        if (!flowToken) {
          throw new Error('Secure login token expired. Please request a fresh code.');
        }
        await login(email, formData.password, {
          loginFlowToken: flowToken,
          phone,
        });
        resetOtpFlowState();
        finishAuthAndNavigate(AUTH_SUCCESS.signin_success);
      } else if (mode === 'forgot-password') {
        const flowToken = String(otpResult?.flowToken || '').trim();
        if (!flowToken) {
          throw new Error('Secure recovery token expired. Please request a fresh code.');
        }
        setLoginFlowToken(flowToken);
        openResetPasswordStep(
          t(
            'login.reset.verifiedSingle',
            {},
            'Your email and phone are verified. Set a new password for this account now.'
          )
        );
        return;
      }
      setSignInProofToken('');
      setLoginFlowToken('');
    } catch (error) {
      if ((mode === 'signin' || mode === 'forgot-password')
        && isEnumerationSensitiveOtpError(error)
        && !shouldKeepSpecificOtpError(error)) {
        setErr(buildGenericOtpFlowError(t));
      } else {
        setErr(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0) return;

    setIsLoading(true);
    setAuthError(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = normalizePhone(formData.phone);
      const purpose = getAuthPurpose(mode);
      let backendSuccessOverride = null;

      if (otpStage !== OTP_STAGE.SINGLE && canUseFirebasePhoneOtp) {
        try {
          await startDualChannelFlow({ email, phone, resend: true });
          return;
        } catch (firebasePhoneError) {
          const fallback = resolveFirebasePhoneFallback(firebasePhoneError);
          if (!fallback) {
            throw firebasePhoneError;
          }
          if (fallback.disableFirebasePhoneOtp) {
            setFirebasePhoneFallback(fallback);
          }
          backendSuccessOverride = buildOtpSuccessState({
            transport: OTP_TRANSPORT.BACKEND_OTP,
            stage: OTP_STAGE.SINGLE,
            resend: true,
            fallback,
          });
          await clearFirebaseChallenge();
        }
      }

      if (mode === 'signin' && !signInProofToken) {
        setErr({ message: 'Secure sign-in proof expired. Please re-enter credentials.' });
        setStep('form');
        return;
      }

      await sendBackendOtp({
        email,
        phone,
        purpose,
        password: formData.password,
        resend: true,
        successOverride: backendSuccessOverride,
      });
    } catch (error) {
      if ((mode === 'signin' || mode === 'forgot-password')
        && isEnumerationSensitiveOtpError(error)
        && !shouldKeepSpecificOtpError(error)) {
        setErr(buildGenericOtpFlowError(t));
      } else {
        setErr(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = (newMode) => {
    clearFirebaseChallenge().catch(() => {});
    clearAuthJourneyDraft();
    setResumeDraft(null);
    setMode(newMode);
    setFirebasePhoneFallback(null);
    resetToFormStep({ resetFields: true });
  };

  const goBack = () => {
    clearFirebaseChallenge().catch(() => {});
    resetToFormStep();
  };

  const handleResetPassword = async () => {
    if (!validateStrongPasswordFields({
      password: formData.password,
      confirmPassword: formData.confirmPassword,
    })) {
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const resolvedFlowToken = typeof loginFlowToken === 'string' ? loginFlowToken.trim() : '';
      if (!resolvedFlowToken) {
        throw new Error('Secure recovery token expired. Please restart password recovery.');
      }

      await otpApi.resetPassword({
        flowToken: resolvedFlowToken,
        password: formData.password,
      });

      setAuthSuccess(AUTH_SUCCESS.password_reset_success);
      setTimeout(() => {
        setMode('signin');
        resetToFormStep();
      }, 1400);
    } catch (error) {
      setErr(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (step === 'form') {
      handleSendOtp();
    } else if (step === 'otp') {
      handleVerifyOtp();
    } else if (step === 'reset-password') {
      handleResetPassword();
    }
  };

  const info = useMemo(() => {
    if (step === 'reset-password') {
      return {
        title: t('login.info.reset.title', {}, 'SET NEW PASSWORD'),
        desc: t('login.info.reset.desc', {}, 'Your recovery verification is complete for the registered email and phone. Choose a fresh password to regain access securely.'),
      };
    }

    if (step === 'otp') {
      if (isEmailOtpStage) {
        return {
          title: t('login.info.otp.email.title', {}, 'VERIFY EMAIL'),
          desc: mode === 'signup'
            ? t('login.info.otp.email.signup', {}, 'Step 1 of 2. Enter the 6-digit code sent to your email, then finish account activation with Firebase SMS on your phone.')
            : mode === 'forgot-password'
              ? t('login.info.otp.email.forgot', {}, 'Step 1 of 2. Enter the 6-digit code sent to your email, then finish recovery with Firebase SMS on your phone.')
              : t('login.info.otp.email.signin', {}, 'Step 1 of 2. Enter the 6-digit code sent to your email, then finish the same sign-in with Firebase SMS on your phone.'),
        };
      }

      if (isPhoneOtpStage) {
        return {
          title: t('login.info.otp.phone.title', {}, 'VERIFY PHONE'),
          desc: mode === 'signup'
            ? t('login.info.otp.phone.signup', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to activate your account securely.')
            : mode === 'forgot-password'
              ? t('login.info.otp.phone.forgot', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to unlock secure password recovery.')
              : t('login.info.otp.phone.signin', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to complete secure sign-in.'),
        };
      }

      return {
        title: t('login.info.otp.title', {}, 'VERIFY OTP'),
        desc: otpTransport === OTP_TRANSPORT.FIREBASE_SMS
          ? t('login.info.otp.firebase', {}, 'Enter the 6-digit Firebase SMS code sent to your phone to complete the login.')
          : t('login.info.otp.default', { extra: formData.phone ? t('login.info.otp.defaultExtra', {}, ' and phone') : '' }, 'Enter the 6-digit code sent to your email{{extra}}.'),
      };
    }

    switch (mode) {
      case 'signup':
        return {
          title: t('login.info.signup.title', {}, 'CREATE ACCOUNT'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.signup.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent through the available secure verification channel before account creation.')
            : canUseFirebasePhoneOtp
              ? t('login.info.signup.dual', {}, 'Sign up with your details, then verify the account with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.signup.single', {}, 'Sign up with your phone number. We\'ll verify it with an OTP sent to your email and phone.'),
        };
      case 'forgot-password':
        return {
          title: t('login.info.forgot.title', {}, 'RESET PASSWORD'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.forgot.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent through the available secure verification channel before password reset.')
            : canUseFirebasePhoneOtp
              ? t('login.info.forgot.dual', {}, 'Enter your registered email and phone number, then verify recovery with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.forgot.single', {}, 'Enter your registered email and phone number. We\'ll verify both before allowing a new password.'),
        };
      default:
        return {
          title: t('login.info.signin.title', {}, 'WELCOME BACK'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.signin.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent through the available secure verification channel after your password is checked.')
            : canUseFirebasePhoneOtp
              ? t('login.info.signin.dual', {}, 'Sign in with your password, then verify the login with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.signin.single', {}, 'Sign in with your credentials. We\'ll verify your identity with an OTP.'),
        };
    }
  }, [canUseFirebasePhoneOtp, firebasePhoneFallback?.disableFirebasePhoneOtp, formData.phone, isEmailOtpStage, isPhoneOtpStage, mode, otpTransport, step, t]);

  const trustNotes = useMemo(() => {
    if (step === 'reset-password') {
      return [
        t('login.trust.reset.1', {}, 'This password change is allowed only after verified recovery for the same email and phone.'),
        t('login.trust.reset.2', {}, 'Your new password must meet the full strength policy before it is saved.'),
        t('login.trust.reset.3', {}, 'Existing Firebase sessions are revoked after the reset so the new password takes effect cleanly.'),
      ];
    }

    if (step === 'otp') {
      if (isEmailOtpStage) {
        return [
          mode === 'signup'
            ? t('login.trust.otp.email.signup', {}, 'Step 1 verifies the email address that will own the new account.')
            : mode === 'forgot-password'
              ? t('login.trust.otp.email.forgot', {}, 'Step 1 verifies the registered recovery email for this account.')
              : t('login.trust.otp.email.signin', {}, 'Step 1 checks the email address tied to your password and registered phone number.'),
          t('login.trust.otp.email.2', {}, 'Step 2 will still require the Firebase phone code before this flow is finalized.'),
          t('login.trust.otp.email.3', {}, 'Both codes expire quickly and each resend refreshes the full secure verification chain.'),
        ];
      }

      if (isPhoneOtpStage) {
        return [
          mode === 'signup'
            ? t('login.trust.otp.phone.signup', {}, 'Your email step is already verified for this new account.')
            : mode === 'forgot-password'
              ? t('login.trust.otp.phone.forgot', {}, 'Your recovery email step is already verified for this account.')
              : t('login.trust.otp.phone.signin', {}, 'Your email step is already verified for this login attempt.'),
          t('login.trust.otp.phone.2', {}, 'The final Firebase SMS confirmation binds this flow to your registered phone.'),
          t('login.trust.otp.phone.3', {}, 'If the phone code expires, resend refreshes both email and phone factors together.'),
        ];
      }

      return [
        t('login.trust.otp.default.1', {}, 'Codes expire in 5 minutes and can be used only once.'),
        t('login.trust.otp.default.2', {}, 'Aura never asks for your OTP outside this secure verification step.'),
        t('login.trust.otp.default.3', {}, 'Retry and resend controls stay available if delivery is delayed.'),
      ];
    }

    if (mode === 'signup') {
      return [
        firebasePhoneFallback?.disableFirebasePhoneOtp
          ? t('login.trust.signup.1fallback', {}, 'Firebase phone delivery is unavailable here, so Aura is using secure backup delivery through the available verification channel before account creation.')
          : canUseFirebasePhoneOtp
            ? t('login.trust.signup.1dual', {}, 'Email is checked first, then Firebase phone verification finishes the new account securely.')
            : t('login.trust.signup.1single', {}, 'Email and phone are verified before a new account becomes active.'),
        t('login.trust.signup.2', {}, 'Seller, payment, and order access stay locked behind verified identity.'),
        t('login.trust.signup.3', {}, 'Fraud checks and duplicate-account controls run before activation.'),
      ];
    }

    if (mode === 'forgot-password') {
      return [
        firebasePhoneFallback?.disableFirebasePhoneOtp
          ? t('login.trust.forgot.1fallback', {}, 'Firebase phone delivery is unavailable here, so Aura is using secure backup delivery through the available verification channel before recovery continues.')
          : canUseFirebasePhoneOtp
            ? t('login.trust.forgot.1dual', {}, 'Recovery checks your email first, then requires Firebase phone verification before password reset.')
            : t('login.trust.forgot.1single', {}, 'Reset requests stay tied to your registered email and phone.'),
        t('login.trust.forgot.2', {}, 'A fresh verification chain is required before any password recovery step.'),
        t('login.trust.forgot.3', {}, 'Suspicious recovery attempts are rate-limited automatically.'),
      ];
    }

    return [
      firebasePhoneFallback?.disableFirebasePhoneOtp
        ? t('login.trust.signin.1fallback', {}, 'Firebase phone verification is unavailable here, so Aura is using secure backup delivery through the available verification channel.')
        : canUseFirebasePhoneOtp
          ? t('login.trust.signin.1dual', {}, 'Password is verified first, then login codes are sent to both your email and Firebase phone channel.')
          : t('login.trust.signin.1single', {}, 'Password validity is checked before an OTP is issued.'),
      t('login.trust.signin.2', {}, 'Phone confirmation reduces account-takeover risk before the session is finalized.'),
      t('login.trust.signin.3', {}, 'Rate limits, device checks, and audit logs guard repeated attempts.'),
    ];
  }, [canUseFirebasePhoneOtp, firebasePhoneFallback?.disableFirebasePhoneOtp, isEmailOtpStage, isPhoneOtpStage, mode, step, t]);

  const secureSignals = useMemo(() => ([
    {
      label: step === 'otp' ? t('login.signal.windowOtp', {}, 'OTP window') : step === 'reset-password' ? t('login.signal.windowReset', {}, 'Reset window') : t('login.signal.identityGate', {}, 'Identity gate'),
      value: step === 'otp'
        ? t('login.signal.valueOtp', {}, '5-minute secure verify')
        : step === 'reset-password'
          ? t('login.signal.valueReset', {}, 'OTP verified, new password pending')
          : t('login.signal.valueIdentity', {}, 'Credentials checked before send'),
    },
    {
      label: t('login.signal.delivery', {}, 'Delivery'),
      value: isEmailOtpStage
        ? t('login.signal.deliveryEmail', {}, 'Email OTP live, Firebase phone pending')
        : isPhoneOtpStage
          ? t('login.signal.deliveryPhone', {}, 'Email verified, Firebase SMS active')
          : firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.signal.deliveryFallback', {}, 'Backup OTP fallback active')
            : canUseFirebasePhoneOtp
              ? t('login.signal.deliveryDual', {}, 'Email + Firebase SMS')
              : formData.phone ? t('login.signal.deliveryActive', {}, 'Email + phone active') : t('login.signal.deliveryRequired', {}, 'Email first, phone required'),
    },
    {
      label: t('login.signal.flow', {}, 'Flow'),
      value: mode === 'signup'
        ? t('login.signal.flowSignup', {}, 'New account activation')
        : mode === 'forgot-password'
          ? step === 'reset-password'
            ? t('login.signal.flowRecoveryUnlocked', {}, 'Recovery unlocked')
            : t('login.signal.flowRecovery', {}, 'Password recovery')
          : t('login.signal.flowSignin', {}, 'Secure sign-in'),
    },
    {
      label: t('login.signal.social', {}, 'Social access'),
      value: socialAuthStatus.supported
        ? t('login.signal.socialAvailable', {}, 'Google, Facebook, and X available')
        : socialAuthStatus.disabledByMobileNativeConfig
          ? t('login.signal.socialMobileConfig', {}, 'Email OTP active in app')
        : socialAuthStatus.runtimeBlocked
          ? t('login.signal.socialBlocked', {}, 'OTP-only until this tab is refreshed')
          : t('login.signal.socialHost', { host: socialAuthStatus.runtimeHost || t('login.signal.thisHost', {}, 'this host') }, 'OTP-only on {{host}}'),
    },
  ]), [
    canUseFirebasePhoneOtp,
    firebasePhoneFallback?.disableFirebasePhoneOtp,
    formData.phone,
    isEmailOtpStage,
    isPhoneOtpStage,
    mode,
    socialAuthStatus.disabledByMobileNativeConfig,
    socialAuthStatus.runtimeBlocked,
    socialAuthStatus.runtimeHost,
    socialAuthStatus.supported,
    step,
    t,
  ]);

  const accelerationCards = useMemo(() => {
    const cards = [];

    if (resumeDraft) {
      cards.push({
        key: 'resume-draft',
        icon: 'resume',
        eyebrow: t('login.acceleration.resume', {}, 'Resumable flow'),
        title: resumeDraft.resumeMessage?.title || t('login.acceleration.resumeTitle', {}, 'Fast recovery ready'),
        body: resumeDraft.resumeMessage?.detail || t('login.acceleration.resumeBody', {}, 'Your previous secure auth attempt can be restarted with the saved identity details.'),
        meta: resumeDraft.savedAtLabel
          ? t('login.acceleration.savedAt', { age: resumeDraft.savedAtLabel }, 'Saved {{age}}')
          : '',
      });
    }

    if (identityMemory) {
      const identityTitle = identityMemory.maskedEmail || identityMemory.maskedPhone || t('login.acceleration.identityTitle', {}, 'Known identity');
      const identityBody = identityMemory.assuranceLabel
        ? t(
          'login.acceleration.identityBody',
          {
            assurance: identityMemory.assuranceLabel,
            provider: identityMemory.providerLabel,
            age: identityMemory.savedAtLabel || t('login.acceleration.justNow', {}, 'just now'),
          },
          'Last secure session used {{assurance}} via {{provider}} {{age}}.'
        )
        : t(
          'login.acceleration.identityBodyFallback',
          {
            provider: identityMemory.providerLabel,
            age: identityMemory.savedAtLabel || t('login.acceleration.justNow', {}, 'just now'),
          },
          'Last secure session used {{provider}} {{age}}.'
        );

      cards.push({
        key: 'identity-memory',
        icon: 'identity',
        eyebrow: t('login.acceleration.identity', {}, 'Known identity'),
        title: identityTitle,
        body: identityBody,
        meta: identityMemory.maskedPhone || '',
        actionLabel: t('login.acceleration.useIdentity', {}, 'Use saved identity'),
        onAction: () => applySavedIdentity(identityMemory),
      });
    }

    const lane = describeAccelerationLane({
      mode,
      canUseFirebasePhoneOtp,
      socialAuthSupported: socialAuthStatus.supported,
      fallbackToBackupOtp: Boolean(firebasePhoneFallback?.disableFirebasePhoneOtp || resumeDraft?.fallbackToBackupOtp),
    });

    cards.push({
      key: 'lane',
      icon: 'lane',
      eyebrow: t('login.acceleration.lane', {}, 'Fastest lane'),
      title: lane.title,
      body: lane.detail,
    });

    return cards;
  }, [
    canUseFirebasePhoneOtp,
    firebasePhoneFallback?.disableFirebasePhoneOtp,
    identityMemory,
    mode,
    resumeDraft,
    socialAuthStatus.supported,
    t,
  ]);

  const handleFeedbackAction = () => {
    if (!authError?.action) return;

    if (authError.action === 'resend') {
      handleResendOtp();
      return;
    }

    if (authError.action === 'back') {
      goBack();
      return;
    }

    switchMode(authError.action);
  };

  const handleSocialSignIn = async (providerSignIn, providerLabel = 'Social') => {
    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const result = await providerSignIn();
      if (result?.redirecting) {
        return;
      }
      if (result?.dbUser) {
        finishAuthAndNavigate(AUTH_SUCCESS.signin_success);
      } else {
        navigate(from, { replace: true });
      }
    } catch (error) {
      console.error(`${providerLabel} sign-in failed`, error);
      setErr(normalizeSocialAuthError(error, providerLabel, socialAuthStatus));
    } finally {
      setIsLoading(false);
    }
  };

  const submitLabel = useMemo(() => {
    if (step === 'reset-password') return t('login.submit.reset', {}, 'RESET PASSWORD');

    if (step === 'otp') {
      if (isEmailOtpStage) return t('login.submit.verifyEmail', {}, 'VERIFY EMAIL CODE');
      if (isPhoneOtpStage) {
        if (mode === 'signup') return t('login.submit.verifyPhoneCreate', {}, 'VERIFY PHONE & CREATE ACCOUNT');
        if (mode === 'forgot-password') return t('login.submit.verifyPhoneContinue', {}, 'VERIFY PHONE & CONTINUE');
        return t('login.submit.verifyPhoneSignin', {}, 'VERIFY PHONE & SIGN IN');
      }
      return mode === 'signin' ? t('login.submit.verifyOtpSignin', {}, 'VERIFY OTP & SIGN IN') : t('login.submit.verifyOtp', {}, 'VERIFY OTP');
    }

    if (firebasePhoneFallback?.disableFirebasePhoneOtp) return t('login.submit.sendBackupOtp', {}, 'SEND BACKUP OTP');
    if (mode === 'signup') return canUseFirebasePhoneOtp ? t('login.submit.sendDualOtp', {}, 'SEND EMAIL + PHONE OTP') : t('login.submit.sendOtpSignup', {}, 'SEND OTP & SIGN UP');
    if (mode === 'forgot-password') return canUseFirebasePhoneOtp ? t('login.submit.sendDualOtp', {}, 'SEND EMAIL + PHONE OTP') : t('login.submit.sendOtp', {}, 'SEND OTP');
    return canUseFirebasePhoneOtp ? t('login.submit.sendDualOtp', {}, 'SEND EMAIL + PHONE OTP') : t('login.submit.sendOtpSignin', {}, 'SEND OTP & SIGN IN');
  }, [canUseFirebasePhoneOtp, firebasePhoneFallback?.disableFirebasePhoneOtp, isEmailOtpStage, isPhoneOtpStage, mode, step, t]);

  return {
    OTP_TRANSPORT,
    accelerationCards,
    authError,
    authSuccess,
    canUseFirebasePhoneOtp,
    countdown,
    firebasePhoneFallback,
    formData,
    goBack,
    handleChange,
    handleFeedbackAction,
    handlePhoneChange,
    handlePhoneCountryChange,
    handleOtpChange,
    handleOtpKeyDown,
    handleOtpPaste,
    handleResendOtp,
    handleSocialSignIn,
    handleSubmit,
    info,
    isEmailOtpStage,
    isLoading,
    isPhoneOtpStage,
    mode,
    otpRefs,
    otpTransport,
    otpValues,
    phoneCountryCode,
    phoneCountryOptions,
    phoneLocalValue,
    recaptchaContainerRef,
    secureSignals,
    selectedPhoneCountry,
    setShowPassword,
    showPassword,
    signInWithFacebook,
    signInWithGoogle,
    signInWithX,
    socialAuthStatus,
    step,
    submitLabel,
    switchMode,
    t,
    trustNotes,
  };
};
