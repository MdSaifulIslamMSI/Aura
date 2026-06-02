import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { DownloadCloud, ExternalLink, RefreshCw, Smartphone, X } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';
import { compareMobileVersions, resolveLatestMobileRelease } from '../../services/mobileReleaseChannel';
import { getNativeMobilePlatform, isCapacitorNativeRuntime } from '../../utils/nativeRuntime';

import { StableText } from '@/i18n/StableText';
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
  const intl = useIntl();
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
      <div className="aura-mobile-update-banner aura-update-banner aura-floating-utility aura-floating-utility--update fixed bottom-5 left-5 z-[74] w-[min(25rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.45rem] border p-4 text-white backdrop-blur-2xl">
        <div className="flex items-start gap-4">
          <div className="aura-floating-utility__icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full border">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="aura-floating-utility__eyebrow text-[11px] font-black uppercase tracking-[0.22em]"><StableText id={"common.jsx.text.mobile.update.channel.233c2260"} defaultMessage={"Mobile update channel"} /></p>
            <h2 className="aura-floating-utility__title mt-1 text-base font-black">Update check needs another try</h2>
            <p className="aura-floating-utility__detail mt-1 text-sm leading-5">{state.error}</p>
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
    <div className="aura-mobile-update-banner aura-update-banner aura-floating-utility aura-floating-utility--update fixed bottom-5 left-5 z-[74] w-[min(27rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.45rem] border p-4 text-white backdrop-blur-2xl">
      <div className="aura-update-banner__rule absolute inset-x-8 top-0 h-px" />
      <div className="flex items-start gap-4">
        <div className="aura-floating-utility__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full border">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="aura-floating-utility__eyebrow text-[11px] font-black uppercase tracking-[0.22em]"><StableText id={"common.jsx.text.mobile.update.channel.233c2260"} defaultMessage={"Mobile update channel"} /></p>
          <h2 className="aura-floating-utility__title mt-1 text-base font-black">
            <StableText id={"common.jsx.text.aura.mobile.fbf108da"} defaultMessage={"Aura Mobile"} /> {release.version} <StableText id={"common.jsx.text.is.ready.385beb77"} defaultMessage={"is ready"} />
          </h2>
          <p className="aura-floating-utility__detail mt-1 text-sm leading-5">
            <StableText id={"common.jsx.text.your.hosted.aura.experience.keeps.updating.automatically.5f175dd0"} defaultMessage={"Your hosted Aura experience keeps updating automatically. This notice is for the native"} /> {platformName} <StableText id={"common.jsx.text.shell.when.a.new.install.package.is.7d8525a4"} defaultMessage={"shell when a new install package is published."} />
          </p>
          <p className="aura-floating-utility__detail mt-2 text-xs font-semibold">
            <StableText id={"common.jsx.text.installed.12e4a5de"} defaultMessage={"Installed:"} /> {state.installedVersion || 'unknown'} <StableText id={"common.jsx.text.latest.86686e15"} defaultMessage={"| Latest:"} /> {release.version}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={release.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="aura-update-banner__primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition-transform hover:scale-[1.02]"
            >
              <DownloadCloud className="h-4 w-4" />
              {installLabel}
            </a>
            <a
              href={release.notesUrl}
              target="_blank"
              rel="noreferrer"
              className="aura-update-banner__secondary inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              <FormattedMessage id="mobileUpdate.releaseNotes" defaultMessage="Release notes" />
            </a>
            <button
              type="button"
              onClick={dismiss}
              className="aura-update-banner__secondary inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition-colors"
            >
              <FormattedMessage id="mobileUpdate.later" defaultMessage="Later" />
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label={intl.formatMessage({ id: 'mobileUpdate.dismiss.ariaLabel', defaultMessage: 'Dismiss mobile update notice' })}
          onClick={dismiss}
          className="aura-update-banner__secondary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default MobileUpdateBanner;
