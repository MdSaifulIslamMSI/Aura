import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Laptop,
  Loader2,
  Minimize2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../../../context/AuthContext';
import {
  getTrustedDeviceSupportProfile,
  resetTrustedDeviceIdentity,
  signTrustedDeviceChallenge,
} from '../../../services/deviceTrustClient';
import { isAdminPath } from '../../../services/assistantUiConfig';

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

const getBiometricPasskeyLabel = (supportProfile = {}) => (
  supportProfile.biometricPasskeyLabel || 'Face ID / Windows Hello passkey'
);

const getTrustedDeviceMethodLabel = (method, supportProfile = {}) => (
  method === 'webauthn'
    ? getBiometricPasskeyLabel(supportProfile)
    : 'RSA-PSS browser key'
);

const getTrustedDeviceHeading = ({ method, challengeMode, supportProfile }) => {
  if (challengeMode === 'enroll') {
    return method === 'webauthn'
      ? `Register ${getBiometricPasskeyLabel(supportProfile)}`
      : 'Register this browser';
  }

  return method === 'webauthn'
    ? `Verify with ${getBiometricPasskeyLabel(supportProfile)}`
    : 'Prove this browser';
};

const getTrustedDeviceActionLabel = ({ method, challengeMode, supportProfile }) => {
  if (method === 'webauthn') {
    return challengeMode === 'enroll'
      ? 'Register Face / Device Auth'
      : `Use ${getBiometricPasskeyLabel(supportProfile)}`;
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
      ? 'Choose which trusted-device proof to register on this device. The biometric passkey path uses Face ID, Touch ID, Windows Hello, or the device unlock locally while Aura only receives a signed WebAuthn proof.'
      : 'Choose which trusted-device proof to present. The biometric passkey path uses the device authenticator locally; Aura keeps it separate from the RSA-PSS browser-key fallback.';
  }

  if (activeMethod === 'webauthn') {
    return challengeMode === 'enroll'
      ? 'This checkpoint now prefers face or device-unlock authentication through a platform passkey. The authenticator creates a WebAuthn credential tied to this account.'
      : 'Privileged access now requires a fresh face or device-unlock passkey assertion from the authenticator already registered to this account.';
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
        ? 'Register a platform passkey unlocked by Face ID, Touch ID, Windows Hello, biometrics, or device PIN. Aura never receives face data.'
        : 'Use the registered platform passkey already tied to this device. Biometric/PIN verification stays inside the authenticator.';
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
    return 'Your platform authenticator completes a short-lived WebAuthn challenge locally after Face ID, Touch ID, Windows Hello, biometrics, or device PIN verification. The server verifies only the signed assertion and then issues a session-bound trusted-device token for this Firebase session.';
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
  const location = useLocation();
  const { currentUser, deviceChallenge, refreshSession, status, verifyDeviceChallenge } = useAuth();
  const [isWorking, setIsWorking] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showMethodChooser, setShowMethodChooser] = useState(false);

  const challengeMode = String(deviceChallenge?.mode || '').trim() === 'enroll'
    ? 'enroll'
    : 'assert';
  const isBlockingRoute = isAdminPath(location?.pathname || '/');
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

  useEffect(() => {
    setIsCollapsed(!isBlockingRoute);
    setShowMethodChooser(isBlockingRoute);
  }, [deviceChallenge?.token, isBlockingRoute]);

  const shouldRenderTrustedGate = status === 'device_challenge_required'
    && Boolean(deviceChallenge)
    && import.meta.env.MODE !== 'test'
    && isBlockingRoute;

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    document.body.classList.toggle('aura-trusted-gate-open', shouldRenderTrustedGate);
    return () => {
      document.body.classList.remove('aura-trusted-gate-open');
    };
  }, [shouldRenderTrustedGate]);

  if (!shouldRenderTrustedGate) {
    return null;
  }

  const activeMethod = normalizeTrustedDeviceMethod(selectedMethod) || defaultSelectedMethod;
  const selectedMethodSupported = activeMethod === 'webauthn'
    ? canUsePasskey
    : canUseBrowserKey;
  const heading = isBlockingRoute
    ? getTrustedDeviceHeading({ method: activeMethod, challengeMode, supportProfile })
    : (challengeMode === 'enroll' ? 'Finish trusted device setup' : 'Privileged mode locked');
  const actionLabel = getTrustedDeviceActionLabel({ method: activeMethod, challengeMode, supportProfile });
  const selectedMethodLabel = getTrustedDeviceMethodLabel(activeMethod, supportProfile);
  const selectedMethodNote = getTrustedDeviceMethodNote({
    challengeMode,
    fallbackHost,
    hostUsesBrowserKeyOnly,
    method: activeMethod,
    offered: availableMethods.includes(activeMethod),
    registeredMethod,
    supported: selectedMethodSupported,
  });
  const selectedMethodDetail = getTrustedDeviceMethodDetail({
    fallbackHost,
    hostUsesBrowserKeyOnly,
    method: activeMethod,
  });
  const showProofOptions = isBlockingRoute || showMethodChooser;
  const checkpointReason = challengeMode === 'enroll'
    ? 'Set up this device once so admin-grade actions can trust a fresh proof tied to this session.'
    : 'This session is valid, but elevated actions need a fresh device proof before Aura unlocks them.';
  const privacyHighlights = activeMethod === 'webauthn'
    ? [
      'Face, fingerprint, or Windows Hello stays inside the authenticator.',
      'Aura receives only a signed WebAuthn assertion for this challenge.',
      'The elevated session token is short-lived and bound to this Firebase session.',
    ]
    : [
      'The browser signs the challenge locally with its stored RSA-PSS key.',
      'Aura verifies the signature against the registered public key only.',
      'The elevated session token is short-lived and bound to this Firebase session.',
    ];
  const publicRouteHighlights = challengeMode === 'enroll'
    ? 'Keep browsing normally while this device finishes its trust setup.'
    : 'Keep browsing normally and unlock admin, payout, and trust-sensitive actions when you need them.';
  const introMessage = isBlockingRoute
    ? getTrustedDeviceIntro({
      activeMethod,
      browserKeyOffered,
      challengeMode,
      fallbackHost,
      hostUsesBrowserKeyOnly,
      passkeyOffered,
    })
    : (
      challengeMode === 'enroll'
        ? 'You can keep browsing, but admin-grade actions stay locked until this device finishes trusted verification.'
        : 'You can keep browsing normally. Verify this device when you want to unlock admin and other privileged actions.'
    );

  if (!isBlockingRoute && isCollapsed) {
    return (
      <AnimatePresence>
        <motion.button
          key="trusted-device-minimized"
          type="button"
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.96 }}
          onClick={() => setIsCollapsed(false)}
          className="trusted-device-minimized aura-floating-utility aura-floating-utility--trust fixed bottom-4 right-4 z-[73] grid w-[min(21.5rem,calc(100vw-1.5rem))] grid-cols-[auto,1fr,auto] items-center gap-2.5 rounded-[1.15rem] border px-3 py-2.5 text-left backdrop-blur-xl sm:bottom-5 sm:right-5"
        >
          <span className="aura-floating-utility__icon inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] border">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="aura-floating-utility__copy min-w-0">
            <span className="aura-floating-utility__eyebrow block text-[11px] font-black uppercase tracking-[0.18em]">
              Trust Checkpoint
            </span>
            <span className="aura-floating-utility__title block truncate text-sm font-semibold">
              Verify once to unlock admin actions
            </span>
            <span className="aura-floating-utility__detail mt-0.5 block truncate text-xs">
              {selectedMethodLabel}
            </span>
          </span>
          <span className="trusted-device-minimized__action rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]">
            Open
          </span>
        </motion.button>
      </AnimatePresence>
    );
  }

  const handleVerify = async () => {
    if (!selectedMethodSupported) {
      setErrorMessage(
        activeMethod === 'webauthn'
          ? 'This browser cannot complete face/device passkey verification here. Use a secure browser with WebAuthn platform authenticator support, or choose the RSA-PSS browser key option.'
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
          ? (challengeMode === 'enroll' ? 'Face/device passkey registered.' : 'Face/device passkey verified.')
          : (challengeMode === 'enroll' ? 'Trusted browser registered.' : 'Trusted browser verified.')
      );

      if (currentUser) {
        await refreshSession(currentUser, { force: true, silent: true }).catch(() => null);
      }
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
        role="dialog"
        aria-modal={isBlockingRoute}
        aria-labelledby="trusted-device-gate-heading"
        className={
          isBlockingRoute
            ? 'trusted-device-gate trusted-device-gate--blocking fixed inset-0 z-[95] flex items-center justify-center px-3 py-3 backdrop-blur-xl sm:px-4 sm:py-5'
            : 'trusted-device-gate trusted-device-gate--inline fixed inset-x-0 bottom-5 z-[73] flex justify-center px-3'
        }
      >
        <motion.div
          initial={{ scale: 0.97, y: isBlockingRoute ? 16 : 22 }}
          animate={{ scale: 1, y: 0 }}
          className={
            isBlockingRoute
              ? 'trusted-device-panel trusted-device-panel--blocking relative w-full max-w-4xl overflow-hidden rounded-[1.45rem] border'
              : 'trusted-device-panel trusted-device-panel--inline relative w-full max-w-[44rem] overflow-hidden rounded-[2rem] border backdrop-blur-xl'
          }
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />
          <div className="absolute -top-24 right-[-3rem] h-64 w-64 rounded-full bg-cyan-400/12 blur-3xl" />
          <div className="absolute -bottom-20 left-[-2rem] h-56 w-56 rounded-full bg-fuchsia-500/10 blur-3xl" />

          {isBlockingRoute ? (
            <div className="relative grid gap-0 lg:grid-cols-[0.94fr,1.06fr]">
              <div className="trusted-device-panel__summary border-b border-white/8 p-5 sm:p-6 lg:border-b-0 lg:border-r">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Trusted Device Checkpoint
                  </div>

                  <div className="space-y-3">
                    <h2 id="trusted-device-gate-heading" className="max-w-lg text-2xl font-black tracking-tight text-white sm:text-3xl">
                      {heading}
                    </h2>
                    <p className="max-w-xl text-sm leading-6 text-slate-300">
                      {introMessage}
                    </p>
                  </div>

                  <div className="rounded-[1.15rem] border border-white/8 bg-white/[0.035] p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Why Aura paused here</p>
                    <p className="mt-2 text-sm leading-6 text-slate-200">
                      {checkpointReason}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-[0.95rem] border border-white/8 bg-slate-950/60 px-3 py-2.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Account</p>
                        <p className="mt-1 truncate text-sm font-semibold text-white">{currentUser?.email || 'Authenticated session'}</p>
                      </div>
                      <div className="rounded-[0.95rem] border border-white/8 bg-slate-950/60 px-3 py-2.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Device lane</p>
                        <p className="mt-1 truncate text-sm font-semibold text-white">{deviceChallenge?.registeredLabel || 'This browser session'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.15rem] border border-white/8 bg-slate-950/60 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">What stays private</p>
                    <div className="mt-3 grid gap-2">
                      {privacyHighlights.map((line) => (
                        <div key={line} className="flex items-start gap-2.5">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/12 text-cyan-200">
                            <ShieldCheck className="h-3 w-3" />
                          </span>
                          <p className="text-xs leading-5 text-slate-300">{line}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="trusted-device-panel__actions p-5 sm:p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Choose your proof lane</p>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                      {passkeyOffered && browserKeyOffered ? 'Fresh assertion required' : 'Checkpoint state'}
                    </p>
                  </div>

                  <div
                    role="radiogroup"
                    aria-label="Trusted device proof methods"
                    className="grid gap-2 sm:grid-cols-2"
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
                          aria-label={getTrustedDeviceMethodLabel(method, supportProfile)}
                          disabled={!supported}
                          onClick={() => {
                            setSelectedMethod(method);
                            setErrorMessage('');
                          }}
                          className={[
                            'rounded-[1.1rem] border p-3 text-left transition-colors',
                            selected
                              ? 'border-cyan-300/60 bg-cyan-400/10 shadow-[0_16px_60px_rgba(34,211,238,0.08)]'
                              : 'border-white/8 bg-white/[0.03]',
                            !supported ? 'cursor-not-allowed opacity-75' : 'hover:border-cyan-300/35 hover:bg-white/[0.05]',
                          ].join(' ')}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <span className={`inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] ${selected ? 'bg-cyan-300 text-slate-950' : 'bg-white/[0.06] text-slate-200'}`}>
                                <MethodIcon className="h-4 w-4" />
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-white">{getTrustedDeviceMethodLabel(method, supportProfile)}</p>
                                <p className={`mt-1 text-[10px] font-black uppercase tracking-[0.18em] ${selected ? 'text-cyan-100' : 'text-slate-400'}`}>
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

                  <div className="grid gap-3 lg:grid-cols-[0.82fr,1.18fr]">
                    <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] p-4">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] bg-white/[0.06] text-cyan-200">
                          <Laptop className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Device</p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            {deviceChallenge?.registeredLabel || 'This browser session'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Selected proof</p>
                      <p className="mt-2 text-sm font-semibold text-white">{selectedMethodLabel}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {selectedMethodDetail}
                      </p>
                    </div>
                  </div>

                  {!selectedMethodSupported ? (
                    <div className="rounded-[1.1rem] border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">
                      {activeMethod === 'webauthn'
                        ? 'This device does not expose the platform passkey APIs needed for face/device authentication here. Use a secure browser with passkey support, or switch to a device that already has the registered passkey.'
                        : (
                          hostUsesBrowserKeyOnly
                            ? 'This host stays on browser-key verification because passkeys are only offered on localhost or verified domains.'
                            : 'This browser cannot complete trusted device verification here. Use HTTPS or localhost with WebCrypto and IndexedDB enabled.'
                        )}
                    </div>
                  ) : null}

                  {errorMessage ? (
                    <div className="rounded-[1.1rem] border border-rose-300/20 bg-rose-300/10 p-3 text-sm leading-6 text-rose-100">
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
                      className="inline-flex flex-1 items-center justify-center gap-3 rounded-[1.1rem] bg-cyan-300 px-5 py-3.5 text-sm font-black uppercase tracking-[0.16em] text-slate-950 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      {actionLabel}
                    </button>

                    <button
                      type="button"
                      onClick={handleResetBrowserIdentity}
                      disabled={isWorking || isResetting}
                      className="inline-flex items-center justify-center gap-3 rounded-[1.1rem] border border-white/10 bg-white/[0.04] px-5 py-3.5 text-sm font-black uppercase tracking-[0.16em] text-slate-100 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Reset Local Identity
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative p-5 sm:p-6">
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Privileged Mode
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCollapsed(true)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200 transition-colors hover:bg-white/[0.08]"
                    aria-label="Minimize trusted device panel"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.12fr,0.88fr]">
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <h2 id="trusted-device-gate-heading" className="text-2xl font-black tracking-tight text-white sm:text-[2rem]">
                        {heading}
                      </h2>
                      <p className="text-sm leading-6 text-slate-300">
                        {introMessage}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Selected proof</p>
                        <p className="mt-2 text-sm font-semibold text-white">{selectedMethodLabel}</p>
                        <p className="mt-3 text-xs leading-5 text-slate-400">{selectedMethodNote}</p>
                      </div>

                      <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] text-cyan-200">
                            <Laptop className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Device</p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {deviceChallenge?.registeredLabel || 'This browser session'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Why this appears</p>
                      <p className="mt-3 text-sm leading-6 text-slate-300">
                        {publicRouteHighlights}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-[1.75rem] border border-white/8 bg-white/[0.04] p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/80">Quick unlock</p>
                    <p className="mt-3 text-base font-semibold text-white">
                      Unlock the stronger session only when you actually need it.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {checkpointReason}
                    </p>

                    <div className="mt-5 flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={handleVerify}
                        disabled={isWorking || isResetting || !selectedMethodSupported}
                        className="inline-flex w-full items-center justify-center gap-3 rounded-[1.5rem] bg-cyan-300 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-slate-950 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {actionLabel}
                      </button>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setShowMethodChooser((current) => !current)}
                          className="inline-flex items-center justify-center gap-3 rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-100 transition-colors hover:bg-white/[0.08]"
                        >
                          {showProofOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          {showProofOptions ? 'Hide Proof Options' : 'Choose Proof Method'}
                        </button>

                        <button
                          type="button"
                          onClick={handleResetBrowserIdentity}
                          disabled={isWorking || isResetting}
                          className="inline-flex items-center justify-center gap-3 rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-100 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Reset Identity
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {showProofOptions ? (
                  <div className="space-y-4 rounded-[1.75rem] border border-white/8 bg-slate-950/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Proof methods</p>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                        {passkeyOffered && browserKeyOffered ? 'Pick the smoothest lane' : 'Current checkpoint'}
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
                            aria-label={getTrustedDeviceMethodLabel(method, supportProfile)}
                            disabled={!supported}
                            onClick={() => {
                              setSelectedMethod(method);
                              setErrorMessage('');
                            }}
                            className={[
                              'rounded-[1.5rem] border p-4 text-left transition-colors',
                              selected
                                ? 'border-cyan-300/60 bg-cyan-400/10'
                                : 'border-white/8 bg-white/[0.03]',
                              !supported ? 'cursor-not-allowed opacity-75' : 'hover:border-cyan-300/35 hover:bg-white/[0.05]',
                            ].join(' ')}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${selected ? 'bg-cyan-300 text-slate-950' : 'bg-white/[0.06] text-slate-200'}`}>
                                  <MethodIcon className="h-4 w-4" />
                                </span>
                                <div>
                                  <p className="text-sm font-semibold text-white">{getTrustedDeviceMethodLabel(method, supportProfile)}</p>
                                  <p className={`mt-1 text-[11px] font-black uppercase tracking-[0.18em] ${selected ? 'text-cyan-100' : 'text-slate-400'}`}>
                                    {badge}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <p className="mt-4 text-xs leading-5 text-slate-400">
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

                    <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
                      <p>
                        {selectedMethodDetail}
                      </p>
                    </div>
                  </div>
                ) : null}

                {!selectedMethodSupported ? (
                  <div className="rounded-[1.5rem] border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
                    {activeMethod === 'webauthn'
                      ? 'This device does not expose the platform passkey APIs needed for face/device authentication here. Use a secure browser with passkey support, or switch to a device that already has the registered passkey.'
                      : (
                        hostUsesBrowserKeyOnly
                          ? 'This host stays on browser-key verification because passkeys are only offered on localhost or verified domains.'
                          : 'This browser cannot complete trusted device verification here. Use HTTPS or localhost with WebCrypto and IndexedDB enabled.'
                      )}
                  </div>
                ) : null}

                {errorMessage ? (
                  <div className="rounded-[1.5rem] border border-rose-300/20 bg-rose-300/10 p-4 text-sm leading-6 text-rose-100">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>{errorMessage}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AuraTrustedDeviceChallenge;
