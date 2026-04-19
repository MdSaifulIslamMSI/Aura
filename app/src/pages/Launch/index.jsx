import { ArrowRight, ExternalLink, Globe2, Sparkles } from 'lucide-react';
import { resolveFrontendTargets } from '@/config/frontendTargets';
import { cn } from '@/lib/utils';

const PLATFORM_ACCENTS = {
  vercel: {
    shell: 'border-cyan-300/30 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.28),transparent_38%),linear-gradient(180deg,rgba(6,17,28,0.92),rgba(4,10,18,0.98))] shadow-[0_24px_70px_rgba(34,211,238,0.16)]',
    badge: 'border-cyan-300/35 bg-cyan-400/12 text-cyan-100',
    button: 'border-cyan-300/35 bg-cyan-400/16 text-white hover:bg-cyan-400/22 hover:border-cyan-200/55',
    glow: 'bg-cyan-300/25',
  },
  netlify: {
    shell: 'border-emerald-300/30 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.26),transparent_38%),linear-gradient(180deg,rgba(7,18,20,0.92),rgba(5,10,14,0.98))] shadow-[0_24px_70px_rgba(52,211,153,0.16)]',
    badge: 'border-emerald-300/35 bg-emerald-400/12 text-emerald-100',
    button: 'border-emerald-300/35 bg-emerald-400/16 text-white hover:bg-emerald-400/22 hover:border-emerald-200/55',
    glow: 'bg-emerald-300/25',
  },
};

const launchTargets = resolveFrontendTargets({
  vercelUrl: import.meta.env.VITE_VERCEL_FRONTEND_URL,
  netlifyUrl: import.meta.env.VITE_NETLIFY_FRONTEND_URL,
  currentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
});

const Launch = () => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050816] text-slate-50">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-cyan-400/18 blur-[120px]" />
        <div className="absolute right-[-4rem] top-8 h-80 w-80 rounded-full bg-emerald-400/18 blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] [background-size:60px_60px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-12 sm:px-6 lg:px-8">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_110px_rgba(2,8,23,0.55)] backdrop-blur-xl sm:p-8 lg:p-10">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-slate-200">
              <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
              General Frontend Link
            </div>
            <h1 className="mt-5 text-4xl font-black tracking-[-0.05em] text-white sm:text-5xl lg:text-6xl">
              One launch page, two live frontends.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Pick the deployment you want and jump straight into the Aura app through a glossy, minimal switchboard.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {launchTargets.map((target) => {
              const accent = PLATFORM_ACCENTS[target.id] || PLATFORM_ACCENTS.vercel;

              return (
                <article
                  key={target.id}
                  className={cn(
                    'group relative overflow-hidden rounded-[1.9rem] border p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-7',
                    accent.shell
                  )}
                >
                  <div className={cn('absolute right-[-2rem] top-[-2rem] h-32 w-32 rounded-full blur-3xl', accent.glow)} />
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.22em]', accent.badge)}>
                          <Globe2 className="h-3.5 w-3.5" />
                          {target.platform}
                        </div>
                        <h2 className="mt-5 text-2xl font-black tracking-[-0.04em] text-white">
                          {target.label}
                        </h2>
                        <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
                          {target.description}
                        </p>
                      </div>
                      <div className="rounded-full border border-white/12 bg-white/[0.08] p-3 text-slate-100">
                        <ExternalLink className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="mt-8 flex flex-1 items-end">
                      {target.isLive ? (
                        <a
                          href={target.href}
                          className={cn(
                            'inline-flex w-full items-center justify-between rounded-full border px-5 py-4 text-sm font-black uppercase tracking-[0.22em] transition-all duration-300',
                            accent.button
                          )}
                        >
                          <span>Go to app</span>
                          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                        </a>
                      ) : (
                        <div className="inline-flex w-full items-center justify-between rounded-full border border-dashed border-white/15 bg-white/[0.05] px-5 py-4 text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
                          <span>Deploy target pending</span>
                          <span className="text-[10px] tracking-[0.24em] text-slate-500">Needs URL</span>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Launch;
