import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Globe2,
  Layers3,
  Network,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { resolveFrontendTargets } from '@/config/frontendTargets';
import { cn } from '@/lib/utils';

const PLATFORM_THEMES = {
  vercel: {
    accent: 'text-cyan-200',
    frame: 'border-cyan-400/28 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.2),transparent_42%),linear-gradient(160deg,rgba(5,18,31,0.96),rgba(3,10,22,0.98))] shadow-[0_28px_90px_rgba(14,165,233,0.18)]',
    badge: 'border-cyan-300/30 bg-cyan-400/12 text-cyan-100',
    pill: 'border-cyan-300/18 bg-cyan-400/8 text-cyan-100/90',
    button: 'border-cyan-300/32 bg-cyan-400/14 text-white hover:border-cyan-200/50 hover:bg-cyan-400/22',
    halo: 'bg-cyan-300/22',
    title: 'Vercel primary runtime',
    summary: 'Best for the flagship Aura entrypoint and the fastest path into the shared production storefront.',
    facts: ['Primary Aura domain', 'Shared production backend'],
  },
  netlify: {
    accent: 'text-emerald-200',
    frame: 'border-emerald-400/28 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.2),transparent_42%),linear-gradient(160deg,rgba(5,23,24,0.96),rgba(4,12,16,0.98))] shadow-[0_28px_90px_rgba(16,185,129,0.18)]',
    badge: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-100',
    pill: 'border-emerald-300/18 bg-emerald-400/8 text-emerald-100/90',
    button: 'border-emerald-300/32 bg-emerald-400/14 text-white hover:border-emerald-200/50 hover:bg-emerald-400/22',
    halo: 'bg-emerald-300/22',
    title: 'Netlify mirrored runtime',
    summary: 'Best for validating the independent Netlify host while keeping the exact same commerce behavior and data.',
    facts: ['Independent host', 'State stays in sync'],
  },
};

const GATEWAY_PILLARS = [
  {
    icon: Layers3,
    title: 'Single commerce system',
    body: 'Sessions, products, orders, and account state all resolve against the same live production core.',
  },
  {
    icon: Network,
    title: 'Two public runtimes',
    body: 'Vercel and Netlify stay separate at the hosting layer while behaving like the same Aura experience.',
  },
  {
    icon: ShieldCheck,
    title: 'Gateway-ready surface',
    body: 'This layout is strong enough to move into a dedicated general gateway domain without feeling improvised.',
  },
];

const GATEWAY_PRINCIPLES = [
  'Serious language instead of demo copy',
  'Clear separation between gateway and storefront runtime',
  'Fast handoff into the app with zero ambiguity',
  'Visible proof that both domains share the same live state',
];

const buildLaunchTargets = () => resolveFrontendTargets({
  vercelUrl: import.meta.env.VITE_VERCEL_FRONTEND_URL,
  netlifyUrl: import.meta.env.VITE_NETLIFY_FRONTEND_URL,
  currentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
});

const Launch = () => {
  const launchTargets = buildLaunchTargets();

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030712] text-slate-50">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10rem] top-[-5rem] h-[26rem] w-[26rem] rounded-full bg-cyan-400/16 blur-[150px]" />
        <div className="absolute right-[-8rem] top-[8rem] h-[24rem] w-[24rem] rounded-full bg-emerald-400/14 blur-[150px]" />
        <div className="absolute bottom-[-12rem] left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-blue-500/10 blur-[170px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,7,18,0.08),rgba(3,7,18,0.46)_58%,rgba(3,7,18,0.78))]" />
      </div>

      <div className="premium-page-frame relative py-8 sm:py-10 lg:py-14">
        <section className="premium-hero-panel overflow-hidden rounded-[2.3rem] p-6 sm:p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr,0.85fr] xl:gap-10">
            <div>
              <div className="premium-eyebrow">
                <Sparkles className="h-3.5 w-3.5" />
                Aura Gateway
              </div>
              <h1 className="mt-6 max-w-4xl text-4xl font-black tracking-[-0.06em] text-white sm:text-5xl lg:text-7xl">
                A sharper front door for Aura&apos;s live frontend stack.
              </h1>
              <p className="mt-6 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
                Choose the runtime you want, enter the same production commerce system, and keep the same
                identity, cart, wishlist, profile, and order state across both domains. This is the gateway
                surface that can also graduate into a dedicated general-domain project when you want it to.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {GATEWAY_PILLARS.map((pillar) => {
                  const Icon = pillar.icon;

                  return (
                    <article
                      key={pillar.title}
                      className="rounded-[1.4rem] border border-white/10 bg-white/[0.05] p-4 shadow-[0_20px_45px_rgba(2,6,23,0.24)] backdrop-blur-xl"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-cyan-100">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h2 className="mt-4 text-lg font-black tracking-[-0.03em] text-white">
                        {pillar.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {pillar.body}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            <aside className="premium-panel rounded-[2rem] p-6 sm:p-7">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="premium-kicker">General Link Direction</p>
                  <h2 className="mt-3 text-2xl font-black tracking-[-0.04em] text-white sm:text-[2rem]">
                    Ready for a dedicated gateway project.
                  </h2>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-slate-100">
                  <Globe2 className="h-5 w-5" />
                </div>
              </div>

              <p className="mt-5 text-sm leading-7 text-slate-300">
                If you spin up a separate Vercel project such as <span className="font-semibold text-slate-100">general.vercel.app</span>,
                this gateway can be the calm handoff layer above both live storefronts instead of a rough technical
                switchboard living inside one of them.
              </p>

              <div className="mt-6 space-y-3">
                {GATEWAY_PRINCIPLES.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
                    <span className="text-sm leading-6 text-slate-200">{item}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[1.6rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                  Deployment contract
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Hosts</p>
                    <p className="mt-2 text-lg font-bold text-white">Vercel + Netlify</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">State</p>
                    <p className="mt-2 text-lg font-bold text-white">Shared production data</p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="grid gap-6">
            {launchTargets.map((target) => {
              const theme = PLATFORM_THEMES[target.id] || PLATFORM_THEMES.vercel;

              return (
                <article
                  key={target.id}
                  className={cn(
                    'group relative overflow-hidden rounded-[2rem] border p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-7',
                    theme.frame
                  )}
                >
                  <div className={cn('pointer-events-none absolute right-[-2rem] top-[-2rem] h-36 w-36 rounded-full blur-3xl', theme.halo)} />
                  <div className="relative flex h-full flex-col">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.22em]', theme.badge)}>
                        <Globe2 className="h-3.5 w-3.5" />
                        {target.platform}
                      </div>
                      <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em]', target.isCurrent ? theme.pill : 'border-white/10 bg-white/[0.04] text-slate-300')}>
                        {target.isCurrent ? 'Current host' : target.isLive ? 'Live target' : 'Pending'}
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-start justify-between gap-5">
                      <div className="max-w-2xl">
                        <h3 className="text-3xl font-black tracking-[-0.05em] text-white sm:text-[2.2rem]">
                          {theme.title}
                        </h3>
                        <p className="mt-4 text-base leading-7 text-slate-300">
                          {theme.summary}
                        </p>
                      </div>
                      <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.05] p-3 text-slate-100 shadow-[0_18px_40px_rgba(2,6,23,0.26)]">
                        <ArrowUpRight className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                          Live domain
                        </p>
                        <span className={cn('text-[11px] font-black uppercase tracking-[0.22em]', theme.accent)}>
                          {target.label}
                        </span>
                      </div>
                      <p className="mt-3 break-all font-mono text-sm text-slate-100 sm:text-[15px]">
                        {target.originLabel}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-slate-300">
                        {target.description}
                      </p>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {theme.facts.map((fact) => (
                        <div
                          key={fact}
                          className="rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-100"
                        >
                          {fact}
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 flex flex-1 items-end">
                      {target.isLive ? (
                        <a
                          href={target.href}
                          className={cn(
                            'inline-flex w-full items-center justify-between rounded-full border px-5 py-4 text-sm font-black uppercase tracking-[0.22em] transition-all duration-300',
                            theme.button
                          )}
                        >
                          <span>Open storefront</span>
                          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                        </a>
                      ) : (
                        <div className="inline-flex w-full items-center justify-between rounded-full border border-dashed border-white/15 bg-white/[0.05] px-5 py-4 text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
                          <span>Deployment target pending</span>
                          <span className="text-[10px] tracking-[0.24em] text-slate-500">Needs URL</span>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="grid gap-6">
            <section className="premium-panel rounded-[2rem] p-6 sm:p-7">
              <p className="premium-kicker">Shared behavior</p>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.04em] text-white">
                Both links should feel ideologically identical.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Different domains are fine. Missing state, weaker flows, or reduced capability are not. This
                gateway makes that expectation explicit before the user enters either runtime.
              </p>

              <div className="mt-6 space-y-3">
                {[
                  'Authentication and trusted session continuity',
                  'Cart, wishlist, checkout, and order reflection',
                  'Profile updates and account posture consistency',
                  'Same storefront intent with independent hosting',
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                    <span className="text-sm leading-6 text-slate-200">{item}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="premium-panel rounded-[2rem] p-6 sm:p-7">
              <p className="premium-kicker">Design standard</p>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.04em] text-white">
                Cleaner, calmer, and less toy-like.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                The page now behaves more like a premium access layer than a temporary glossy experiment: better
                hierarchy, stronger language, clearer deployment context, and a more controlled visual system.
              </p>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Launch;
