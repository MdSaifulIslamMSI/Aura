import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, KeyRound, Laptop, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../../context/AuthContext';
import {
  getTrustedDeviceSupportProfile,
  resetTrustedDeviceIdentity,
  signTrustedDeviceChallenge,
} from '../../../services/deviceTrustClient';

const TRUSTED_DEVICE_METHOD_ORDER = ['webauthn', 'browser_key'];

const normalizeTrustedDeviceMethod = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return TRUSTED_DEVICE_METHOD_ORDER.includes(normalized)
    ? normalized
    : '';
};

const isWebAuthnHostMismatchError = (error) => {
  const errorName = String(error?.name || '');
  const errorMessage = String(error?.message || '').toLowerCase();
  return errorName === 'SecurityError'
    || errorMessage.includes('securityerror')
    || errorMessage.includes('relying party id')
    || errorMessage.includes('registrable domain suffix')
    || errorMessage.includes('.well-known/webauthn')
    || errorMessage.includes('claimed rp id')
    || errorMessage.includes('webauthn resource');
};

const getTrustedDeviceMethodLabel = (method) => (
  method === 'webauthn'
    ? 'Passkey / WebAuthn'
    : 'RSA-PSS browser key'
);

const getTrustedDeviceHeading = ({ method, challengeMode }) => {
  if (challengeMode === 'enroll') {
    return method === 'webauthn'
      ? 'Register this device'
      : 'Register this browser';
  }

  return method === 'webauthn'
    ? 'Verify this device'
    : 'Prove this browser';
};

const getTrustedDeviceActionLabel = ({ method, challengeMode }) => {
  if (method === 'webauthn') {
    return challengeMode === 'enroll'
      ? 'Register Passkey'
      : 'Verify Passkey';
  }

  return challengeMode === 'enroll'
    ? 'Register Browser'
    : 'Verify Browser';
};

const getTrustedDeviceIntro = ({
  activeMethod,
  browserKeyOffered,
  challengeMode,
  fallbackHost,
  hostUsesBrowserKeyOnly,
  passkeyOffered,
}) => {
  if (passkeyOffered && browserKeyOffered) {
    return challengeMode === 'enroll'
      ? 'Choose which trusted-device proof to register on this device. Aura can bind either a real passkey or this browser\'s RSA-PSS key so the checkpoint stays explicit.'
      : 'Choose which trusted-device proof to present. Aura keeps the passkey and RSA-PSS browser-key paths separate so you can see exactly which proof is being used.';
  }

  if (activeMethod === 'webauthn') {
    return challengeMode === 'enroll'
      ? 'This checkpoint now prefers a real passkey. Your authenticator creates a WebAuthn credential tied to this account.'
      : 'Privileged access now requires a fresh passkey assertion from the authenticator already registered to this account.';
  }

  if (hostUsesBrowserKeyOnly) {
    return challengeMode === 'enroll'
      ? `This host is using the browser-held trusted-device key path. Passkeys stay reserved for localhost or verified domains that match the relying-party configuration.`
      : `This checkpoint is using the browser-held trusted-device key path on ${fallbackHost}.`;
  }

  return challengeMode === 'enroll'
    ? 'This flow creates a real browser-held signing key and binds it to your account for privileged access.'
    : 'Privileged access now requires a fresh signature from the trusted browser key already registered to this account.';
};

const getTrustedDeviceMethodNote = ({
  challengeMode,
  fallbackHost,
  hostUsesBrowserKeyOnly,
  method,
  offered,
  registeredMethod,
  supported,
}) => {
  if (supported) {
    if (method === 'webauthn') {
      return challengeMode === 'enroll'
        ? 'Register an authenticator-backed passkey for this device.'
        : 'Use the registered passkey already tied to this device.';
    }

    return challengeMode === 'enroll'
      ? 'Register a local RSA-PSS key stored inside this browser.'
      : 'Use the RSA-PSS key already registered inside this browser.';
  }

  if (offered) {
    return method === 'webauthn'
      ? 'This browser does not expose the WebAuthn APIs needed for the passkey flow here.'
      : 'This browser does not expose the WebCrypto or IndexedDB support needed for the browser-key flow.';
  }

  if (method === 'webauthn') {
    if (challengeMode === 'assert' && registeredMethod === 'browser_key') {
      return 'This device is currently registered with an RSA-PSS browser key, not a passkey.';
    }

    return hostUsesBrowserKeyOnly
      ? `Passkeys are only offered on localhost or a verified domain, so ${fallbackHost} stays on browser-key proof.`
      : 'Passkey proof is not offered for this checkpoint.';
  }

  if (challengeMode === 'assert' && registeredMethod === 'webauthn') {
    return 'This device is currently registered with a passkey, so browser-key proof is not offered here.';
  }

  return 'Browser-key proof is not offered for this checkpoint.';
};

const getTrustedDeviceMethodBadge = ({
  offered,
  preferred,
  selected,
  supported,
}) => {
  if (selected) return 'Selected';
  if (preferred && offered) return 'Recommended';
  if (supported) return 'Ready';
  if (offered) return 'Unsupported';
  return 'Unavailable';
};

const getTrustedDeviceMethodDetail = ({
  fallbackHost,
  hostUsesBrowserKeyOnly,
  method,
}) => {
  if (method === 'webauthn') {
    return 'Your authenticator completes a short-lived WebAuthn challenge locally. The server verifies that passkey assertion and then issues a session-bound trusted-device token for this Firebase session.';
  }

  return hostUsesBrowserKeyOnly
    ? `On ${fallbackHost}, the browser signs a short-lived challenge locally with its trusted-device key. The server verifies that proof and then issues a session-bound device token for this Firebase session.`
    : 'The browser signs a short-lived challenge locally. The server verifies that proof against your registered public key and then issues a session-bound device token for this Firebase session.';
};

const buildTrustedDeviceErrorMessage = ({
  attemptedMethod,
  browserKeyOffered,
  error,
  passkeyOffered,
  supportProfile,
}) => {
  const fallbackHost = supportProfile.runtimeHost || 'this host';
  if (attemptedMethod === 'webauthn' && passkeyOffered && browserKeyOffered && isWebAuthnHostMismatchError(error)) {
    return supportProfile.webauthnHostEligible
      ? 'Passkey verification could not be completed here. Choose the RSA-PSS browser key option or retry on a device that already has the passkey.'
      : `Passkeys are not available on ${fallbackHost}. Choose the RSA-PSS browser key option on this host instead.`;
  }

  return String(error?.message || 'Trusted device verification failed.');
};

const AuraTrustedDeviceChallenge = () => {
  const { currentUser, deviceChallenge, refreshSession, status, verifyDeviceChallenge } = useAuth();
  const [isWorking, setIsWorking] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('');

  const challengeMode = String(deviceChallenge?.mode || '').trim() === 'enroll'
    ? 'enroll'
    : 'assert';
  const supportProfile = useMemo(() => getTrustedDeviceSupportProfile(), []);
  const availableMethods = useMemo(() => (
    Array.isArray(deviceChallenge?.availableMethods)
      ? deviceChallenge.availableMethods
        .map((method) => String(method || '').trim().toLowerCase())
        .filter(Boolean)
      : []
  ), [deviceChallenge?.availableMethods]);
  const passkeyOffered = availableMethods.includes('webauthn');
  const browserKeyOffered = availableMethods.includes('browser_key');
  const canUsePasskey = supportProfile.webauthn && passkeyOffered;
  const canUseBrowserKey = supportProfile.browserKeyFallback && browserKeyOffered;
  const hostUsesBrowserKeyOnly = !passkeyOffered && browserKeyOffered && !supportProfile.webauthnHostEligible;
  const fallbackHost = supportProfile.runtimeHost || 'this host';
  const preferredMethod = normalizeTrustedDeviceMethod(deviceChallenge?.preferredMethod);
  const registeredMethod = normalizeTrustedDeviceMethod(deviceChallenge?.registeredMethod);

  const defaultSelectedMethod = useMemo(() => {
    const offeredMethods = TRUSTED_DEVICE_METHOD_ORDER.filter((method) => availableMethods.includes(method));
    const supportedMethods = offeredMethods.filter((method) => (
      method === 'webauthn'
        ? canUsePasskey
        : canUseBrowserKey
    ));

    if (preferredMethod && supportedMethods.includes(preferredMethod)) {
      return preferredMethod;
    }

    if (supportedMethods.length) {
      return supportedMethods[0];
    }

    if (preferredMethod && offeredMethods.includes(preferredMethod)) {
      return preferredMethod;
    }

    if (offeredMethods.length) {
      return offeredMethods[0];
    }

    return canUsePasskey ? 'webauthn' : 'browser_key';
  }, [
    availableMethods,
    canUseBrowserKey,
    canUsePasskey,
    preferredMethod,
  ]);

  useEffect(() => {
    setSelectedMethod(defaultSelectedMethod);
  }, [defaultSelectedMethod, deviceChallenge?.token]);

  if (status !== 'device_challenge_required' || !deviceChallenge || import.meta.env.MODE === 'test') {
    return null;
  }

  const activeMethod = normalizeTrustedDeviceMethod(selectedMethod) || defaultSelectedMethod;
  const selectedMethodSupported = activeMethod === 'webauthn'
    ? canUsePasskey
    : canUseBrowserKey;
  const heading = getTrustedDeviceHeading({ method: activeMethod, challengeMode });
  const actionLabel = getTrustedDeviceActionLabel({ method: activeMethod, challengeMode });

  const handleVerify = async () => {
    if (!selectedMethodSupported) {
      setErrorMessage(
        activeMethod === 'webauthn'
          ? 'This browser cannot complete passkey verification here. Use a secure browser with WebAuthn support, or choose the RSA-PSS browser key option.'
          : (
            hostUsesBrowserKeyOnly
              ? `This host uses browser-key verification because passkeys need localhost or a verified domain. Retry on ${fallbackHost} only after enabling WebCrypto and IndexedDB support.`
              : 'This browser cannot complete trusted device verification. Use HTTPS or localhost with WebCrypto and IndexedDB enabled.'
          )
      );
      return;
    }

    setIsWorking(true);
    setErrorMessage('');

    try {
      const signedChallenge = await signTrustedDeviceChallenge(deviceChallenge, {
        preferredMethod: activeMethod,
      });
      const response = await verifyDeviceChallenge(deviceChallenge.token, signedChallenge);

      if (!response?.success) {
        throw new Error(response?.message || 'Trusted device verification failed.');
      }

      toast.success(
        signedChallenge?.method === 'webauthn'
          ? (challengeMode === 'enroll' ? 'Trusted passkey registered.' : 'Trusted passkey verified.')
          : (challengeMode === 'enroll' ? 'Trusted browser registered.' : 'Trusted browser verified.')
      );
    } catch (error) {
      const nextMessage = buildTrustedDeviceErrorMessage({
        attemptedMethod: activeMethod,
        browserKeyOffered,
        error,
        passkeyOffered,
        supportProfile,
      });
      setErrorMessage(nextMessage);
      toast.error(nextMessage);
    } finally {
      setIsWorking(false);
    }
  };

  const handleResetBrowserIdentity = async () => {
    setIsResetting(true);
    setErrorMessage('');

    try {
      await resetTrustedDeviceIdentity();
      if (currentUser) {
        await refreshSession(currentUser, { force: true, silent: true });
      }
      toast.success('Local device identity reset. You can register this device again.');
    } catch (error) {
      const nextMessage = String(error?.message || 'Unable to reset this browser identity.');
      setErrorMessage(nextMessage);
      toast.error(nextMessage);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/88 px-4 backdrop-blur-xl"
      >
        <motion.div
          initial={{ scale: 0.96, y: 16 }}
          animate={{ scale: 1, y: 0 }}
          className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-cyan-400/15 bg-zinc-950/95 p-8 shadow-[0_20px_120px_rgba(6,182,212,0.14)]"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />
          <div className="absolute -top-24 right-0 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />

          <div className="relative space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Trusted Device Gate
            </div>

            <div className="space-y-3">
              <h2 className="text-3xl font-black tracking-tight text-white">
                {heading}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                {getTrustedDeviceIntro({
                  activeMethod,
                  browserKeyOffered,
                  challengeMode,
                  fallbackHost,
                  hostUsesBrowserKeyOnly,
                  passkeyOffered,
                })}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Proof Method</p>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {passkeyOffered && browserKeyOffered ? 'Choose one' : 'Checkpoint state'}
                </p>
              </div>

              <div
                role="radiogroup"
                aria-label="Trusted device proof methods"
                className="grid gap-3 sm:grid-cols-2"
              >
                {TRUSTED_DEVICE_METHOD_ORDER.map((method) => {
                  const offered = availableMethods.includes(method);
                  const supported = method === 'webauthn'
                    ? canUsePasskey
                    : canUseBrowserKey;
                  const selected = activeMethod === method;
                  const preferred = preferredMethod === method;
                  const MethodIcon = method === 'webauthn' ? ShieldCheck : KeyRound;
                  const badge = getTrustedDeviceMethodBadge({
                    offered,
                    preferred,
                    selected,
                    supported,
                  });

                  return (
                    <button
                      key={method}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={getTrustedDeviceMethodLabel(method)}
                      disabled={!supported}
                      onClick={() => {
                        setSelectedMethod(method);
                        setErrorMessage('');
                      }}
                      className={[
                        'rounded-2xl border p-4 text-left transition-colors',
                        selected
                          ? 'border-cyan-300/60 bg-cyan-400/10'
                          : 'border-white/8 bg-white/[0.03]',
                        !supported ? 'cursor-not-allowed opacity-75' : 'hover:border-cyan-300/40 hover:bg-white/[0.05]',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <MethodIcon className={selected ? 'h-4 w-4 text-cyan-200' : 'h-4 w-4 text-slate-300'} />
                          <div>
                            <p className="text-sm font-semibold text-white">{getTrustedDeviceMethodLabel(method)}</p>
                            <p className={`mt-1 text-[11px] font-black uppercase tracking-[0.18em] ${selected ? 'text-cyan-100' : 'text-slate-400'}`}>
                              {badge}
                            </p>
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-slate-400">
                        {getTrustedDeviceMethodNote({
                          challengeMode,
                          fallbackHost,
                          hostUsesBrowserKeyOnly,
                          method,
                          offered,
                          registeredMethod,
                          supported,
                        })}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-3">
                <Laptop className="h-4 w-4 text-cyan-200" />
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Device</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {deviceChallenge?.registeredLabel || 'This browser session'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
              <p>
                {getTrustedDeviceMethodDetail({
                  fallbackHost,
                  hostUsesBrowserKeyOnly,
                  method: activeMethod,
                })}
              </p>
            </div>

            {!selectedMethodSupported ? (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
                {activeMethod === 'webauthn'
                  ? 'This device does not expose the passkey APIs needed for this challenge here. Use a secure browser with passkey support, or switch to a device that already has the registered passkey.'
                  : (
                    hostUsesBrowserKeyOnly
                      ? `This host stays on browser-key verification because passkeys are only offered on localhost or verified domains.`
                      : 'This browser cannot complete trusted device verification here. Use HTTPS or localhost with WebCrypto and IndexedDB enabled.'
                  )}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm leading-6 text-rose-100">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{errorMessage}</p>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleVerify}
                disabled={isWorking || isResetting || !selectedMethodSupported}
                className="inline-flex flex-1 items-center justify-center gap-3 rounded-2xl bg-cyan-300 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-slate-950 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {actionLabel}
              </button>

              <button
                type="button"
                onClick={handleResetBrowserIdentity}
                disabled={isWorking || isResetting}
                className="inline-flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-slate-100 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Reset Local Identity
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AuraTrustedDeviceChallenge;
