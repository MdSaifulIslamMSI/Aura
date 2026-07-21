import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../../../context/AuthContext';
import { useStableIcuMessages } from '../../../i18n/useStableIcuMessages';
import {
  getTrustedDeviceSupportProfile,
  resetTrustedDeviceIdentity,
  signTrustedDeviceChallenge,
} from '../../../services/deviceTrustClient';

const METHOD_ORDER = ['webauthn', 'browser_key'];
const PASSWORD_REAUTH_REQUIRED_CODE = 'auth/password-reauth-required';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const normalizeMethod = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return METHOD_ORDER.includes(normalized) ? normalized : '';
};

const getFocusableElements = (container) => Array.from(
  container?.querySelectorAll(FOCUSABLE_SELECTOR) || []
).filter((element) => (
  element
  && !element.hasAttribute('hidden')
  && element.getAttribute('aria-hidden') !== 'true'
  && element.tabIndex >= 0
));

const hasFreshSensitiveActionAuth = (sessionIntelligence) => {
  const session = sessionIntelligence?.posture?.session || {};
  const assurance = sessionIntelligence?.assurance || {};
  return Boolean(
    session.freshForSensitiveActions
    || session.stepUpActive
    || assurance.stepUpFresh
    || assurance.webAuthnStepUpFresh
    || assurance.freshWebAuthnStepUp
  );
};

const isPasswordReauthRequiredError = (error) => (
  error?.requiresPasswordReauth === true
  || String(error?.code || '') === PASSWORD_REAUTH_REQUIRED_CODE
);

const getMethodLabel = (method, supportProfile) => (
  method === 'webauthn'
    ? (supportProfile.biometricPasskeyLabel || 'Device passkey')
    : 'This browser'
);

const getMethodDescription = (method, mode) => {
  if (method === 'webauthn') {
    return mode === 'enroll'
      ? 'Use Face ID, Touch ID, Windows Hello, or your device PIN. Biometric data never leaves your device.'
      : 'Approve with the passkey already registered to this account.';
  }

  return mode === 'enroll'
    ? 'Create a local browser key for device recognition. This is not an admin passkey.'
    : 'Use the recognition key already stored in this browser.';
};

const getMethodAction = (method, mode) => {
  if (method === 'webauthn') {
    return mode === 'enroll' ? 'Register device passkey' : 'Continue with device passkey';
  }
  return mode === 'enroll' ? 'Register this browser' : 'Confirm this browser';
};

const isMethodSupported = (method, supportProfile) => (
  method === 'webauthn'
    ? Boolean(supportProfile.webauthn && supportProfile.webauthnHostEligible)
    : Boolean(supportProfile.browserKeyFallback)
);

const buildErrorMessage = (error) => {
  const name = String(error?.name || '').toLowerCase();
  if (name === 'notallowederror') {
    return 'Verification was cancelled or timed out. Nothing changed; try again when you are ready.';
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You appear to be offline. Reconnect and try this device check again.';
  }
  return String(error?.message || 'This device could not be confirmed. Try again or choose another method.');
};

const AuraTrustedDeviceChallenge = ({
  disabled = false,
  onExit = null,
  challengeOverride = null,
  onVerifyChallenge = null,
  onVerified = null,
}) => {
  const navigate = useNavigate();
  const t = useStableIcuMessages();
  const {
    currentUser,
    deviceChallenge,
    logout,
    reauthenticateForSensitiveAction,
    refreshSession,
    resetBrowserSession,
    sessionIntelligence,
    status,
    verifyDeviceChallenge,
  } = useAuth();
  const supportProfile = useMemo(() => getTrustedDeviceSupportProfile(), []);
  const dialogRef = useRef(null);
  const primaryActionRef = useRef(null);
  const methodRefs = useRef({});
  const verifyInFlightRef = useRef(false);
  const [selectedMethod, setSelectedMethod] = useState('');
  const [showMethods, setShowMethods] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [failedAttemptCount, setFailedAttemptCount] = useState(0);
  const [requiresPasswordReauth, setRequiresPasswordReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');

  const activeDeviceChallenge = challengeOverride || deviceChallenge;
  const controlledChallenge = Boolean(challengeOverride);
  const challengeMode = activeDeviceChallenge?.mode === 'enroll' ? 'enroll' : 'assert';
  const audience = activeDeviceChallenge?.audience === 'admin' ? 'admin' : 'public';
  const requiredAssurance = String(activeDeviceChallenge?.requiredAssurance || 'device_proof');
  const isAdminCheckpoint = audience === 'admin';
  const requiresAdminPasskey = requiredAssurance === 'admin_passkey';
  const offeredMethods = useMemo(() => {
    const methods = Array.isArray(activeDeviceChallenge?.availableMethods)
      ? activeDeviceChallenge.availableMethods.map(normalizeMethod).filter(Boolean)
      : [];
    return requiresAdminPasskey ? methods.filter((method) => method === 'webauthn') : methods;
  }, [activeDeviceChallenge?.availableMethods, requiresAdminPasskey]);
  const supportedMethods = offeredMethods.filter((method) => isMethodSupported(method, supportProfile));
  const preferredMethod = normalizeMethod(activeDeviceChallenge?.preferredMethod);
  const defaultMethod = supportedMethods.includes(preferredMethod)
    ? preferredMethod
    : (supportedMethods[0] || offeredMethods[0] || '');
  const activeMethod = normalizeMethod(selectedMethod) || defaultMethod;
  const selectedMethodSupported = supportedMethods.includes(activeMethod);
  const shouldRender = !disabled
    && (controlledChallenge || status === 'device_challenge_required')
    && Boolean(activeDeviceChallenge)
    && import.meta.env.MODE !== 'test';
  const shouldRequireExplicitReauth = !controlledChallenge
    && activeDeviceChallenge?.requiresRecentAuth === true
    && challengeMode === 'enroll'
    && !hasFreshSensitiveActionAuth(sessionIntelligence)
    && typeof reauthenticateForSensitiveAction === 'function';

  useEffect(() => {
    setSelectedMethod(defaultMethod);
    setShowMethods(offeredMethods.length > 1 && !defaultMethod);
    setErrorMessage('');
    setFailedAttemptCount(0);
    setRequiresPasswordReauth(false);
    setReauthPassword('');
  }, [defaultMethod, activeDeviceChallenge?.token, offeredMethods.length]);

  useEffect(() => {
    if (!shouldRender || typeof document === 'undefined') return undefined;
    const previouslyFocused = document.activeElement;
    document.body.classList.add('aura-trusted-gate-open');

    const frame = window.requestAnimationFrame(() => {
      primaryActionRef.current?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (!dialogRef.current?.contains(active) || active === first)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (!dialogRef.current?.contains(active) || active === last)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('aura-trusted-gate-open');
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus?.({ preventScroll: true });
      }
    };
  }, [activeDeviceChallenge?.token, shouldRender]);

  if (!shouldRender) return null;

  const selectMethod = (method) => {
    if (!supportedMethods.includes(method)) return;
    setSelectedMethod(method);
    setErrorMessage('');
    window.requestAnimationFrame(() => methodRefs.current[method]?.focus({ preventScroll: true }));
  };

  const handleMethodKeyDown = (event, method) => {
    const currentIndex = Math.max(supportedMethods.indexOf(method), 0);
    let nextMethod = '';
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextMethod = supportedMethods[(currentIndex + 1) % supportedMethods.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextMethod = supportedMethods[(currentIndex - 1 + supportedMethods.length) % supportedMethods.length];
    }
    if (nextMethod) {
      event.preventDefault();
      selectMethod(nextMethod);
    }
  };

  const handleVerify = async () => {
    if (verifyInFlightRef.current) return;
    if (!selectedMethodSupported) {
      setErrorMessage('This device cannot use the required verification method. Choose another supported device or browser.');
      return;
    }
    if (requiresPasswordReauth && !reauthPassword) {
      setErrorMessage('Enter your password before retrying this device check.');
      return;
    }

    verifyInFlightRef.current = true;
    setIsWorking(true);
    setErrorMessage('');
    try {
      if (shouldRequireExplicitReauth || requiresPasswordReauth) {
        await reauthenticateForSensitiveAction(
          reauthPassword ? { password: reauthPassword } : undefined
        );
        setRequiresPasswordReauth(false);
        setReauthPassword('');
      }

      const signedChallenge = await signTrustedDeviceChallenge(activeDeviceChallenge, {
        preferredMethod: activeMethod,
      });
      if (controlledChallenge && typeof onVerifyChallenge !== 'function') {
        throw new Error('This device verification checkpoint is unavailable. Start a fresh sign-in and try again.');
      }
      const response = controlledChallenge
        ? await onVerifyChallenge(activeDeviceChallenge.token, signedChallenge)
        : await verifyDeviceChallenge(activeDeviceChallenge.token, signedChallenge);
      if (!response?.success) {
        throw new Error(response?.message || 'This device could not be confirmed.');
      }

      if (controlledChallenge && typeof onVerified === 'function') {
        await onVerified(response);
      }

      setFailedAttemptCount(0);
      toast.success(
        response?.status === 'mfa_challenge_required'
          ? 'Device confirmed. Complete the extra security check.'
          : 'Device confirmed.'
      );
    } catch (error) {
      setFailedAttemptCount((count) => count + 1);
      if (isPasswordReauthRequiredError(error)) {
        setRequiresPasswordReauth(true);
      }
      const message = buildErrorMessage(error);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      verifyInFlightRef.current = false;
      setIsWorking(false);
    }
  };

  const handleResetIdentity = async () => {
    setIsResetting(true);
    setErrorMessage('');
    try {
      await resetTrustedDeviceIdentity();
      if (currentUser) {
        await refreshSession(currentUser, { force: true, silent: true });
      }
      toast.success(t('auth.trustedDevice.feedback.browserIdentityReset', {}, 'Browser identity reset. Start the device check again.'));
    } catch (error) {
      const message = buildErrorMessage(error);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsResetting(false);
    }
  };

  const handleExit = async () => {
    if (typeof onExit === 'function') {
      await onExit();
      return;
    }
    await logout?.();
    navigate('/', { replace: true });
  };

  const handleResetSession = async () => {
    setIsResetting(true);
    setErrorMessage('');
    try {
      await resetBrowserSession?.({ reason: 'trusted-device-challenge' });
      setFailedAttemptCount(0);
    } catch (error) {
      const message = buildErrorMessage(error);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsResetting(false);
    }
  };

  const heading = isAdminCheckpoint ? 'Admin security check' : 'Confirm this device';
  const description = isAdminCheckpoint
    ? (requiresAdminPasskey
      ? 'Admin access requires a fresh device passkey. Browser-only recognition cannot unlock admin controls.'
      : 'First confirm this device. Aura may ask for a separate admin passkey before opening admin controls.')
    : 'This quick check protects your account before Aura finishes signing you in.';

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trusted-device-heading"
      aria-describedby="trusted-device-description"
      aria-busy={isWorking || isResetting}
      className="trusted-device-gate trusted-device-gate--blocking fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/90 px-3 py-5 backdrop-blur-xl sm:px-6"
    >
      <section className="relative w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950 shadow-[0_32px_100px_rgba(0,0,0,0.6)]">
        <div className="h-1 bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400" />
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-300 text-slate-950">
              {isAdminCheckpoint ? <ShieldCheck className="h-5 w-5" /> : <Laptop className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
                {isAdminCheckpoint
                  ? t('auth.trustedDevice.eyebrow.admin', {}, 'Admin access')
                  : t('auth.trustedDevice.eyebrow.public', {}, 'Secure sign-in')}
              </p>
              <h2 id="trusted-device-heading" className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
                {heading}
              </h2>
              <p id="trusted-device-description" className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                {description}
              </p>
            </div>
          </div>

          <ol aria-label={t('auth.trustedDevice.progress.label', {}, 'Sign-in progress')} className="mt-6 grid gap-2 text-xs sm:grid-cols-3">
            <li className="flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/10 px-3 py-2.5 text-emerald-100">
              <Check className="h-4 w-4" /> {t('auth.trustedDevice.progress.accountVerified', {}, 'Account verified')}
            </li>
            <li aria-current="step" className="flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2.5 font-bold text-cyan-100">
              <Laptop className="h-4 w-4" /> {t('auth.trustedDevice.progress.confirmDevice', {}, 'Confirm device')}
            </li>
            <li className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-slate-400">
              <ShieldCheck className="h-4 w-4" /> {t('auth.trustedDevice.progress.extraCheck', {}, 'Extra check if needed')}
            </li>
          </ol>

          <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  {t('auth.trustedDevice.method.recommended', {}, 'Recommended')}
                </p>
                <p className="mt-1 font-semibold text-white">{getMethodLabel(activeMethod, supportProfile)}</p>
              </div>
              <KeyRound className="h-5 w-5 text-cyan-200" />
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {getMethodDescription(activeMethod, challengeMode)}
            </p>

            {offeredMethods.length > 1 ? (
              <button
                type="button"
                onClick={() => setShowMethods((value) => !value)}
                aria-expanded={showMethods}
                className="mt-3 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-cyan-200 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                {t('auth.trustedDevice.method.tryAnother', {}, 'Try another way')} <ChevronDown className={`h-4 w-4 transition-transform ${showMethods ? 'rotate-180' : ''}`} />
              </button>
            ) : null}

            {showMethods ? (
              <div role="radiogroup" aria-label={t('auth.trustedDevice.method.groupLabel', {}, 'Device verification methods')} className="mt-3 grid gap-2 sm:grid-cols-2">
                {offeredMethods.map((method) => {
                  const supported = supportedMethods.includes(method);
                  const selected = activeMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-describedby={`trusted-device-${method}-description`}
                      aria-label={getMethodLabel(method, supportProfile)}
                      ref={(node) => {
                        if (node) methodRefs.current[method] = node;
                      }}
                      disabled={!supported}
                      tabIndex={selected && supported ? 0 : -1}
                      onClick={() => selectMethod(method)}
                      onKeyDown={(event) => handleMethodKeyDown(event, method)}
                      className={`rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-300 ${selected ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-white/10 bg-slate-900'} ${supported ? 'hover:border-cyan-300/40' : 'cursor-not-allowed opacity-50'}`}
                    >
                      <span className="text-sm font-semibold text-white">{getMethodLabel(method, supportProfile)}</span>
                      <span id={`trusted-device-${method}-description`} className="mt-1 block text-xs leading-5 text-slate-400">
                        {getMethodDescription(method, challengeMode)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {requiresPasswordReauth ? (
            <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
              <label htmlFor="trusted-device-reauth-password" className="text-sm font-semibold text-cyan-50">
                {t('auth.trustedDevice.reauth.passwordLabel', {}, 'Account password')}
              </label>
              <input
                id="trusted-device-reauth-password"
                type="password"
                autoComplete="current-password"
                value={reauthPassword}
                onChange={(event) => setReauthPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-white outline-none focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30"
              />
            </div>
          ) : null}

          {!selectedMethodSupported ? (
            <div role="alert" className="mt-4 flex gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {t('auth.trustedDevice.method.unavailable', {}, 'The required method is not available in this browser. Use a supported browser or another device.')}
            </div>
          ) : null}

          {errorMessage ? (
            <div role="alert" aria-live="assertive" className="mt-4 flex gap-3 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm leading-6 text-rose-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr,auto]">
            <button
              ref={primaryActionRef}
              type="button"
              onClick={handleVerify}
              disabled={isWorking || isResetting || !selectedMethodSupported}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 outline-none transition-colors hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-100 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {isWorking
                ? t('auth.trustedDevice.confirming', {}, 'Confirming device…')
                : getMethodAction(activeMethod, challengeMode)}
            </button>
            <button
              type="button"
              onClick={handleExit}
              disabled={isWorking || isResetting}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-200 outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <LogOut className="h-4 w-4" /> {t('auth.trustedDevice.exit.anotherAccount', {}, 'Use another account')}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/8 pt-4 text-sm">
            <button
              type="button"
              onClick={handleResetIdentity}
              disabled={isWorking || isResetting}
              className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-slate-300 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <RefreshCw className={`h-4 w-4 ${isResetting ? 'animate-spin' : ''}`} /> {t('auth.trustedDevice.resetBrowser', {}, 'Reset this browser')}
            </button>
            {failedAttemptCount >= 2 && typeof resetBrowserSession === 'function' ? (
              <button
                type="button"
                onClick={handleResetSession}
                disabled={isWorking || isResetting}
                className="rounded-lg px-1 py-1 font-semibold text-rose-200 outline-none hover:text-rose-100 focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                {t('auth.trustedDevice.resetBrowserSession', {}, 'Reset browser session')}
              </button>
            ) : null}
            <span className="text-xs text-slate-500">
              {t('auth.trustedDevice.proofBindingNote', {}, 'Device proof is short-lived and bound to this sign-in.')}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AuraTrustedDeviceChallenge;
