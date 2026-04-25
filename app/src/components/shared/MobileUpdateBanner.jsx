import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { DownloadCloud, ExternalLink, RefreshCw, Smartphone, X } from 'lucide-react';
import { compareMobileVersions, resolveLatestMobileRelease } from '../../services/mobileReleaseChannel';
import { getNativeMobilePlatform, isCapacitorNativeRuntime } from '../../utils/nativeRuntime';

const DISMISS_PREFIX = 'aura_mobile_update_dismissed_';

const platformLabel = (platform = '') => {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iPhone';
  return 'mobile';
};

const shouldShowRelease = (release, installedVersion = '') => {
  if (!release?.version) return false;
  if (!installedVersion) return true;
  return compareMobileVersions(release.version, installedVersion) > 0;
};

const MobileUpdateBanner = () => {
  const [state, setState] = useState({
    status: 'idle',
    platform: '',
    installedVersion: '',
    release: null,
    error: '',
  });
  const [dismissedTag, setDismissedTag] = useState('');

  useEffect(() => {
    if (!isCapacitorNativeRuntime()) {
      return undefined;
    }

    let cancelled = false;

    const checkRelease = async () => {
      const platform = getNativeMobilePlatform();
      if (!platform) return;

      setState((current) => ({ ...current, status: 'checking', platform, error: '' }));

      try {
        const [appInfo, release] = await Promise.all([
          CapacitorApp.getInfo().catch(() => null),
          resolveLatestMobileRelease({ platform }),
        ]);
        const installedVersion = String(appInfo?.version || '').trim();

        if (cancelled) return;

        setState({
          status: 'ready',
          platform,
          installedVersion,
          release,
          error: '',
        });
      } catch (error) {
        if (cancelled) return;

        setState({
          status: 'error',
          platform,
          installedVersion: '',
          release: null,
          error: error?.message || 'Mobile update check failed.',
        });
      }
    };

    void checkRelease();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isCapacitorNativeRuntime() || state.status === 'idle' || state.status === 'checking') {
    return null;
  }

  if (state.status === 'error') {
    return (
      <div className="aura-mobile-update-banner fixed bottom-5 left-5 z-[9998] w-[min(25rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.65rem] border border-amber-300/25 bg-slate-950/92 p-4 text-white shadow-[0_24px_90px_rgba(2,8,23,0.45)] backdrop-blur-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-100">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-100/80">Mobile update channel</p>
            <h2 className="mt-1 text-base font-black text-white">Update check needs another try</h2>
            <p className="mt-1 text-sm leading-5 text-slate-300">{state.error}</p>
          </div>
        </div>
      </div>
    );
  }

  const release = state.release;
  if (!shouldShowRelease(release, state.installedVersion)) {
    return null;
  }

  const dismissKey = `${DISMISS_PREFIX}${release.tagName}`;
  const wasDismissed = dismissedTag === release.tagName
    || (typeof window !== 'undefined' && window.localStorage.getItem(dismissKey) === 'true');

  if (wasDismissed) {
    return null;
  }

  const dismiss = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(dismissKey, 'true');
    }
    setDismissedTag(release.tagName);
  };

  const platformName = platformLabel(state.platform);
  const installLabel = state.platform === 'ios' && !release.assetName.endsWith('.ipa')
    ? 'Open mobile release'
    : `Download ${platformName} update`;

  return (
    <div className="aura-mobile-update-banner fixed bottom-5 left-5 z-[9998] w-[min(27rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.75rem] border border-emerald-300/20 bg-slate-950/92 p-4 text-white shadow-[0_24px_90px_rgba(2,8,23,0.45)] backdrop-blur-2xl">
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-emerald-200/80 to-transparent" />
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-100">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-100/80">Mobile update channel</p>
          <h2 className="mt-1 text-base font-black text-white">
            Aura Mobile {release.version} is ready
          </h2>
          <p className="mt-1 text-sm leading-5 text-slate-300">
            Your hosted Aura experience keeps updating automatically. This notice is for the native {platformName} shell when a new install package is published.
          </p>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            Installed: {state.installedVersion || 'unknown'} | Latest: {release.version}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={release.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-950 transition-transform hover:scale-[1.02]"
            >
              <DownloadCloud className="h-4 w-4" />
              {installLabel}
            </a>
            <a
              href={release.notesUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-100 transition-colors hover:bg-white/[0.1]"
            >
              <ExternalLink className="h-4 w-4" />
              Release notes
            </a>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss mobile update notice"
          onClick={dismiss}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default MobileUpdateBanner;
