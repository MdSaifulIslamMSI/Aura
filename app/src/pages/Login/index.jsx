import { useState, useContext, useRef, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Phone, Zap, Network, ArrowLeft, Shield, Loader2 } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { authApi, otpApi } from '@/services/api';
import {
  completeFirebasePhoneCodeChallenge,
  completeFirebasePhoneLoginChallenge,
  disposeFirebasePhoneLoginChallenge,
  startFirebasePhoneCodeChallenge,
  startFirebasePhoneLoginChallenge,
} from '@/services/firebasePhoneChallenge';
import { cn } from '@/lib/utils';
import { AuthFeedback } from '@/components/shared/AuthFeedback';
import { resolveAuthError, AUTH_SUCCESS } from '@/utils/authErrors';
import { resolveFirebasePhoneFallback } from '@/utils/firebasePhoneFallback';
import { resolveNavigationTarget } from '@/utils/navigation';
import { verifyCredentialsWithoutSession } from '@/utils/precheckCredentials';
import { getFirebaseSocialAuthStatus } from '@/config/firebase';

const OTP_LENGTH = 6;
const OTP_TRANSPORT = {
  FIREBASE_SMS: 'firebase_sms',
  BACKEND_OTP: 'backend_otp',
};
const OTP_STAGE = {
  SINGLE: 'single',
  EMAIL: 'email',
  PHONE: 'phone',
};
const AUTH_MODES = new Set(['signin', 'signup', 'forgot-password']);

const resolveLaunchMode = (value = '') => {
  const nextMode = String(value || '').trim();
  return AUTH_MODES.has(nextMode) ? nextMode : 'signin';
};

const resolveLaunchPrefill = (state = null) => ({
  email: typeof state?.authPrefill?.email === 'string'
    ? state.authPrefill.email.trim().toLowerCase()
    : '',
  phone: typeof state?.authPrefill?.phone === 'string'
    ? state.authPrefill.phone.trim()
    : '',
});

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useMarket();
  const launchMode = resolveLaunchMode(location.state?.authMode);
  const launchPrefill = resolveLaunchPrefill(location.state);
  const {
    currentUser,
    login,
    loginWithPhoneCredential,
    signup,
    signInWithGoogle,
    signInWithFacebook,
    signInWithX,
  } = useContext(AuthContext);

  // Mode: 'signin' | 'signup' | 'forgot-password'
  const [mode, setMode] = useState(launchMode);
  // Step: 'form' | 'otp' | 'reset-password'
  const [step, setStep] = useState('form');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState(null);  // structured error
  const [authSuccess, setAuthSuccess] = useState(null); // structured success
  const [countdown, setCountdown] = useState(0);
  const [signInProofToken, setSignInProofToken] = useState('');
  const [otpTransport, setOtpTransport] = useState(OTP_TRANSPORT.BACKEND_OTP);
  const [otpStage, setOtpStage] = useState(OTP_STAGE.SINGLE);
  const [firebasePhoneFallback, setFirebasePhoneFallback] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    email: launchPrefill.email,
    phone: launchPrefill.phone,
    password: '',
    confirmPassword: '',
  });

  const [otpValues, setOtpValues] = useState(Array(OTP_LENGTH).fill(''));
  const otpRefs = useRef([]);
  const recaptchaContainerRef = useRef(null);
  const firebasePhoneChallengeRef = useRef(null);

  const from = useMemo(
    () => resolveNavigationTarget(location.state?.from, '/'),
    [location.state?.from]
  );
  const socialAuthStatus = getFirebaseSocialAuthStatus();
  const canUseFirebasePhoneOtp = step !== 'reset-password'
    && socialAuthStatus.ready
    && !firebasePhoneFallback?.disableFirebasePhoneOtp;
  const isEmailOtpStage = otpStage === OTP_STAGE.EMAIL;
  const isPhoneOtpStage = otpStage === OTP_STAGE.PHONE;

  // OTP resend countdown timer
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  useEffect(() => {
    if (!currentUser) return;
    navigate(from, { replace: true });
  }, [currentUser, from, navigate]);

  const clearFirebaseChallenge = async () => {
    const activeChallenge = firebasePhoneChallengeRef.current;
    firebasePhoneChallengeRef.current = null;

    if (!activeChallenge) return;
    await disposeFirebasePhoneLoginChallenge(activeChallenge);
  };

  useEffect(() => () => {
    clearFirebaseChallenge().catch(() => {});
  }, []);

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    setAuthError(null);
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // OTP Input Handlers
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return; // Only digits

    const newOtp = [...otpValues];
    newOtp[index] = value.slice(-1); // Take only last digit
    setOtpValues(newOtp);
    setAuthError(null);

    // Auto-focus next input
    if (value && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpValues[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    const newOtp = [...otpValues];
    pasted.split('').forEach((digit, i) => {
      newOtp[i] = digit;
    });
    setOtpValues(newOtp);
    // Focus last filled or next empty
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    otpRefs.current[focusIndex]?.focus();
  };

  const getOtpString = () => otpValues.join('');

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Validation
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const validatePhone = (phone) => {
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    return /^\+?\d{10,15}$/.test(cleaned);
  };
  const normalizePhone = (phone) => phone.replace(/[\s\-\(\)]/g, '').trim();
  const normalizeEmail = (email) => email.trim().toLowerCase();
  const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

  const setErr = (rawErr) => setAuthError(resolveAuthError(rawErr));

  const startOtpStep = ({
    transport,
    stage = OTP_STAGE.SINGLE,
    success,
    resetCountdown = true,
  }) => {
    setOtpTransport(transport);
    setOtpStage(stage);
    setStep('otp');
    setOtpValues(Array(OTP_LENGTH).fill(''));
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

    try {
      const purpose = mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login';

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
    if (!verifiedPhoneFactor?.credential) {
      await login(email, formData.password);
      return;
    }

    try {
      await loginWithPhoneCredential(verifiedPhoneFactor.credential, { email });
    } catch {
      await login(email, formData.password);
    }
  };


  const buildGenericOtpFlowError = () => ({
    message: t('login.error.genericOtpFlow', {}, 'If the account details are valid, continue with OTP verification.')
  });

  const isEnumerationSensitiveOtpError = (err) => {
    const status = Number(err?.status || err?.response?.status || 0);
    const rawMessage = String(
      err?.response?.data?.message
      || err?.message
      || err?.error
      || ''
    ).toLowerCase();

    return status === 404
      || rawMessage.includes('no account found')
      || rawMessage.includes('does not match the account')
      || rawMessage.includes('phone mismatch')
      || rawMessage.includes('email mismatch');
  };

  const shouldKeepSpecificOtpError = (err) => {
    const rawMessage = String(
      err?.response?.data?.message
      || err?.message
      || err?.error
      || ''
    ).toLowerCase();

    return rawMessage.includes('registered account')
      || rawMessage.includes('no verified account found')
      || rawMessage.includes('sign up first');
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
      setErr({ message: t('login.error.phoneRequired', {}, 'Phone number is required') }); return false;
    }
    if (!validatePhone(formData.phone)) {
      setErr({ message: t('login.error.phoneValid', {}, 'Valid phone number is required') }); return false;
    }
    if (mode === 'signup') {
      if (!formData.name) { setErr({ message: t('login.error.fullNameRequired', {}, 'Full name is required') }); return false; }
      if (!formData.email) { setErr({ message: t('login.error.emailRequired', {}, 'Email address is required') }); return false; }
      if (!validateEmail(formData.email)) { setErr({ message: t('login.error.emailValid', {}, 'Valid email address is required') }); return false; }
      if (!validateStrongPasswordFields({
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      })) { return false; }
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Step 1 Handler: Send OTP
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const handleSendOtp = async () => {
    if (!validateForm()) return;
    if (mode === 'signup' && currentUser) {
      setErr({ message: t('login.error.alreadySignedIn', {}, 'You are already signed in. Please log out before creating another account.') });
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = normalizePhone(formData.phone);
      const purpose = mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login';
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
    } catch (err) {
      if ((mode === 'signin' || mode === 'forgot-password') && isEnumerationSensitiveOtpError(err) && !shouldKeepSpecificOtpError(err)) {
        setErr(buildGenericOtpFlowError());
      } else {
        setErr(err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Step 2 Handler: Verify OTP & Complete Auth
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
      const purpose = mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login';

      if (isEmailOtpStage) {
        await otpApi.verifyOtp(phone, otpString, purpose, {
          email,
          factor: 'email',
        });
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
          if (mode === 'signin') {
            await authApi.completePhoneFactorLogin(email, verifiedPhoneFactor.phoneE164, {
              firebaseUser: verifiedPhoneFactor.user,
            });
          } else {
            await authApi.completePhoneFactorVerification(purpose, email, verifiedPhoneFactor.phoneE164, {
              firebaseUser: verifiedPhoneFactor.user,
            });
          }
        } finally {
          await clearFirebaseChallenge();
        }

        if (mode === 'signin') {
          await finalizePhoneBackedSignIn(email, verifiedPhoneFactor);
          setSignInProofToken('');
          setOtpStage(OTP_STAGE.SINGLE);
          setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
          setAuthSuccess(AUTH_SUCCESS.signin_success);
          setTimeout(() => navigate(from, { replace: true }), 1200);
        } else if (mode === 'signup') {
          await signup(email, formData.password, formData.name.trim(), phone);
          setOtpStage(OTP_STAGE.SINGLE);
          setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
          setAuthSuccess(AUTH_SUCCESS.signup_success);
          setTimeout(() => navigate(from, { replace: true }), 1200);
        } else if (mode === 'forgot-password') {
          setStep('reset-password');
          setOtpValues(Array(OTP_LENGTH).fill(''));
          setOtpStage(OTP_STAGE.SINGLE);
          setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
          setFormData((prev) => ({
            ...prev,
            password: '',
            confirmPassword: '',
          }));
          setAuthSuccess({
            title: t('login.reset.verifiedTitle', {}, 'Recovery Verified'),
            detail: t('login.reset.verifiedDual', {}, 'Your email OTP and Firebase phone verification are complete. Set a new password for this account now.'),
          });
        }
        return;
      }

      await otpApi.verifyOtp(phone, otpString, purpose);

      if (mode === 'signup') {
        await signup(email, formData.password, formData.name.trim(), phone);
        setAuthSuccess(AUTH_SUCCESS.signup_success);
        setTimeout(() => navigate(from, { replace: true }), 1200);
      } else if (mode === 'signin') {
        await login(email, formData.password);
        setOtpStage(OTP_STAGE.SINGLE);
        setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
        setAuthSuccess(AUTH_SUCCESS.signin_success);
        setTimeout(() => navigate(from, { replace: true }), 1200);
      } else if (mode === 'forgot-password') {
        setStep('reset-password');
        setOtpValues(Array(OTP_LENGTH).fill(''));
        setFormData((prev) => ({
          ...prev,
          password: '',
          confirmPassword: '',
        }));
        setAuthSuccess({
          title: t('login.reset.verifiedTitle', {}, 'Recovery Verified'),
          detail: t('login.reset.verifiedSingle', {}, 'Your email and phone are verified. Set a new password for this account now.'),
        });
        return;
      }
      setSignInProofToken('');
    } catch (err) {
      if ((mode === 'signin' || mode === 'forgot-password') && isEnumerationSensitiveOtpError(err) && !shouldKeepSpecificOtpError(err)) {
        setErr(buildGenericOtpFlowError());
      } else {
        setErr(err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Resend OTP
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const handleResendOtp = async () => {
    if (countdown > 0) return;

    setIsLoading(true);
    setAuthError(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = normalizePhone(formData.phone);
      const purpose = mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login';
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
    } catch (err) {
      if ((mode === 'signin' || mode === 'forgot-password') && isEnumerationSensitiveOtpError(err) && !shouldKeepSpecificOtpError(err)) {
        setErr(buildGenericOtpFlowError());
      } else {
        setErr(err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Mode/Step Reset
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const switchMode = (newMode) => {
    clearFirebaseChallenge().catch(() => {});
    setMode(newMode);
    setStep('form');
    setAuthError(null);
    setAuthSuccess(null);
    setCountdown(0);
    setOtpValues(Array(OTP_LENGTH).fill(''));
    setFormData({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
    setSignInProofToken('');
    setOtpStage(OTP_STAGE.SINGLE);
    setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
  };

  const goBack = () => {
    clearFirebaseChallenge().catch(() => {});
    setStep('form');
    setAuthError(null);
    setAuthSuccess(null);
    setCountdown(0);
    setOtpValues(Array(OTP_LENGTH).fill(''));
    setSignInProofToken('');
    setOtpStage(OTP_STAGE.SINGLE);
    setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
    setFormData((prev) => ({
      ...prev,
      password: '',
      confirmPassword: '',
    }));
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Submit Handler
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const handleSubmit = (e) => {
    e.preventDefault();
    if (step === 'form') {
      handleSendOtp();
    } else if (step === 'otp') {
      handleVerifyOtp();
    } else if (step === 'reset-password') {
      handleResetPassword();
    }
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Info Panel Text
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const getInfoText = () => {
    if (step === 'reset-password') {
      return {
        title: t('login.info.reset.title', {}, 'SET NEW PASSWORD'),
        desc: t('login.info.reset.desc', {}, 'Your recovery verification is complete for the registered email and phone. Choose a fresh password to regain access securely.')
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
              : t('login.info.otp.email.signin', {}, 'Step 1 of 2. Enter the 6-digit code sent to your email, then finish the same sign-in with Firebase SMS on your phone.')
        };
      }

      if (isPhoneOtpStage) {
        return {
          title: t('login.info.otp.phone.title', {}, 'VERIFY PHONE'),
          desc: mode === 'signup'
            ? t('login.info.otp.phone.signup', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to activate your account securely.')
            : mode === 'forgot-password'
              ? t('login.info.otp.phone.forgot', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to unlock secure password recovery.')
              : t('login.info.otp.phone.signin', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to complete secure sign-in.')
        };
      }

      return {
        title: t('login.info.otp.title', {}, 'VERIFY OTP'),
        desc: otpTransport === OTP_TRANSPORT.FIREBASE_SMS
          ? t('login.info.otp.firebase', {}, 'Enter the 6-digit Firebase SMS code sent to your phone to complete the login.')
          : t('login.info.otp.default', { extra: formData.phone ? t('login.info.otp.defaultExtra', {}, ' and phone') : '' }, 'Enter the 6-digit code sent to your email{{extra}}.')
      };
    }
    switch (mode) {
      case 'signup':
        return {
          title: t('login.info.signup.title', {}, 'CREATE ACCOUNT'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.signup.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent to your email and mobile before account creation.')
            : canUseFirebasePhoneOtp
              ? t('login.info.signup.dual', {}, 'Sign up with your details, then verify the account with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.signup.single', {}, 'Sign up with your phone number. We\'ll verify it with an OTP sent to your email and phone.')
        };
      case 'forgot-password':
        return {
          title: t('login.info.forgot.title', {}, 'RESET PASSWORD'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.forgot.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent to your registered email and mobile before password reset.')
            : canUseFirebasePhoneOtp
              ? t('login.info.forgot.dual', {}, 'Enter your registered email and phone number, then verify recovery with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.forgot.single', {}, 'Enter your registered email and phone number. We\'ll verify both before allowing a new password.')
        };
      default:
        return {
          title: t('login.info.signin.title', {}, 'WELCOME BACK'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.signin.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent to your email and mobile after your password is checked.')
            : canUseFirebasePhoneOtp
            ? t('login.info.signin.dual', {}, 'Sign in with your password, then verify the login with one code to email and one Firebase SMS code to your phone.')
            : t('login.info.signin.single', {}, 'Sign in with your credentials. We\'ll verify your identity with an OTP.')
        };
    }
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
      const email = normalizeEmail(formData.email);
      const phone = normalizePhone(formData.phone);

      await otpApi.resetPassword(email, phone, formData.password);

      setAuthSuccess(AUTH_SUCCESS.password_reset_success);
      setTimeout(() => {
        setMode('signin');
        setStep('form');
        setCountdown(0);
        setOtpValues(Array(OTP_LENGTH).fill(''));
        setOtpStage(OTP_STAGE.SINGLE);
        setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
        setSignInProofToken('');
        setAuthError(null);
        setAuthSuccess(null);
        setFormData((prev) => ({
          ...prev,
          password: '',
          confirmPassword: '',
        }));
      }, 1400);
    } catch (err) {
      setErr(err);
    } finally {
      setIsLoading(false);
    }
  };

  const info = getInfoText();

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
          ? t('login.trust.signup.1fallback', {}, 'Firebase phone delivery is unavailable here, so Aura is using secure backup delivery to email and mobile before account creation.')
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
          ? t('login.trust.forgot.1fallback', {}, 'Firebase phone delivery is unavailable here, so Aura is using secure backup delivery to email and mobile before recovery continues.')
          : canUseFirebasePhoneOtp
            ? t('login.trust.forgot.1dual', {}, 'Recovery checks your email first, then requires Firebase phone verification before password reset.')
            : t('login.trust.forgot.1single', {}, 'Reset requests stay tied to your registered email and phone.'),
        t('login.trust.forgot.2', {}, 'A fresh verification chain is required before any password recovery step.'),
        t('login.trust.forgot.3', {}, 'Suspicious recovery attempts are rate-limited automatically.'),
      ];
    }

    return [
      firebasePhoneFallback?.disableFirebasePhoneOtp
        ? t('login.trust.signin.1fallback', {}, 'Firebase phone verification is unavailable here, so Aura is using secure backup delivery to email and mobile.')
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
            ? t('login.signal.deliveryFallback', {}, 'Email + mobile backup OTP')
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
        : socialAuthStatus.runtimeBlocked
          ? t('login.signal.socialBlocked', {}, 'OTP-only until this tab is refreshed')
          : t('login.signal.socialHost', { host: socialAuthStatus.runtimeHost || t('login.signal.thisHost', {}, 'this host') }, 'OTP-only on {{host}}'),
    },
  ]), [canUseFirebasePhoneOtp, firebasePhoneFallback?.disableFirebasePhoneOtp, formData.phone, isEmailOtpStage, isPhoneOtpStage, mode, socialAuthStatus.runtimeBlocked, socialAuthStatus.runtimeHost, socialAuthStatus.supported, step, t]);

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

  const handleSocialSignIn = async (providerSignIn) => {
    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const result = await providerSignIn();
      if (result?.redirecting) {
        return;
      }
      if (result?.dbUser) {
        setAuthSuccess(AUTH_SUCCESS.signin_success);
        setTimeout(() => navigate(from, { replace: true }), 1200);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setErr(err);
    } finally {
      setIsLoading(false);
    }
  };

  const submitLabel = (() => {
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
  })();

  return (
    <div className="min-h-screen py-8 sm:py-12 md:py-20 relative flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-zinc-950 z-0" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.1)_0%,transparent_50%)] pointer-events-none z-0" />
      <div className="absolute top-1/4 left-1/4 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-cyan/10 rounded-full blur-[120px] pointer-events-none z-0 mix-blend-screen" />
      <div className="absolute bottom-1/4 right-1/4 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-fuchsia/10 rounded-full blur-[120px] pointer-events-none z-0 mix-blend-screen" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px] pointer-events-none z-0 opacity-50" />

      <div className="container-custom relative z-10">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white/5 rounded-[28px] sm:rounded-[40px] shadow-glass overflow-hidden border border-white/10 flex flex-col md:flex-row relative group hover:border-neo-cyan/30 hover:shadow-[0_0_40px_rgba(6,182,212,0.15)] transition-all duration-700">
            <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan/10 via-neo-fuchsia/10 to-neo-emerald/10 opacity-0 group-hover:opacity-100 animate-gradient-x transition-opacity duration-700 pointer-events-none" style={{ backgroundSize: '200% auto' }} />
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none z-0" />

            {/* â”€â”€â”€ Left Side â€” Info Panel â”€â”€â”€ */}
            <div className="md:w-[45%] bg-zinc-950/80 p-6 sm:p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(217,70,239,0.1),transparent)] pointer-events-none" />
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20 mix-blend-overlay pointer-events-none" />

              <div className="relative z-10">
                <Link to="/" className="inline-flex items-center gap-2 mb-8 sm:mb-12 lg:mb-20 hover:opacity-80 transition-opacity">
                  <div className="w-10 h-10 bg-gradient-to-br from-neo-cyan to-neo-fuchsia rounded-xl p-[2px] shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                    <div className="w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
                      <span className="text-white font-black mix-blend-screen">Ar</span>
                    </div>
                  </div>
                  <span className="text-xl font-black uppercase tracking-widest text-white">Aura</span>
                </Link>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black mb-6 text-transparent bg-clip-text bg-gradient-to-r from-neo-cyan to-white tracking-tighter leading-tight drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                  {info.title}
                </h1>
                <p className="text-slate-400 font-medium text-base sm:text-lg leading-relaxed max-w-md border-l-2 border-neo-cyan pl-4">
                  {info.desc}
                </p>

                <div className="mt-8 grid gap-3 max-w-md">
                  {trustNotes.map((note) => (
                    <div
                      key={note}
                      className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300/95 shadow-[0_12px_30px_rgba(2,8,23,0.25)]"
                    >
                      <span className="mr-2 text-neo-cyan">?</span>
                      {note}
                    </div>
                  ))}
                </div>
              </div>

              <div className="hidden md:flex relative z-10 items-center justify-center p-8 mt-10">
                {step === 'otp' || step === 'reset-password' ? (
                  <Shield className="w-40 h-40 text-neo-cyan/20 drop-shadow-[0_0_30px_rgba(6,182,212,0.4)] animate-spin-slow" />
                ) : (
                  <Network className="w-40 h-40 text-neo-fuchsia/20 drop-shadow-[0_0_30px_rgba(217,70,239,0.4)] animate-spin-slow" />
                )}
              </div>
            </div>

            {/* â”€â”€â”€ Right Side â€” Form â”€â”€â”€ */}
            <div className="md:w-[55%] p-6 sm:p-8 lg:p-14 relative z-10 flex flex-col justify-center bg-transparent">

              <div className="mb-6 rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_45px_rgba(2,8,23,0.28)]">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-neo-cyan">
                  <Shield className="h-4 w-4" />
                  {t('login.secureEntry', {}, 'Secure Entry Layer')}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {secureSignals.map((signal) => (
                    <div
                      key={signal.label}
                      className="rounded-2xl border border-white/8 bg-zinc-950/45 px-3 py-3"
                    >
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                        {signal.label}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">
                        {signal.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Error */}
              {authError && (
                <div className="mb-6">
                  <AuthFeedback
                    type="error"
                    title={authError.title}
                    detail={authError.detail}
                    hint={authError.hint}
                    actionLabel={authError.actionLabel}
                    onAction={authError.action ? handleFeedbackAction : undefined}
                  />
                </div>
              )}

              {/* Success */}
              {authSuccess && (
                <div className="mb-6">
                  <AuthFeedback
                    type="success"
                    title={authSuccess.title}
                    detail={authSuccess.detail}
                  />
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5" autoComplete="on">
                <div ref={recaptchaContainerRef} id="firebase-phone-recaptcha" className="sr-only" aria-hidden="true" />

                {/* â•â•â•â•â•â•â• STEP 1: FORM â•â•â•â•â•â•â• */}
                {step === 'form' && (
                  <>
                    {/* Name â€” Signup Only */}
                    {mode === 'signup' && (
                      <div className="animate-fade-in">
                        <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.fullName', {}, 'Full Name')} *</label>
                        <div className="relative group/input">
                          <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                          <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder={t('login.placeholder.fullName', {}, 'John Doe')} autoComplete="name"
                            className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                        </div>
                      </div>
                    )}

                    {/* Email â€” Signup & Signin */}
                    {mode !== 'forgot-password' && (
                      <div className="animate-fade-in">
                        <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.email', {}, 'Email Address')} *</label>
                        <div className="relative group/input">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                          <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder={t('login.placeholder.email', {}, 'you@example.com')} autoComplete={mode === 'signin' ? 'username' : 'email'}
                            className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                        </div>
                      </div>
                    )}

                    {/* Phone â€” Always Required */}
                    <div className="animate-fade-in">
                      <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.phone', {}, 'Phone Number')} *</label>
                      <div className="relative group/input">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                        <input type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="+91 98765 43210" autoComplete="tel"
                          className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                      </div>
                      <p className="text-[10px] text-slate-600 mt-1.5 uppercase tracking-widest font-bold pl-1">
                        {firebasePhoneFallback?.disableFirebasePhoneOtp
                          ? t('login.phoneHint.fallback', {}, 'Firebase SMS is unavailable here. Secure backup OTP will be sent to your email and mobile instead.')
                          : canUseFirebasePhoneOtp
                          ? mode === 'signup'
                            ? t('login.phoneHint.signup', {}, 'Signup sends one code to email and one Firebase SMS code to your phone.')
                            : mode === 'forgot-password'
                              ? t('login.phoneHint.forgot', {}, 'Recovery sends one code to email and one Firebase SMS code to your phone.')
                              : t('login.phoneHint.signin', {}, 'Sign-in sends one code to email and one Firebase SMS code to your phone.')
                          : t('login.phoneHint.default', {}, 'OTP will be sent to your email & phone')}
                      </p>
                    </div>

                    {/* Password â€” Signup & Signin */}
                    {mode !== 'forgot-password' && (
                      <div className="animate-fade-in">
                        <div className="flex justify-between items-end mb-2">
                          <label className="block text-xs uppercase tracking-widest font-bold text-slate-400">{t('login.field.password', {}, 'Password')} *</label>
                          {mode === 'signin' && (
                            <button type="button" onClick={() => switchMode('forgot-password')}
                              className="text-neo-cyan text-xs font-bold uppercase tracking-widest hover:text-neo-fuchsia transition-colors">
                              {t('login.action.forgotPassword', {}, 'Forgot Password?')}
                            </button>
                          )}
                        </div>
                        <div className="relative group/input">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                          <input type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} placeholder="........" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                            className="w-full pl-12 pr-14 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                          <button type="button" onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors p-1">
                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Confirm Password â€” Signup Only */}
                    {mode === 'signup' && (
                      <div className="animate-fade-in">
                        <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.confirmPassword', {}, 'Confirm Password')} *</label>
                        <div className="relative group/input">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                          <input type={showPassword ? 'text' : 'password'} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} placeholder="........" autoComplete="new-password"
                            className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                        </div>
                      </div>
                    )}

                    {/* Forgot Password â€” Email field */}
                    {mode === 'forgot-password' && (
                      <div className="animate-fade-in">
                        <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.registeredEmail', {}, 'Registered Email')} *</label>
                        <div className="relative group/input">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                          <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder={t('login.placeholder.email', {}, 'you@example.com')} autoComplete="email"
                            className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner" />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* â•â•â•â•â•â•â• STEP 2: OTP VERIFICATION â•â•â•â•â•â•â• */}
                {step === 'otp' && (
                  <div className="animate-fade-in">
                    {/* Back button */}
                    <button type="button" onClick={goBack}
                      className="flex items-center gap-2 text-slate-400 hover:text-white text-xs uppercase tracking-widest font-bold mb-6 transition-colors">
                      <ArrowLeft className="w-4 h-4" /> {t('login.action.backToForm', {}, 'Back to form')}
                    </button>

                    <div className="text-center mb-8">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-neo-cyan/20 to-neo-fuchsia/20 border border-white/10 flex items-center justify-center">
                        <Shield className="w-8 h-8 text-neo-cyan" />
                      </div>
                      <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">{t('login.otp.title', {}, 'Enter Verification Code')}</h3>
                      {isEmailOtpStage ? (
                        <p className="text-slate-400 text-sm">
                          {t('login.otp.emailStepPrefix', {}, 'Step 1 of 2. We sent a 6-digit email code to')} <span className="text-white font-bold">{formData.email}</span>.
                          {' '}
                          {mode === 'signup'
                            ? <>{t('login.otp.emailStepSignupPrefix', {}, 'Your Firebase SMS code for')} <span className="text-white font-bold">{formData.phone}</span> {t('login.otp.emailStepSignupSuffix', {}, 'will finish activating this account next.')}</>
                            : mode === 'forgot-password'
                              ? <>{t('login.otp.emailStepForgotPrefix', {}, 'Your Firebase SMS code for')} <span className="text-white font-bold">{formData.phone}</span> {t('login.otp.emailStepForgotSuffix', {}, 'will unlock password recovery next.')}</>
                              : <>{t('login.otp.emailStepSigninPrefix', {}, 'Your Firebase SMS code for')} <span className="text-white font-bold">{formData.phone}</span> {t('login.otp.emailStepSigninSuffix', {}, 'will complete the same login next.')}</>}
                        </p>
                      ) : isPhoneOtpStage ? (
                        <p className="text-slate-400 text-sm">
                          {t('login.otp.phoneStepPrefix', {}, 'Step 2 of 2. Your email is verified. Enter the Firebase SMS code sent to')} <span className="text-white font-bold">{formData.phone}</span>{' '}
                          {mode === 'signup'
                            ? t('login.otp.phoneStepSignup', {}, 'to activate the account.')
                            : mode === 'forgot-password'
                              ? t('login.otp.phoneStepForgot', {}, 'to continue password recovery.')
                              : t('login.otp.phoneStepSignin', {}, 'to finish signing in.')}
                        </p>
                      ) : otpTransport === OTP_TRANSPORT.FIREBASE_SMS ? (
                        <p className="text-slate-400 text-sm">
                          {t('login.otp.firebaseSent', {}, 'We sent a 6-digit Firebase SMS code to')} <span className="text-white font-bold">{formData.phone}</span>.
                        </p>
                      ) : (
                        <p className="text-slate-400 text-sm">
                          {t('login.otp.defaultSent', {}, 'We sent a 6-digit code to')} <span className="text-white font-bold">{formData.email}</span>
                          {formData.phone && <> {t('login.otp.and', {}, 'and')} <span className="text-white font-bold">{formData.phone}</span></>}
                        </p>
                      )}
                    </div>

                    {/* OTP Input Boxes */}
                    <div className="flex justify-center gap-2 sm:gap-3 mb-8">
                      {otpValues.map((digit, index) => (
                        <input
                          key={index}
                          ref={(el) => (otpRefs.current[index] = el)}
                          type="text"
                          inputMode="numeric"
                          autoComplete={index === 0 ? 'one-time-code' : 'off'}
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(index, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(index, e)}
                          onPaste={index === 0 ? handleOtpPaste : undefined}
                          className={cn(
                            'w-10 h-12 sm:w-12 sm:h-14 md:w-14 md:h-16 text-center text-2xl font-black rounded-xl border-2 bg-zinc-950/50 text-white outline-none transition-all duration-300',
                            digit
                              ? 'border-neo-cyan shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                              : 'border-white/10 focus:border-neo-cyan focus:ring-2 focus:ring-neo-cyan/50 focus:shadow-[0_0_20px_rgba(6,182,212,0.4)]'
                          )}
                        />
                      ))}
                    </div>

                    {/* Resend */}
                    <div className="text-center mb-4">
                      {countdown > 0 ? (
                        <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">
                          {t('login.otp.resendIn', { seconds: countdown }, 'Resend in {{seconds}}s')}
                        </p>
                      ) : (
                        <button type="button" onClick={handleResendOtp} disabled={isLoading}
                          className="text-neo-cyan text-xs uppercase tracking-widest font-bold hover:text-white transition-colors">
                          {t('login.otp.resend', {}, 'Resend OTP')}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {step === 'reset-password' && (
                  <div className="animate-fade-in">
                    <button type="button" onClick={goBack}
                      className="flex items-center gap-2 text-slate-400 hover:text-white text-xs uppercase tracking-widest font-bold mb-6 transition-colors">
                      <ArrowLeft className="w-4 h-4" /> {t('login.action.backToForm', {}, 'Back to form')}
                    </button>

                    <div className="text-center mb-8">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-neo-cyan/20 to-neo-fuchsia/20 border border-white/10 flex items-center justify-center">
                        <Lock className="w-8 h-8 text-neo-cyan" />
                      </div>
                      <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">{t('login.reset.title', {}, 'Create New Password')}</h3>
                      <p className="text-slate-400 text-sm">
                        {t('login.reset.bodyPrefix', {}, 'Recovery is verified for')} <span className="text-white font-bold">{formData.email}</span>.
                        {' '}
                        {t('login.reset.bodySuffix', {}, 'Set a strong new password for the account tied to')} <span className="text-white font-bold">{formData.phone}</span>.
                      </p>
                    </div>

                      <div className="space-y-5">
                      <div className="animate-fade-in">
                        <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.newPassword', {}, 'New Password')} *</label>
                        <div className="relative group/input">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            placeholder="........"
                            autoComplete="new-password"
                            className="w-full pl-12 pr-14 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner"
                          />
                          <button type="button" onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors p-1">
                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                          </button>
                        </div>
                      </div>

                      <div className="animate-fade-in">
                        <label className="block text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">{t('login.field.confirmPassword', {}, 'Confirm Password')} *</label>
                        <div className="relative group/input">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/input:text-neo-cyan transition-colors" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            name="confirmPassword"
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            placeholder="........"
                            autoComplete="new-password"
                            className="w-full pl-12 pr-4 py-4 bg-zinc-950/50 border border-white/10 rounded-2xl focus:outline-none focus:border-neo-cyan focus:ring-1 focus:ring-neo-cyan text-white placeholder:text-slate-600 font-medium transition-all shadow-inner"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* â•â•â•â•â•â•â• SUBMIT BUTTON â•â•â•â•â•â•â• */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className={cn(
                    'w-full btn-primary py-4 sm:py-5 mt-2 text-sm sm:text-base tracking-[0.2em] relative overflow-hidden group/submit shadow-[0_0_20px_rgba(6,182,212,0.3)]',
                    isLoading && 'opacity-70 cursor-wait'
                  )}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-3 relative z-10 text-white">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t('login.processing', {}, 'PROCESSING...')}
                    </span>
                  ) : (
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {submitLabel}
                      <Zap className="w-5 h-5 fill-white group-hover/submit:animate-pulse" />
                    </span>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan to-neo-fuchsia opacity-0 group-hover/submit:opacity-40 transition-opacity duration-300 pointer-events-none" />
                </button>
              </form>

                            {/* OR DIVIDER + SOCIAL SIGN IN */}
              {step === 'form' && mode !== 'forgot-password' && (
                <div className="mt-6 animate-fade-in">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                    <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500">{t('login.or', {}, 'or')}</span>
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  </div>
                  {socialAuthStatus.supported ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <button
                        type="button"
                        onClick={() => handleSocialSignIn(signInWithGoogle)}
                        disabled={isLoading}
                        className="py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-xs tracking-[0.08em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-white/20 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSocialSignIn(signInWithFacebook)}
                        disabled={isLoading}
                        className="py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-[#1877F2]/15 text-white font-bold text-xs tracking-[0.08em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-[#1877F2]/40"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                          <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.023 4.388 11.015 10.125 11.926v-8.437H7.078v-3.49h3.047V9.412c0-3.017 1.792-4.686 4.533-4.686 1.312 0 2.686.235 2.686.235v2.96h-1.513c-1.491 0-1.956.93-1.956 1.884v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.088 24 18.096 24 12.073z" />
                        </svg>
                        Facebook
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSocialSignIn(signInWithX)}
                        disabled={isLoading}
                        className="py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-xs tracking-[0.08em] uppercase transition-all duration-300 flex items-center justify-center gap-2 hover:border-white/30"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                          <path fill="currentColor" d="M18.244 2H21l-6.54 7.475L22 22h-5.828l-4.566-5.964L6.39 22H3.633l7-8.002L2 2h5.977l4.127 5.446L18.244 2Zm-1.021 18.285h1.527L7.147 3.624H5.507l11.716 16.661Z" />
                        </svg>
                        X
                      </button>
                    </div>
                  ) : socialAuthStatus.ready ? (
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-amber-300">
                        {socialAuthStatus.runtimeBlocked
                          ? t('login.social.paused', {}, 'Social sign-in paused on this tab')
                          : t('login.social.disabledHost', {}, 'Social sign-in is disabled on this host')}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {socialAuthStatus.runtimeBlocked ? (
                          <>
                            {t('login.social.runtimeBlockedPrefix', {}, 'Firebase rejected popup sign-in for')}{' '}
                            <span className="font-semibold text-slate-200">{socialAuthStatus.runtimeHost || t('login.social.thisDomain', {}, 'this domain')}</span>{' '}
                            {t('login.social.runtimeBlockedSuffix', {}, 'in this tab. Refresh after confirming the domain is authorized, or continue with email and OTP now.')}
                          </>
                        ) : (
                          <>
                            {t('login.social.enablePrefix', {}, 'Use email and OTP sign-in here. To enable Google, Facebook, and X, authorize')}{' '}
                            <span className="font-semibold text-slate-200">{socialAuthStatus.runtimeHost || t('login.social.thisDomain', {}, 'this domain')}</span>{' '}
                            {t('login.social.enableSuffix', {}, 'in Firebase Authentication settings.')}
                          </>
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-rose-300">
                        {t('login.social.unavailable', {}, 'Social sign-in is unavailable on this deployment')}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {t('login.social.unavailableBody', {}, 'Firebase authentication did not initialize cleanly for this frontend build. Email and OTP sign-in remain available.')}
                      </p>
                      {socialAuthStatus.initErrorCode && (
                        <p className="mt-2 text-[11px] text-slate-500">
                          {t('login.social.runtimeCode', {}, 'Runtime code:')} <span className="font-semibold text-slate-300">{socialAuthStatus.initErrorCode}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
{/* â•â•â•â•â•â•â• MODE TOGGLE â•â•â•â•â•â•â• */}
              <div className="mt-10 pt-8 border-t border-white/10 text-center space-y-3">
                {mode === 'forgot-password' ? (
                  <p className="text-slate-400 font-medium uppercase tracking-widest text-xs">
                    {t('login.modeToggle.rememberPassword', {}, 'Remember your password?')}
                    <button onClick={() => switchMode('signin')}
                      className="ml-2 text-white font-bold hover:text-neo-cyan transition-colors underline decoration-neo-cyan/50 decoration-2 underline-offset-4">
                      {t('login.mode.signin.cta', {}, 'Sign In')}
                    </button>
                  </p>
                ) : (
                  <p className="text-slate-400 font-medium uppercase tracking-widest text-xs">
                    {mode === 'signin'
                      ? t('login.modeToggle.noAccount', {}, "Don't have an account?")
                      : t('login.modeToggle.haveAccount', {}, 'Already have an account?')}
                    <button onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                      className="ml-2 text-white font-bold hover:text-neo-cyan transition-colors underline decoration-neo-cyan/50 decoration-2 underline-offset-4">
                      {mode === 'signin' ? t('login.mode.signup.cta', {}, 'Sign Up') : t('login.mode.signin.cta', {}, 'Sign In')}
                    </button>
                  </p>
                )}
              </div>

              {/* Terms */}
              <p className="mt-8 text-xs font-bold text-slate-600 text-center uppercase tracking-widest max-w-sm mx-auto leading-relaxed">
                {t('login.terms.prefix', {}, 'By continuing, you accept our')}{' '}
                <Link to="/terms" className="text-slate-400 hover:text-white transition-colors underline decoration-white/30 decoration-1 underline-offset-2">{t('login.terms.use', {}, 'Terms of Use')}</Link>{' '}
                {t('login.terms.middle', {}, 'and allow')}{' '}
                <Link to="/privacy" className="text-slate-400 hover:text-white transition-colors underline decoration-white/30 decoration-1 underline-offset-2">{t('login.terms.privacy', {}, 'Privacy Policy')}</Link>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;

