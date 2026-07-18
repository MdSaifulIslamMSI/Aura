import { useEffect, useMemo, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import AuraTrustedDeviceChallenge from './AuraTrustedDeviceChallenge';
import MfaChallengePanel from './MfaChallengePanel';

const DEVICE_CHECKPOINT_STATUS = 'device_challenge_required';
const MFA_CHECKPOINT_STATUS = 'mfa_challenge_required';
const ADMIN_AUDIENCES = new Set(['admin', 'administrator', 'operator', 'privileged_admin']);

const messages = defineMessages({
  dialogLabel: {
    id: 'auth.checkpoint.dialog.label',
    defaultMessage: 'Authentication checkpoint',
  },
  exitError: {
    id: 'auth.checkpoint.exitError',
    defaultMessage: 'Aura could not finish signing out. Retry before leaving this checkpoint.',
  },
});

const normalizeContractValue = (value) => String(value || '').trim().toLowerCase();

const firstContractValue = (...values) => values.find((value) => (
  value !== undefined && value !== null && String(value).trim() !== ''
));

const getContractValue = (challenge, policy, field) => firstContractValue(
  challenge?.[field],
  challenge?.presentation?.[field],
  challenge?.checkpoint?.[field],
  challenge?.contract?.[field],
  policy?.[field],
  policy?.presentation?.[field],
  policy?.checkpoint?.[field],
  policy?.contract?.[field]
);

const isAdminSurfaceValue = (value) => (
  /(?:^|[_:/-])(admin|operator|production)(?:$|[_:/-])/.test(value)
);

export const resolveCheckpointPresentation = ({ challenge = null, policy = null } = {}) => {
  const audience = normalizeContractValue(getContractValue(challenge, policy, 'audience'));
  const surface = normalizeContractValue(getContractValue(challenge, policy, 'surface'));
  const purpose = normalizeContractValue(getContractValue(challenge, policy, 'purpose'));
  const action = normalizeContractValue(getContractValue(challenge, policy, 'action'));
  const requiredAssurance = normalizeContractValue(firstContractValue(
    getContractValue(challenge, policy, 'requiredAssurance'),
    getContractValue(challenge, policy, 'requiredStrength'),
    getContractValue(challenge, policy, 'credentialScope')
  ));
  const explicitAdminAudience = ADMIN_AUDIENCES.has(audience);
  const inferredAdminSurface = !audience && [surface, action].some(isAdminSurfaceValue);

  return {
    action,
    audience: audience || 'public',
    isAdmin: explicitAdminAudience || inferredAdminSurface,
    purpose,
    requiredAssurance,
    surface,
  };
};

const AuthCheckpointLayer = ({ disabled = false }) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const auth = useAuth();
  const dialogRef = useRef(null);
  const exitInFlightRef = useRef(false);
  const [safeExitPending, setSafeExitPending] = useState(false);
  const [safeExitError, setSafeExitError] = useState('');
  const isDeviceCheckpoint = auth?.status === DEVICE_CHECKPOINT_STATUS;
  const isMfaCheckpoint = auth?.status === MFA_CHECKPOINT_STATUS;
  const isActive = !disabled && (isDeviceCheckpoint || isMfaCheckpoint);
  const activeChallenge = isMfaCheckpoint ? auth?.mfaChallenge : auth?.deviceChallenge;
  const activePolicy = isMfaCheckpoint ? auth?.mfaPolicy : null;
  const presentation = useMemo(
    () => resolveCheckpointPresentation({ challenge: activeChallenge, policy: activePolicy }),
    [activeChallenge, activePolicy]
  );

  useEffect(() => {
    setSafeExitError('');
  }, [activeChallenge?.challengeId, activeChallenge?.token]);

  useEffect(() => {
    if (!isMfaCheckpoint || !isActive || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = 'hidden';

    const trapFocus = (event) => {
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const activeElementIsFocusable = focusable.includes(activeElement);

      if (!activeElementIsFocusable) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trapFocus);
      if (previouslyFocused && document.contains(previouslyFocused) && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [isActive, isMfaCheckpoint]);

  const safeExit = async () => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setSafeExitPending(true);
    setSafeExitError('');
    try {
      if (typeof auth?.logout !== 'function') {
        throw new Error('Safe checkpoint exit requires an authenticated logout handler.');
      }
      await auth.logout();
      navigate('/', { replace: true });
    } catch {
      setSafeExitError(intl.formatMessage(messages.exitError));
    } finally {
      exitInFlightRef.current = false;
      setSafeExitPending(false);
    }
  };

  if (!isActive) return null;

  if (isDeviceCheckpoint) {
    return (
      <>
        <AuraTrustedDeviceChallenge onExit={safeExit} />
        {safeExitError ? (
          <p className="fixed inset-x-3 bottom-4 z-[121] mx-auto max-w-lg rounded-2xl border border-rose-300/20 bg-rose-950/95 p-4 text-sm text-rose-100" role="alert" aria-live="assertive">
            {safeExitError}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={intl.formatMessage(messages.dialogLabel)}
      aria-busy={safeExitPending}
      data-checkpoint-audience={presentation.isAdmin ? 'admin' : 'public'}
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/90 px-3 py-4 backdrop-blur-xl sm:items-center sm:px-6 sm:py-8"
    >
      <div className="w-full max-w-3xl">
        <MfaChallengePanel
          challenge={auth?.mfaChallenge}
          policy={auth?.mfaPolicy}
          isAdmin={presentation.isAdmin}
          onVerifyTotp={auth?.verifyMfaTotpChallenge}
          onVerifyPasskey={auth?.verifyMfaPasskeyChallenge}
          onVerifyRecoveryCode={auth?.verifyMfaRecoveryCodeChallenge}
          onCancel={safeExit}
          blocked={Boolean(auth?.mfaBlocked)}
        />
        {safeExitError ? (
          <p className="mx-auto mt-3 max-w-lg rounded-2xl border border-rose-300/20 bg-rose-950/90 p-4 text-sm text-rose-100" role="alert" aria-live="assertive">
            {safeExitError}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default AuthCheckpointLayer;
