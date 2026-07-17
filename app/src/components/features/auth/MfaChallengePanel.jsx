import { useEffect, useId, useMemo, useRef, useState } from 'react';

const SUPPORTED_METHODS = ['passkey', 'totp', 'recovery_code'];
const MAX_TIMER_SECONDS = 24 * 60 * 60;

const METHOD_COPY = {
  passkey: {
    label: 'Passkey',
    description: 'Use your device unlock, security key, or saved passkey.',
    action: 'Continue with passkey',
    pending: 'Waiting for passkey...',
  },
  totp: {
    label: 'Authenticator app',
    description: 'Enter the current 6-digit code from your authenticator app.',
    action: 'Verify code',
    pending: 'Verifying code...',
  },
  recovery_code: {
    label: 'Recovery code',
    description: 'Use one unused recovery code. Each code works only once.',
    action: 'Verify recovery code',
    pending: 'Checking recovery code...',
  },
};

const normalizeMethods = (challenge, policy) => {
  const challengeMethods = Array.isArray(challenge?.allowedMethods) ? challenge.allowedMethods : [];
  const policyMethods = Array.isArray(policy?.allowedMethods) ? policy.allowedMethods : [];
  const offeredMethods = challengeMethods.length ? challengeMethods : policyMethods;

  return Array.from(new Set(
    offeredMethods
      .map((method) => String(method || '').trim().toLowerCase())
      .filter((method) => SUPPORTED_METHODS.includes(method))
  ));
};

const resolvePreferredMethod = (challenge, policy, offeredMethods) => {
  const preferredMethod = String(
    challenge?.preferredMethod || policy?.preferredMethod || ''
  ).trim().toLowerCase();

  return offeredMethods.includes(preferredMethod) ? preferredMethod : (offeredMethods[0] || '');
};

const normalizeTimerSeconds = (value) => {
  const seconds = Math.ceil(Number(value));
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(seconds, MAX_TIMER_SECONDS);
};

const buildVerificationError = (error, method) => {
  const status = Number(error?.status || error?.data?.status || 0);
  const retryAfterSeconds = normalizeTimerSeconds(
    error?.retryAfterSeconds
    ?? error?.data?.retryAfterSeconds
    ?? error?.data?.retryAfter
  );
  const errorName = String(error?.name || '');

  if (status === 429) {
    return {
      message: retryAfterSeconds > 0
        ? 'Too many verification attempts. Verification is temporarily paused.'
        : 'Too many attempts. Wait a moment, then try again.',
      retryAfterSeconds,
    };
  }
  if (method === 'passkey' && ['AbortError', 'NotAllowedError'].includes(errorName)) {
    return {
      message: 'The passkey prompt was cancelled or timed out. Try again or use another method.',
      retryAfterSeconds: 0,
    };
  }
  if ([400, 401, 403].includes(status)) {
    return {
      message: 'That verification was not accepted or has expired. Check it and try again.',
      retryAfterSeconds: 0,
    };
  }
  return {
    message: 'We could not complete verification. Try again or choose another method.',
    retryAfterSeconds: 0,
  };
};

const resolveExpiryDeadline = (expiresAtValue, expiresInValue, challengeId) => {
  if (!String(challengeId || '').trim()) return 0;
  const expiresAt = Date.parse(String(expiresAtValue || ''));
  if (Number.isFinite(expiresAt)) return expiresAt;

  if (expiresInValue === null || expiresInValue === undefined || String(expiresInValue).trim() === '') {
    return 0;
  }
  const rawExpiresIn = Number(expiresInValue);
  if (!Number.isFinite(rawExpiresIn) || rawExpiresIn < 0) return 0;
  return Date.now() + (normalizeTimerSeconds(rawExpiresIn) * 1000);
};

const formatCountdown = (seconds) => {
  const safeSeconds = Math.max(Math.ceil(Number(seconds) || 0), 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  const parts = [];
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (remainingSeconds || !minutes) {
    parts.push(`${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`);
  }
  return parts.join(' ');
};

const describeAction = (challenge, isAdmin) => {
  const purpose = String(challenge?.purpose || '').trim().toLowerCase();
  const action = String(challenge?.action || '').trim().toLowerCase().slice(0, 120);
  if (purpose === 'login' || /(?:^|[_-])(login|sign[_-]?in)(?:$|[_-])/.test(action)) {
    return 'Finish secure sign-in.';
  }
  if (/account|profile|password|security|mfa|recovery/.test(action)) {
    return 'Continue with a protected account security action.';
  }
  if (/payment|checkout|payout|refund|wallet/.test(action)) {
    return 'Continue with a protected payment action.';
  }
  if (isAdmin && /admin|production|role|permission|catalog|backup|restore/.test(action)) {
    return 'Continue with a protected admin action.';
  }
  return 'Continue with a protected action.';
};

const describeReason = (challenge, policy, isAdmin) => {
  const reason = String(challenge?.reason || policy?.reason || '').trim().toLowerCase();
  if (/suspicious|risk|unusual/.test(reason)) {
    return 'This sign-in needs extra verification because it appears unusual.';
  }
  if (isAdmin && /admin/.test(reason)) {
    return 'Your admin security policy requires stronger verification.';
  }
  if (/seller/.test(reason)) {
    return 'Your seller security policy requires stronger verification.';
  }
  if (/dangerous|sensitive|fresh|step[_-]?up/.test(reason)) {
    return 'This sensitive action requires fresh verification.';
  }
  if (/user|enabled|mfa/.test(reason)) {
    return 'Multi-factor authentication is enabled for this account.';
  }
  return 'Your security policy requires additional verification.';
};

const describeRequiredStrength = (challenge) => {
  const strength = String(challenge?.requiredStrength || '').trim().toLowerCase();
  if (/passkey|webauthn/.test(strength)) return 'Passkey verification required.';
  if (/totp|authenticator/.test(strength)) return 'Authenticator app verification required.';
  if (/recovery/.test(strength)) return 'Recovery code verification required.';
  return '';
};

const hasCompleteSessionPayload = (response) => Boolean(
  response?.success !== false
  && response?.session
  && response?.profile
  && response?.roles
);

const MfaChallengePanel = ({
  challenge = null,
  policy = null,
  isAdmin = false,
  onVerifyTotp,
  onVerifyPasskey,
  onVerifyRecoveryCode,
  onCancel,
  onSignOut,
}) => {
  const panelId = useId();
  const headingRef = useRef(null);
  const codeInputRef = useRef(null);
  const passkeyButtonRef = useRef(null);
  const errorRef = useRef(null);
  const retryDeadlineRef = useRef(0);
  const offeredMethods = useMemo(
    () => normalizeMethods(challenge, policy),
    [challenge, policy]
  );
  const offeredMethodsKey = offeredMethods.join('|');
  const preferredMethod = resolvePreferredMethod(challenge, policy, offeredMethods);
  const challengeId = String(challenge?.challengeId || '').trim();
  const purpose = String(challenge?.purpose || 'login').trim() || 'login';
  const action = String(challenge?.action || '').trim();
  const challengeExpiresAt = challenge?.expiresAt;
  const challengeExpiresIn = challenge?.expiresIn;
  const expiryDeadlineMs = useMemo(
    () => resolveExpiryDeadline(challengeExpiresAt, challengeExpiresIn, challengeId),
    [challengeId, challengeExpiresAt, challengeExpiresIn]
  );
  const [selectedMethod, setSelectedMethod] = useState(preferredMethod);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completionFailed, setCompletionFailed] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [retryCooldownObserved, setRetryCooldownObserved] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [focusSelectedMethod, setFocusSelectedMethod] = useState(false);
  const isBusy = Boolean(pendingAction);
  const expiryRemainingSeconds = expiryDeadlineMs > 0
    ? Math.max(Math.ceil((expiryDeadlineMs - clockMs) / 1000), 0)
    : null;
  const challengeExpired = expiryRemainingSeconds === 0 && expiryDeadlineMs > 0;
  const displayedErrorMessage = challengeExpired
    ? 'This verification request has expired. Sign out and start again.'
    : errorMessage;
  const verificationDisabled = Boolean(
    isBusy
    || retryAfterSeconds > 0
    || challengeExpired
    || completionFailed
    || completed
  );
  const methodCopy = METHOD_COPY[selectedMethod];
  const alternativeMethods = offeredMethods.filter((method) => method !== selectedMethod);
  const actionDescription = describeAction(challenge, isAdmin);
  const reasonDescription = describeReason(challenge, policy, isAdmin);
  const requiredStrengthDescription = describeRequiredStrength(challenge);
  const retryButtonLabel = retryAfterSeconds > 0
    ? `Try again in ${formatCountdown(retryAfterSeconds)}`
    : '';

  useEffect(() => {
    setSelectedMethod(preferredMethod);
    setTotpCode('');
    setRecoveryCode('');
    setPendingAction('');
    setErrorMessage('');
    setShowAlternatives(false);
    setCompleted(false);
    setCompletionFailed(false);
    setRetryAfterSeconds(0);
    setRetryCooldownObserved(false);
    retryDeadlineRef.current = 0;
    setClockMs(Date.now());
    headingRef.current?.focus({ preventScroll: true });
  }, [challengeId, expiryDeadlineMs, offeredMethodsKey, preferredMethod]);

  useEffect(() => {
    if (retryAfterSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setRetryAfterSeconds(Math.max(
        Math.ceil((retryDeadlineRef.current - Date.now()) / 1000),
        0
      ));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfterSeconds]);

  useEffect(() => {
    if (!expiryDeadlineMs || challengeExpired) return undefined;
    const timer = window.setTimeout(() => setClockMs(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [challengeExpired, clockMs, expiryDeadlineMs]);

  useEffect(() => {
    if (!focusSelectedMethod) return;
    const target = selectedMethod === 'passkey' ? passkeyButtonRef.current : codeInputRef.current;
    target?.focus({ preventScroll: true });
    setFocusSelectedMethod(false);
  }, [focusSelectedMethod, selectedMethod]);

  useEffect(() => {
    if (displayedErrorMessage) {
      errorRef.current?.focus({ preventScroll: true });
    }
  }, [displayedErrorMessage]);

  const selectMethod = (method) => {
    if (verificationDisabled) return;
    setSelectedMethod(method);
    setErrorMessage('');
    setRetryCooldownObserved(false);
    setShowAlternatives(false);
    setFocusSelectedMethod(true);
  };

  const verify = async (method, code = '') => {
    if (verificationDisabled) return;
    if (!challengeId) {
      setErrorMessage('This verification request is no longer available. Sign out and try again.');
      return;
    }

    const verifier = method === 'passkey'
      ? onVerifyPasskey
      : method === 'totp'
        ? onVerifyTotp
        : onVerifyRecoveryCode;
    if (typeof verifier !== 'function') {
      setErrorMessage('This verification method is temporarily unavailable. Try another method.');
      return;
    }

    setPendingAction(method);
    setErrorMessage('');
    setCompletionFailed(false);
    setRetryCooldownObserved(false);
    retryDeadlineRef.current = 0;
    try {
      const response = await verifier({
        challengeId,
        purpose,
        action,
        ...(code ? { code } : {}),
      });
      if (response?.success === false) {
        const responseError = new Error('Verification failed');
        responseError.status = response?.status;
        responseError.data = response;
        throw responseError;
      }
      if (!hasCompleteSessionPayload(response)) {
        setCompletionFailed(true);
        setErrorMessage('Verification returned, but the authenticated session could not be confirmed. Sign out and sign in again.');
        return;
      }
      setCompleted(true);
    } catch (error) {
      const feedback = buildVerificationError(error, method);
      setErrorMessage(feedback.message);
      retryDeadlineRef.current = feedback.retryAfterSeconds > 0
        ? Date.now() + (feedback.retryAfterSeconds * 1000)
        : 0;
      setRetryAfterSeconds(feedback.retryAfterSeconds);
      setRetryCooldownObserved(feedback.retryAfterSeconds > 0);
    } finally {
      setPendingAction('');
    }
  };

  const submitCode = (event) => {
    event.preventDefault();
    if (verificationDisabled) return;
    if (selectedMethod === 'totp') {
      const normalizedCode = totpCode.trim();
      if (!/^\d{6}$/.test(normalizedCode)) {
        setErrorMessage('Enter the 6-digit code from your authenticator app.');
        return;
      }
      verify('totp', normalizedCode);
      return;
    }

    const normalizedCode = recoveryCode.trim();
    if (!normalizedCode) {
      setErrorMessage('Enter one unused recovery code.');
      return;
    }
    verify('recovery_code', normalizedCode);
  };

  const signOut = async () => {
    if (typeof onSignOut !== 'function') return;
    setPendingAction('sign_out');
    setErrorMessage('');
    try {
      await onSignOut();
    } catch {
      setErrorMessage('We could not sign you out. Try again.');
    } finally {
      setPendingAction('');
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <section
        className="w-full max-w-lg rounded-3xl border border-cyan-300/15 bg-zinc-950/80 p-6 shadow-glass sm:p-8"
        aria-labelledby={`${panelId}-title`}
        aria-describedby={`${panelId}-description`}
        aria-busy={isBusy}
      >
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200">
          {isAdmin ? 'Admin security checkpoint' : 'Secure sign-in'}
        </p>
        <h1
          ref={headingRef}
          id={`${panelId}-title`}
          tabIndex={-1}
          className="mt-3 text-2xl font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          {isAdmin ? 'Admin verification required' : "Confirm it's you"}
        </h1>
        <p id={`${panelId}-description`} className="mt-3 text-sm leading-6 text-slate-300">
          {isAdmin
            ? 'Complete an approved verification method before continuing to this admin area.'
            : 'Complete one verification method to continue securely.'}
        </p>

        <div
          className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300"
          aria-label="Verification context"
        >
          <p className="font-bold text-white">Requested action</p>
          <p className="mt-1">{actionDescription}</p>
          <p className="mt-2 text-slate-400">{reasonDescription}</p>
          {requiredStrengthDescription ? (
            <p className="mt-2 font-semibold text-cyan-100">{requiredStrengthDescription}</p>
          ) : null}
          {expiryRemainingSeconds !== null ? (
            <p
              className="mt-2 text-slate-400"
              role="status"
              aria-live={expiryRemainingSeconds <= 60 ? 'polite' : 'off'}
              aria-atomic="true"
            >
              {challengeExpired
                ? 'Verification request expired.'
                : `Verification expires in ${formatCountdown(expiryRemainingSeconds)}.`}
            </p>
          ) : (
            <p className="mt-2 text-slate-400">This verification request is short-lived.</p>
          )}
        </div>

        {completed ? (
          <p className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100" role="status" aria-live="polite">
            Verification complete. Finishing your session...
          </p>
        ) : completionFailed ? null : offeredMethods.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100" role="alert">
            No supported verification method is available for this checkpoint. Sign out and try again.
          </p>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="font-bold text-white">{methodCopy?.label}</p>
              <p className="mt-1 text-sm leading-5 text-slate-400">{methodCopy?.description}</p>
            </div>

            {selectedMethod === 'passkey' ? (
              <button
                ref={passkeyButtonRef}
                type="button"
                onClick={() => verify('passkey')}
                disabled={verificationDisabled}
                className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {retryButtonLabel || (pendingAction === 'passkey' ? METHOD_COPY.passkey.pending : METHOD_COPY.passkey.action)}
              </button>
            ) : (
              <form className="mt-5" onSubmit={submitCode} aria-busy={isBusy}>
                <label htmlFor={`${panelId}-code`} className="block text-sm font-bold text-white">
                  {selectedMethod === 'totp' ? '6-digit authenticator code' : 'Recovery code'}
                </label>
                <input
                  ref={codeInputRef}
                  id={`${panelId}-code`}
                  type="text"
                  inputMode={selectedMethod === 'totp' ? 'numeric' : 'text'}
                  autoComplete={selectedMethod === 'totp' ? 'one-time-code' : 'off'}
                  maxLength={selectedMethod === 'totp' ? 6 : 128}
                  value={selectedMethod === 'totp' ? totpCode : recoveryCode}
                  onChange={(event) => {
                    if (selectedMethod === 'totp') setTotpCode(event.target.value);
                    else setRecoveryCode(event.target.value);
                  }}
                  disabled={verificationDisabled}
                  className="mt-2 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-base text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-300 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={verificationDisabled}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {retryButtonLabel || (pendingAction === selectedMethod ? methodCopy?.pending : methodCopy?.action)}
                </button>
              </form>
            )}
          </>
        )}

        {displayedErrorMessage ? (
          <p
            ref={errorRef}
            tabIndex={-1}
            className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            role="alert"
            aria-live="assertive"
          >
            {displayedErrorMessage}
          </p>
        ) : null}

        {retryCooldownObserved ? (
          <p className="mt-3 text-sm text-amber-100" role="status" aria-live="polite" aria-atomic="true">
            {retryAfterSeconds > 0
              ? `Verification is disabled for ${formatCountdown(retryAfterSeconds)}.`
              : 'You can try verification again now.'}
          </p>
        ) : null}

        {!completed && !completionFailed && alternativeMethods.length > 0 ? (
          <div className="mt-5 border-t border-white/10 pt-5">
            <button
              type="button"
              aria-expanded={showAlternatives}
              aria-controls={`${panelId}-alternatives`}
              onClick={() => setShowAlternatives((current) => !current)}
              disabled={verificationDisabled}
              className="text-sm font-bold text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 disabled:opacity-60"
            >
              Try another way
            </button>
            <div id={`${panelId}-alternatives`} hidden={!showAlternatives} className="mt-3 flex flex-wrap gap-2">
              {alternativeMethods.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => selectMethod(method)}
                  disabled={verificationDisabled}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Use {METHOD_COPY[method].label.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3 border-t border-white/10 pt-5">
          {typeof onCancel === 'function' ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isBusy}
              className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/[0.06] disabled:opacity-60"
            >
              {isAdmin ? 'Leave admin checkpoint' : 'Return to storefront'}
            </button>
          ) : null}
          {typeof onSignOut === 'function' ? (
            <button
              type="button"
              onClick={signOut}
              disabled={isBusy}
              className="rounded-full border border-rose-300/20 px-4 py-2 text-sm font-bold text-rose-200 hover:bg-rose-300/10 disabled:opacity-60"
            >
              {pendingAction === 'sign_out' ? 'Signing out...' : 'Sign out'}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
};

export default MfaChallengePanel;
