import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const SUPPORTED_METHODS = ['passkey', 'totp', 'recovery_code'];
const MAX_TIMER_SECONDS = 24 * 60 * 60;

const messages = defineMessages({
  passkeyLabel: {
    id: 'auth.mfaChallenge.method.passkey.label',
    defaultMessage: 'Passkey',
  },
  passkeyDescription: {
    id: 'auth.mfaChallenge.method.passkey.description',
    defaultMessage: 'Use your device unlock, security key, or saved passkey.',
  },
  passkeyAction: {
    id: 'auth.mfaChallenge.method.passkey.action',
    defaultMessage: 'Continue with passkey',
  },
  passkeyPending: {
    id: 'auth.mfaChallenge.method.passkey.pending',
    defaultMessage: 'Waiting for passkey...',
  },
  totpLabel: {
    id: 'auth.mfaChallenge.method.totp.label',
    defaultMessage: 'Authenticator app',
  },
  totpDescription: {
    id: 'auth.mfaChallenge.method.totp.description',
    defaultMessage: 'Enter the current 6-digit code from your authenticator app.',
  },
  totpAction: {
    id: 'auth.mfaChallenge.method.totp.action',
    defaultMessage: 'Verify code',
  },
  totpPending: {
    id: 'auth.mfaChallenge.method.totp.pending',
    defaultMessage: 'Verifying code...',
  },
  recoveryLabel: {
    id: 'auth.mfaChallenge.method.recovery.label',
    defaultMessage: 'Recovery code',
  },
  recoveryDescription: {
    id: 'auth.mfaChallenge.method.recovery.description',
    defaultMessage: 'Use one unused recovery code. Each code works only once.',
  },
  recoveryAction: {
    id: 'auth.mfaChallenge.method.recovery.action',
    defaultMessage: 'Verify recovery code',
  },
  recoveryPending: {
    id: 'auth.mfaChallenge.method.recovery.pending',
    defaultMessage: 'Checking recovery code...',
  },
  errorRateLimitPaused: {
    id: 'auth.mfaChallenge.error.rateLimitPaused',
    defaultMessage: 'Too many verification attempts. Verification is temporarily paused.',
  },
  errorRateLimitWait: {
    id: 'auth.mfaChallenge.error.rateLimitWait',
    defaultMessage: 'Too many attempts. Wait a moment, then try again.',
  },
  errorPasskeyCancelled: {
    id: 'auth.mfaChallenge.error.passkeyCancelled',
    defaultMessage: 'The passkey prompt was cancelled or timed out. Try again or use another method.',
  },
  errorRejected: {
    id: 'auth.mfaChallenge.error.rejected',
    defaultMessage: 'That verification was not accepted or has expired. Check it and try again.',
  },
  errorGeneric: {
    id: 'auth.mfaChallenge.error.generic',
    defaultMessage: 'We could not complete verification. Try again or choose another method.',
  },
  errorExpired: {
    id: 'auth.mfaChallenge.error.expired',
    defaultMessage: 'This verification request has expired. Sign out and start again.',
  },
  errorUnavailableRequest: {
    id: 'auth.mfaChallenge.error.unavailableRequest',
    defaultMessage: 'This verification request is no longer available. Sign out and try again.',
  },
  errorUnavailableMethod: {
    id: 'auth.mfaChallenge.error.unavailableMethod',
    defaultMessage: 'This verification method is temporarily unavailable. Try another method.',
  },
  errorSessionIncomplete: {
    id: 'auth.mfaChallenge.error.sessionIncomplete',
    defaultMessage: 'Verification returned, but the authenticated session could not be confirmed. Sign out and sign in again.',
  },
  errorInvalidTotp: {
    id: 'auth.mfaChallenge.error.invalidTotp',
    defaultMessage: 'Enter the 6-digit code from your authenticator app.',
  },
  errorInvalidRecovery: {
    id: 'auth.mfaChallenge.error.invalidRecovery',
    defaultMessage: 'Enter one unused recovery code.',
  },
  errorSignOut: {
    id: 'auth.mfaChallenge.error.signOut',
    defaultMessage: 'We could not sign you out. Try again.',
  },
  countdownMinute: {
    id: 'auth.mfaChallenge.countdown.minute',
    defaultMessage: '{count, plural, one {# minute} other {# minutes}}',
  },
  countdownSecond: {
    id: 'auth.mfaChallenge.countdown.second',
    defaultMessage: '{count, plural, one {# second} other {# seconds}}',
  },
  actionLogin: {
    id: 'auth.mfaChallenge.action.login',
    defaultMessage: 'Finish secure sign-in.',
  },
  actionAccount: {
    id: 'auth.mfaChallenge.action.account',
    defaultMessage: 'Continue with a protected account security action.',
  },
  actionPayment: {
    id: 'auth.mfaChallenge.action.payment',
    defaultMessage: 'Continue with a protected payment action.',
  },
  actionAdmin: {
    id: 'auth.mfaChallenge.action.admin',
    defaultMessage: 'Continue with a protected admin action.',
  },
  actionGeneric: {
    id: 'auth.mfaChallenge.action.generic',
    defaultMessage: 'Continue with a protected action.',
  },
  reasonUnusual: {
    id: 'auth.mfaChallenge.reason.unusual',
    defaultMessage: 'This sign-in needs extra verification because it appears unusual.',
  },
  reasonAdmin: {
    id: 'auth.mfaChallenge.reason.admin',
    defaultMessage: 'Your admin security policy requires stronger verification.',
  },
  reasonSeller: {
    id: 'auth.mfaChallenge.reason.seller',
    defaultMessage: 'Your seller security policy requires stronger verification.',
  },
  reasonSensitive: {
    id: 'auth.mfaChallenge.reason.sensitive',
    defaultMessage: 'This sensitive action requires fresh verification.',
  },
  reasonMfa: {
    id: 'auth.mfaChallenge.reason.mfa',
    defaultMessage: 'Multi-factor authentication is enabled for this account.',
  },
  reasonPolicy: {
    id: 'auth.mfaChallenge.reason.policy',
    defaultMessage: 'Your security policy requires additional verification.',
  },
  strengthPasskey: {
    id: 'auth.mfaChallenge.strength.passkey',
    defaultMessage: 'Passkey verification required.',
  },
  strengthTotp: {
    id: 'auth.mfaChallenge.strength.totp',
    defaultMessage: 'Authenticator app verification required.',
  },
  strengthRecovery: {
    id: 'auth.mfaChallenge.strength.recovery',
    defaultMessage: 'Recovery code verification required.',
  },
  retryIn: {
    id: 'auth.mfaChallenge.retry.in',
    defaultMessage: 'Try again in {countdown}',
  },
  publicEyebrow: {
    id: 'auth.mfaChallenge.public.eyebrow',
    defaultMessage: 'Secure sign-in',
  },
  adminEyebrow: {
    id: 'auth.mfaChallenge.admin.eyebrow',
    defaultMessage: 'Admin security checkpoint',
  },
  publicTitle: {
    id: 'auth.mfaChallenge.public.title',
    defaultMessage: "Confirm it's you",
  },
  adminTitle: {
    id: 'auth.mfaChallenge.admin.title',
    defaultMessage: 'Admin verification required',
  },
  publicDescription: {
    id: 'auth.mfaChallenge.public.description',
    defaultMessage: 'Complete one verification method to continue securely.',
  },
  adminDescription: {
    id: 'auth.mfaChallenge.admin.description',
    defaultMessage: 'Complete an approved verification method before continuing to this admin area.',
  },
  contextLabel: {
    id: 'auth.mfaChallenge.context.label',
    defaultMessage: 'Verification context',
  },
  requestedAction: {
    id: 'auth.mfaChallenge.context.requestedAction',
    defaultMessage: 'Requested action',
  },
  requestExpired: {
    id: 'auth.mfaChallenge.status.requestExpired',
    defaultMessage: 'Verification request expired.',
  },
  expiresIn: {
    id: 'auth.mfaChallenge.status.expiresIn',
    defaultMessage: 'Verification expires in {countdown}.',
  },
  shortLived: {
    id: 'auth.mfaChallenge.status.shortLived',
    defaultMessage: 'This verification request is short-lived.',
  },
  complete: {
    id: 'auth.mfaChallenge.status.complete',
    defaultMessage: 'Verification complete. Finishing your session...',
  },
  noMethod: {
    id: 'auth.mfaChallenge.error.noMethod',
    defaultMessage: 'No supported verification method is available for this checkpoint. Sign out and try again.',
  },
  noAdminMethod: {
    id: 'auth.mfaChallenge.error.noAdminMethod',
    defaultMessage: 'No approved admin verification method is enrolled. Admin access remains locked. Sign out and ask the account owner or security operator to restore a passkey or MFA method.',
  },
  totpInputLabel: {
    id: 'auth.mfaChallenge.input.totpLabel',
    defaultMessage: '6-digit authenticator code',
  },
  recoveryInputLabel: {
    id: 'auth.mfaChallenge.input.recoveryLabel',
    defaultMessage: 'Recovery code',
  },
  retryDisabled: {
    id: 'auth.mfaChallenge.retry.disabled',
    defaultMessage: 'Verification is disabled for {countdown}.',
  },
  retryReady: {
    id: 'auth.mfaChallenge.retry.ready',
    defaultMessage: 'You can try verification again now.',
  },
  tryAnotherWay: {
    id: 'auth.mfaChallenge.alternative.toggle',
    defaultMessage: 'Try another way',
  },
  useMethod: {
    id: 'auth.mfaChallenge.alternative.useMethod',
    defaultMessage: 'Use {method}',
  },
  leaveAdmin: {
    id: 'auth.mfaChallenge.cancel.admin',
    defaultMessage: 'Sign out and leave admin',
  },
  returnStorefront: {
    id: 'auth.mfaChallenge.cancel.public',
    defaultMessage: 'Sign out and return to storefront',
  },
  signingOut: {
    id: 'auth.mfaChallenge.signOut.pending',
    defaultMessage: 'Signing out...',
  },
  signOut: {
    id: 'auth.mfaChallenge.signOut.action',
    defaultMessage: 'Sign out',
  },
});

const METHOD_MESSAGES = {
  passkey: {
    label: messages.passkeyLabel,
    description: messages.passkeyDescription,
    action: messages.passkeyAction,
    pending: messages.passkeyPending,
  },
  totp: {
    label: messages.totpLabel,
    description: messages.totpDescription,
    action: messages.totpAction,
    pending: messages.totpPending,
  },
  recovery_code: {
    label: messages.recoveryLabel,
    description: messages.recoveryDescription,
    action: messages.recoveryAction,
    pending: messages.recoveryPending,
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

const buildVerificationError = (error, method, intl) => {
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
        ? intl.formatMessage(messages.errorRateLimitPaused)
        : intl.formatMessage(messages.errorRateLimitWait),
      retryAfterSeconds,
    };
  }
  if (method === 'passkey' && ['AbortError', 'NotAllowedError'].includes(errorName)) {
    return {
      message: intl.formatMessage(messages.errorPasskeyCancelled),
      retryAfterSeconds: 0,
    };
  }
  if ([400, 401, 403].includes(status)) {
    return {
      message: intl.formatMessage(messages.errorRejected),
      retryAfterSeconds: 0,
    };
  }
  return {
    message: intl.formatMessage(messages.errorGeneric),
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

const formatCountdown = (seconds, intl) => {
  const safeSeconds = Math.max(Math.ceil(Number(seconds) || 0), 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  const parts = [];
  if (minutes) parts.push(intl.formatMessage(messages.countdownMinute, { count: minutes }));
  if (remainingSeconds || !minutes) {
    parts.push(intl.formatMessage(messages.countdownSecond, { count: remainingSeconds }));
  }
  return parts.join(' ');
};

const describeAction = (challenge, isAdmin, intl) => {
  const purpose = String(challenge?.purpose || '').trim().toLowerCase();
  const action = String(challenge?.action || '').trim().toLowerCase().slice(0, 120);
  if (purpose === 'login' || /(?:^|[_-])(login|sign[_-]?in)(?:$|[_-])/.test(action)) {
    return intl.formatMessage(messages.actionLogin);
  }
  if (/account|profile|password|security|mfa|recovery/.test(action)) {
    return intl.formatMessage(messages.actionAccount);
  }
  if (/payment|checkout|payout|refund|wallet/.test(action)) {
    return intl.formatMessage(messages.actionPayment);
  }
  if (isAdmin && /admin|production|role|permission|catalog|backup|restore/.test(action)) {
    return intl.formatMessage(messages.actionAdmin);
  }
  return intl.formatMessage(messages.actionGeneric);
};

const describeReason = (challenge, policy, isAdmin, intl) => {
  const reason = String(challenge?.reason || policy?.reason || '').trim().toLowerCase();
  if (/suspicious|risk|unusual/.test(reason)) {
    return intl.formatMessage(messages.reasonUnusual);
  }
  if (isAdmin && /admin/.test(reason)) {
    return intl.formatMessage(messages.reasonAdmin);
  }
  if (/seller/.test(reason)) {
    return intl.formatMessage(messages.reasonSeller);
  }
  if (/dangerous|sensitive|fresh|step[_-]?up/.test(reason)) {
    return intl.formatMessage(messages.reasonSensitive);
  }
  if (/user|enabled|mfa/.test(reason)) {
    return intl.formatMessage(messages.reasonMfa);
  }
  return intl.formatMessage(messages.reasonPolicy);
};

const describeRequiredStrength = (challenge, intl) => {
  const strength = String(
    challenge?.requiredStrength || challenge?.requiredAssurance || ''
  ).trim().toLowerCase();
  if (/passkey|webauthn/.test(strength)) return intl.formatMessage(messages.strengthPasskey);
  if (/totp|authenticator/.test(strength)) return intl.formatMessage(messages.strengthTotp);
  if (/recovery/.test(strength)) return intl.formatMessage(messages.strengthRecovery);
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
  blocked = false,
}) => {
  const intl = useIntl();
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
    ? intl.formatMessage(messages.errorExpired)
    : errorMessage;
  const verificationDisabled = Boolean(
    isBusy
    || retryAfterSeconds > 0
    || challengeExpired
    || completionFailed
    || completed
  );
  const methodCopy = METHOD_MESSAGES[selectedMethod];
  const methodLabel = methodCopy ? intl.formatMessage(methodCopy.label) : '';
  const methodDescription = methodCopy ? intl.formatMessage(methodCopy.description) : '';
  const methodAction = methodCopy ? intl.formatMessage(methodCopy.action) : '';
  const methodPending = methodCopy ? intl.formatMessage(methodCopy.pending) : '';
  const alternativeMethods = offeredMethods.filter((method) => method !== selectedMethod);
  const actionDescription = describeAction(challenge, isAdmin, intl);
  const reasonDescription = describeReason(challenge, policy, isAdmin, intl);
  const requiredStrengthDescription = describeRequiredStrength(challenge, intl);
  const retryButtonLabel = retryAfterSeconds > 0
    ? intl.formatMessage(messages.retryIn, {
      countdown: formatCountdown(retryAfterSeconds, intl),
    })
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
      setErrorMessage(intl.formatMessage(messages.errorUnavailableRequest));
      return;
    }

    const verifier = method === 'passkey'
      ? onVerifyPasskey
      : method === 'totp'
        ? onVerifyTotp
        : onVerifyRecoveryCode;
    if (typeof verifier !== 'function') {
      setErrorMessage(intl.formatMessage(messages.errorUnavailableMethod));
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
        const responseError = new Error('MFA_VERIFICATION_FAILED');
        responseError.status = response?.status;
        responseError.data = response;
        throw responseError;
      }
      if (!hasCompleteSessionPayload(response)) {
        setCompletionFailed(true);
        setErrorMessage(intl.formatMessage(messages.errorSessionIncomplete));
        return;
      }
      setCompleted(true);
    } catch (error) {
      const feedback = buildVerificationError(error, method, intl);
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
        setErrorMessage(intl.formatMessage(messages.errorInvalidTotp));
        return;
      }
      verify('totp', normalizedCode);
      return;
    }

    const normalizedCode = recoveryCode.trim();
    if (!normalizedCode) {
      setErrorMessage(intl.formatMessage(messages.errorInvalidRecovery));
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
      setErrorMessage(intl.formatMessage(messages.errorSignOut));
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
          {intl.formatMessage(isAdmin ? messages.adminEyebrow : messages.publicEyebrow)}
        </p>
        <h1
          ref={headingRef}
          id={`${panelId}-title`}
          tabIndex={-1}
          className="mt-3 text-2xl font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          {intl.formatMessage(isAdmin ? messages.adminTitle : messages.publicTitle)}
        </h1>
        <p id={`${panelId}-description`} className="mt-3 text-sm leading-6 text-slate-300">
          {intl.formatMessage(isAdmin ? messages.adminDescription : messages.publicDescription)}
        </p>

        <div
          className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300"
          aria-label={intl.formatMessage(messages.contextLabel)}
        >
          <p className="font-bold text-white">{intl.formatMessage(messages.requestedAction)}</p>
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
                ? intl.formatMessage(messages.requestExpired)
                : intl.formatMessage(messages.expiresIn, {
                  countdown: formatCountdown(expiryRemainingSeconds, intl),
                })}
            </p>
          ) : !blocked ? (
            <p className="mt-2 text-slate-400">{intl.formatMessage(messages.shortLived)}</p>
          ) : null}
        </div>

        {completed ? (
          <p className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100" role="status" aria-live="polite">
            {intl.formatMessage(messages.complete)}
          </p>
        ) : completionFailed ? null : offeredMethods.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100" role="alert">
            {intl.formatMessage(isAdmin && blocked ? messages.noAdminMethod : messages.noMethod)}
          </p>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="font-bold text-white">{methodLabel}</p>
              <p className="mt-1 text-sm leading-5 text-slate-400">{methodDescription}</p>
            </div>

            {selectedMethod === 'passkey' ? (
              <button
                ref={passkeyButtonRef}
                type="button"
                onClick={() => verify('passkey')}
                disabled={verificationDisabled}
                className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {retryButtonLabel || (pendingAction === 'passkey'
                  ? intl.formatMessage(messages.passkeyPending)
                  : intl.formatMessage(messages.passkeyAction))}
              </button>
            ) : (
              <form className="mt-5" onSubmit={submitCode} aria-busy={isBusy}>
                <label htmlFor={`${panelId}-code`} className="block text-sm font-bold text-white">
                  {intl.formatMessage(
                    selectedMethod === 'totp' ? messages.totpInputLabel : messages.recoveryInputLabel
                  )}
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
                  {retryButtonLabel || (pendingAction === selectedMethod ? methodPending : methodAction)}
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
              ? intl.formatMessage(messages.retryDisabled, {
                countdown: formatCountdown(retryAfterSeconds, intl),
              })
              : intl.formatMessage(messages.retryReady)}
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
              {intl.formatMessage(messages.tryAnotherWay)}
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
                  {intl.formatMessage(messages.useMethod, {
                    method: intl.formatMessage(METHOD_MESSAGES[method].label),
                  })}
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
              {intl.formatMessage(isAdmin ? messages.leaveAdmin : messages.returnStorefront)}
            </button>
          ) : null}
          {typeof onSignOut === 'function' ? (
            <button
              type="button"
              onClick={signOut}
              disabled={isBusy}
              className="rounded-full border border-rose-300/20 px-4 py-2 text-sm font-bold text-rose-200 hover:bg-rose-300/10 disabled:opacity-60"
            >
              {intl.formatMessage(
                pendingAction === 'sign_out' ? messages.signingOut : messages.signOut
              )}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
};

export default MfaChallengePanel;
