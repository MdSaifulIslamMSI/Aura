import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { DownloadCloud, ExternalLink, RefreshCw, Smartphone, X } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';
import { compareMobileVersions, resolveLatestMobileRelease } from '../../services/mobileReleaseChannel';
import { getNativeMobilePlatform, isCapacitorNativeRuntime } from '../../utils/nativeRuntime';

import { StableText } from '@/i18n/StableText';
const DISMISS_PREFIX = 'aura_mobile_update_dismissed_';

const readDismissedFlag = (dismissKey) => {
  try {
    return window.localStorage.getItem(dismissKey) === 'true';
  } catch {
    // Storage can be blocked (private mode, quota); treat as not dismissed.
    return false;
  }
};

const writeDismissedFlag = (dismissKey) => {
  try {
    window.localStorage.setItem(dismissKey, 'true');
  } catch {
    // Ignore: the in-session state still hides the banner until remount.
  }
};

const platformLabel = (platform = '') => {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iPhone';
  return 'mobile';
};

const shouldShowRelease = (release, installedVersion = '') => {
  if (!release?.version) return false;
  // Never nag when the installed version is unknown: an unread App.getInfo
  // must not pin the banner to every screen. Only a strictly older install
  // (or a manually opened banner via notes) surfaces the update.
  if (!installedVersion) return false;
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
            <h2 className="aura-floating-utility__title mt-1 text-base font-black">
              <FormattedMessage id="mobileUpdate.checkFailedTitle" defaultMessage="Update check needs another try" />
            </h2>
            <p className="aura-floating-utility__detail mt-1 text-sm leading-5">
              <FormattedMessage
                id="mobileUpdate.checkFailedDetail"
                defaultMessage="Aura could not reach the release channel. {message}"
                values={{ message: state.error }}
              />
            </p>
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
  const wasDismissed = dismissedTag === release.tagName || readDismissedFlag(dismissKey);

  if (wasDismissed) {
    return null;
  }

  const dismiss = () => {
    writeDismissedFlag(dismissKey);
    setDismissedTag(release.tagName);
  };

  const platformName = platformLabel(state.platform);
  const isDirectInstall = !(state.platform === 'ios' && !release.assetName.endsWith('.ipa'));

  const shortDigest = release.sha256
    ? `${release.sha256.slice(0, 12)}…${release.sha256.slice(-12)}`
    : '';

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
          {shortDigest ? (
            <p className="aura-floating-utility__detail mt-1 break-all font-mono text-[10px] uppercase tracking-wider opacity-80">
              <FormattedMessage id="mobileUpdate.checksumLabel" defaultMessage="Verify SHA-256" />: {shortDigest}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={release.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="aura-update-banner__primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition-transform hover:scale-[1.02]"
            >
              <DownloadCloud className="h-4 w-4" />
              {isDirectInstall ? (
                <FormattedMessage
                  id="mobileUpdate.downloadPlatformUpdate"
                  defaultMessage="Download {platform} update"
                  values={{ platform: platformName }}
                />
              ) : (
                <FormattedMessage id="mobileUpdate.openRelease" defaultMessage="Open mobile release" />
              )}
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
