import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, KeyRound, Laptop, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../../context/AuthContext';
import {
  getTrustedDeviceSupportProfile,
  resetTrustedDeviceIdentity,
  signTrustedDeviceChallenge,
} from '../../../services/deviceTrustClient';

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

const buildTrustedDeviceErrorMessage = ({
  error,
  browserKeyOffered,
  passkeyOffered,
  supportProfile,
}) => {
  const fallbackHost = supportProfile.runtimeHost || 'this host';
  if (passkeyOffered && browserKeyOffered && isWebAuthnHostMismatchError(error)) {
    return supportProfile.webauthnHostEligible
      ? 'Passkey verification could not be completed here. Aura can fall back to this browser\'s trusted-device key on the next retry.'
      : `Passkeys are not available on ${fallbackHost}, so Aura uses a browser-held trusted-device key on this host instead.`;
  }

  return String(error?.message || 'Trusted device verification failed.');
};

const AuraTrustedDeviceChallenge = () => {
  const { currentUser, deviceChallenge, refreshSession, status, verifyDeviceChallenge } = useAuth();
  const [isWorking, setIsWorking] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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
  const supported = canUsePasskey || canUseBrowserKey;
  const hostUsesBrowserKeyOnly = !passkeyOffered && browserKeyOffered && !supportProfile.webauthnHostEligible;
  const fallbackHost = supportProfile.runtimeHost || 'this host';
  const primaryMethodLabel = passkeyOffered ? 'Passkey / WebAuthn' : 'RSA-PSS browser key';
  const actionLabel = passkeyOffered
    ? (challengeMode === 'enroll' ? 'Register Passkey' : 'Verify Passkey')
    : (challengeMode === 'enroll' ? 'Register Browser' : 'Verify Browser');

  if (status !== 'device_challenge_required' || !deviceChallenge || import.meta.env.MODE === 'test') {
    return null;
  }

  const handleVerify = async () => {
    if (!supported) {
      setErrorMessage(
        passkeyOffered
          ? 'This browser cannot complete passkey verification here. Use a secure browser with WebAuthn support or a device that already has this passkey.'
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
      const signedChallenge = await signTrustedDeviceChallenge(deviceChallenge);
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
        error,
        browserKeyOffered,
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
          className="relative w-full max-w-lg overflow-hidden rounded-[2rem] border border-cyan-400/15 bg-zinc-950/95 p-8 shadow-[0_20px_120px_rgba(6,182,212,0.14)]"
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
                {passkeyOffered
                  ? (challengeMode === 'enroll' ? 'Register this device' : 'Verify this device')
                  : (challengeMode === 'enroll' ? 'Register this browser' : 'Prove this browser')}
              </h2>
              <p className="max-w-xl text-sm leading-6 text-slate-300">
                {challengeMode === 'enroll'
                  ? (passkeyOffered
                    ? 'This checkpoint now prefers a real passkey. Your authenticator creates a WebAuthn credential tied to this account, with browser-key fallback only when needed.'
                    : (
                      hostUsesBrowserKeyOnly
                        ? `This host is using the browser-held trusted-device key path. Passkeys stay reserved for localhost or verified domains that match the relying-party configuration.`
                        : 'This flow creates a real browser-held signing key and binds it to your account for privileged access.'
                    ))
                  : (passkeyOffered
                    ? 'Privileged access now requires a fresh passkey assertion from the authenticator already registered to this account.'
                    : 'Privileged access now requires a fresh signature from the trusted browser key already registered to this account.')}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="flex items-center gap-3">
                  <KeyRound className="h-4 w-4 text-cyan-200" />
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Proof</p>
                    <p className="mt-1 text-sm font-semibold text-white">{primaryMethodLabel}</p>
                  </div>
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
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
              <p>
                {passkeyOffered
                  ? 'Your authenticator completes a short-lived WebAuthn challenge locally. The server verifies that passkey assertion and then issues a session-bound trusted-device token for this Firebase session.'
                  : (
                    hostUsesBrowserKeyOnly
                      ? `On ${fallbackHost}, the browser signs a short-lived challenge locally with its trusted-device key. The server verifies that proof and then issues a session-bound device token for this Firebase session.`
                      : 'The browser signs a short-lived challenge locally. The server verifies that proof against your registered public key and then issues a session-bound device token for this Firebase session.'
                  )}
              </p>
            </div>

            {!supported ? (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
                {passkeyOffered
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
                disabled={isWorking || isResetting || !supported}
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
