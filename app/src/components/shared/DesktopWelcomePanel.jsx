import { useEffect, useState } from 'react';
import { DownloadCloud, MonitorCheck, ShieldCheck, Sparkles, X } from 'lucide-react';

const WELCOME_SEEN_KEY = 'aura_desktop_welcome_seen_v1';

const getDesktopBridge = () => (
  typeof window !== 'undefined' && window.auraDesktop?.isDesktop
    ? window.auraDesktop
    : null
);

const DesktopWelcomePanel = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [appInfo, setAppInfo] = useState(null);
  const desktopBridge = getDesktopBridge();

  useEffect(() => {
    if (!desktopBridge) {
      return;
    }

    const hasSeenWelcome = window.localStorage.getItem(WELCOME_SEEN_KEY) === 'true';
    if (hasSeenWelcome) {
      return;
    }

    setIsVisible(true);
    desktopBridge.getAppInfo?.()
      .then((info) => setAppInfo(info || null))
      .catch(() => setAppInfo(null));
  }, [desktopBridge]);

  if (!desktopBridge || !isVisible) {
    return null;
  }

  const dismiss = () => {
    window.localStorage.setItem(WELCOME_SEEN_KEY, 'true');
    setIsVisible(false);
  };

  const openMarketplace = () => {
    dismiss();
    window.location.assign('/marketplace');
  };

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-slate-950/72 px-4 py-6 backdrop-blur-xl">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-[2.5rem] border border-cyan-300/20 bg-slate-950 text-white shadow-[0_38px_160px_rgba(6,182,212,0.22)]">
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
        <div className="absolute -left-20 top-10 h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-400/12 blur-3xl" />

        <button
          type="button"
          aria-label="Close Aura desktop welcome"
          onClick={dismiss}
          className="absolute right-5 top-5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative grid gap-0 lg:grid-cols-[0.92fr,1.08fr]">
          <div className="border-b border-white/10 p-8 sm:p-10 lg:border-b-0 lg:border-r">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
              <Sparkles className="h-3.5 w-3.5" />
              Installed desktop app
            </div>
            <h2 className="mt-5 text-4xl font-black tracking-tight text-white">
              Aura is ready on this device.
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              This is the desktop edition: stable sign-in, local runtime routing, trusted-device memory, and automatic release checks wrapped around the same Aura web experience.
            </p>
            <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Current build</p>
              <p className="mt-2 text-sm font-semibold text-white">
                {appInfo?.version ? `Aura Marketplace ${appInfo.version}` : 'Aura Marketplace Desktop'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {appInfo?.platform ? `${appInfo.platform} desktop channel` : 'Desktop release channel'}
              </p>
            </div>
          </div>

          <div className="p-8 sm:p-10">
            <div className="grid gap-3">
              {[
                {
                  icon: MonitorCheck,
                  title: 'Browser-perfect layout',
                  detail: 'Aura opens maximized at 1x zoom so desktop alignment matches the production web app.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Sign-in survives app close',
                  detail: 'The desktop runtime uses a stable local identity so closing the X does not create a new login origin.',
                },
                {
                  icon: DownloadCloud,
                  title: 'Updates are harder to miss',
                  detail: 'Aura checks on startup, resume, scheduled intervals, and shows update state inside the app.',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4">
                    <div className="flex gap-4">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-300 text-slate-950">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-black text-white">{item.title}</p>
                        <p className="mt-1 text-sm leading-5 text-slate-400">{item.detail}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={openMarketplace}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-cyan-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-950 transition-transform hover:scale-[1.02]"
              >
                Open marketplace
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-100 transition-colors hover:bg-white/[0.1]"
              >
                Stay here
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DesktopWelcomePanel;
