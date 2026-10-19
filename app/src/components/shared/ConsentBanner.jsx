import { useEffect } from 'react';
import { EyeOff, ShieldCheck, X } from 'lucide-react';
import { useOptionalMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import useTelemetryConsent from '@/hooks/useTelemetryConsent';
import { initDatadogRum, stopDatadogRumTelemetry } from '@/services/datadogRum';
import { initSentry } from '@/services/sentryClient';
import { TELEMETRY_CONSENT_GRANTED } from '@/services/telemetryConsent';

// TODO(i18n): the copy below uses stable message ids that are NOT yet in
// app/src/i18n/messages/stableUiMessages.js (that file is generated, and
// adding a key means regenerating the reviewed/compiled catalogs for all 21
// locales). Until that lands, the ids resolve to the English fallback only.
// Follow-up: add consent.* to the stable catalog and the locale packs.
const ConsentBanner = () => {
  const market = useOptionalMarket();
  const t = useStableIcuMessages(market?.t);
  const { decision, isGranted, isUndecided, grant, deny } = useTelemetryConsent();

  useEffect(() => {
    if (decision === TELEMETRY_CONSENT_GRANTED) {
      // Both calls are idempotent: they only (re)initialise when the consent
      // posture changed, so mounting the banner never double-initialises.
      void initSentry();
      void initDatadogRum();
      return;
    }

    // Consent withdrawn or never given: make sure no capture surface is live.
    stopDatadogRumTelemetry();
    void initSentry();
  }, [decision]);

  if (!isUndecided && !isGranted) {
    return null;
  }

  if (isGranted) {
    return (
      <div className="fixed bottom-5 right-5 z-[74] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.45rem] border border-white/12 bg-zinc-950/92 p-4 text-white shadow-glass backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neo-cyan/30 bg-neo-cyan/10 text-neo-cyan">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">
              {t('consent.banner.eyebrow', {}, 'Privacy')}
            </p>
            <p className="mt-1 text-sm leading-5 text-slate-100">
              {t('consent.banner.granted.detail', {}, 'Optional session replay is on.')}
            </p>
          </div>
          <button
            type="button"
            onClick={deny}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-100 transition-colors hover:bg-white/10"
          >
            <EyeOff className="h-3.5 w-3.5" />
            {t('consent.banner.turnOff', {}, 'Turn off')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('consent.banner.eyebrow', {}, 'Privacy')}
      className="fixed inset-x-3 bottom-5 z-[75] mx-auto w-[min(38rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.45rem] border border-neo-cyan/25 bg-zinc-950/92 p-4 text-white shadow-glass backdrop-blur-2xl sm:inset-x-6"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-neo-cyan/30 bg-neo-cyan/10 text-neo-cyan">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">
              {t('consent.banner.eyebrow', {}, 'Privacy')}
            </p>
            {/* The banner is a fixed bottom overlay, so it can sit on top of a
                page's primary control. It must always be dismissible: closing
                it is the same posture as declining, because the default is
                "nothing is captured". */}
            <button
              type="button"
              onClick={deny}
              aria-label={t('consent.banner.dismiss', {}, 'Dismiss')}
              className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <h2 className="mt-1 text-base font-black">
            {t('consent.banner.title', {}, 'Allow optional session replay?')}
          </h2>
          <p className="mt-1 text-sm leading-5 text-slate-200">
            {t(
              'consent.banner.detail',
              {},
              'Aura can record a masked replay of this session and report usage analytics so we can fix problems faster. Text and media stay masked, and the data is processed in the United States. Nothing is recorded until you allow it.',
            )}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={grant}
              className="inline-flex items-center justify-center rounded-full bg-neo-cyan px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-zinc-950 transition-transform hover:scale-[1.02]"
            >
              {t('consent.banner.allow', {}, 'Allow')}
            </button>
            <button
              type="button"
              onClick={deny}
              className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-100 transition-colors hover:bg-white/10"
            >
              {t('consent.banner.decline', {}, 'No thanks')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConsentBanner;
