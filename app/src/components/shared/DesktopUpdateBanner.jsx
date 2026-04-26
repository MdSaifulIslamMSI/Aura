import { useEffect, useState } from 'react';
import { CheckCircle2, DownloadCloud, Loader2, RefreshCw, Rocket, X } from 'lucide-react';

const getDesktopBridge = () => (
  typeof window !== 'undefined' && window.auraDesktop?.isDesktop
    ? window.auraDesktop
    : null
);

const buildUpdateCopy = (state) => {
  switch (state.type) {
    case 'checking':
      return {
        tone: 'cyan',
        icon: Loader2,
        title: 'Checking for Aura updates',
        detail: 'The desktop app is quietly looking for the newest safe release.',
      };
    case 'available':
      return {
        tone: 'emerald',
        icon: DownloadCloud,
        title: state.version ? `Aura ${state.version} is downloading` : 'A new Aura update is downloading',
        detail: 'Keep working. Aura will let you restart as soon as the update is ready.',
      };
    case 'downloading':
      return {
        tone: 'emerald',
        icon: DownloadCloud,
        title: 'Downloading desktop update',
        detail: `${Math.max(0, Math.min(100, Math.round(state.percent || 0)))}% complete. The app stays usable while this runs.`,
      };
    case 'downloaded':
      return {
        tone: 'emerald',
        icon: Rocket,
        title: state.version ? `Aura ${state.version} is ready` : 'Aura update is ready',
        detail: 'Restart now to install it, or it will install automatically when you quit.',
      };
    case 'not-available':
      return {
        tone: 'slate',
        icon: CheckCircle2,
        title: 'Aura desktop is current',
        detail: state.version ? `You are already on ${state.version}.` : 'No update is needed right now.',
      };
    case 'error':
      return {
        tone: 'amber',
        icon: RefreshCw,
        title: 'Update check needs another try',
        detail: state.message || 'Aura could not reach the release channel. You can retry from here.',
      };
    default:
      return null;
  }
};

const toneClasses = {
  amber: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  cyan: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
  emerald: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
  slate: 'border-white/12 bg-white/[0.06] text-slate-100',
};

const DesktopUpdateBanner = () => {
  const [updateState, setUpdateState] = useState(null);
  const [dismissedType, setDismissedType] = useState('');
  const desktopBridge = getDesktopBridge();

  useEffect(() => {
    if (!desktopBridge?.onUpdateStatus) {
      return undefined;
    }

    return desktopBridge.onUpdateStatus((status) => {
      setDismissedType('');
      setUpdateState(status);
    });
  }, [desktopBridge]);

  if (!desktopBridge || !updateState || dismissedType === updateState.type) {
    return null;
  }

  const copy = buildUpdateCopy(updateState);
  if (!copy) {
    return null;
  }

  const Icon = copy.icon;
  const isChecking = updateState.type === 'checking';
  const isReady = updateState.type === 'downloaded';
  const isTransient = updateState.type === 'not-available';

  return (
    <div className="aura-update-banner aura-floating-utility aura-floating-utility--update fixed bottom-5 right-5 z-[74] w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.45rem] border p-4 text-white backdrop-blur-2xl">
      <div className="aura-update-banner__rule absolute inset-x-8 top-0 h-px" />
      <div className="flex items-start gap-4">
        <div className={`aura-floating-utility__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full border ${toneClasses[copy.tone]}`}>
          <Icon className={`h-5 w-5 ${isChecking ? 'animate-spin' : ''}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="aura-floating-utility__eyebrow text-[11px] font-black uppercase tracking-[0.22em]">Desktop update channel</p>
          <h2 className="aura-floating-utility__title mt-1 text-base font-black">{copy.title}</h2>
          <p className="aura-floating-utility__detail mt-1 text-sm leading-5">{copy.detail}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {isReady ? (
              <button
                type="button"
                onClick={() => desktopBridge.installUpdateNow?.()}
                className="aura-update-banner__primary inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-transform hover:scale-[1.02]"
              >
                Restart and update
              </button>
            ) : null}
            {updateState.type === 'error' || isTransient ? (
              <button
                type="button"
                onClick={() => desktopBridge.checkForUpdates?.()}
                className="aura-update-banner__secondary inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-colors"
              >
                Check again
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDismissedType(updateState.type)}
              className="aura-update-banner__secondary inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-colors"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss desktop update notice"
          onClick={() => setDismissedType(updateState.type)}
          className="aura-update-banner__secondary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default DesktopUpdateBanner;
