import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Camera,
  Check,
  Copy,
  Globe2,
  Languages,
  Layers,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import { resolveFrontendTargets } from '@/config/frontendTargets';
import { formatReleaseBuiltAt, releaseInfo, resolveRuntimeHost } from '@/config/releaseInfo';
import { cn } from '@/lib/utils';

const launchMessages = defineMessages({
  runtimeHostLocal: {
    id: 'launch.runtimeHost.local',
    defaultMessage: 'Local runtime',
  },
  runtimeHostUnknown: {
    id: 'launch.runtimeHost.unknown',
    defaultMessage: 'Active runtime',
  },
  buildTimeUnavailable: {
    id: 'launch.buildTime.unavailable',
    defaultMessage: 'Build time unavailable',
  },
  copyOriginLabel: {
    id: 'launch.targets.copyOrigin',
    defaultMessage: 'Copy origin URL for {label}',
  },
  copiedOriginLabel: {
    id: 'launch.targets.copiedOrigin',
    defaultMessage: 'Copied',
  },
  openStorefrontAction: {
    id: 'launch.targets.openStorefront',
    defaultMessage: 'Open storefront',
  },
  openRuntimeAction: {
    id: 'launch.targets.openTarget',
    defaultMessage: 'Open {label}',
  },
  cloudfrontBadge: {
    id: 'launch.edge.cloudfront.badge',
    defaultMessage: 'AWS Edge',
  },
  cloudfrontTitle: {
    id: 'launch.edge.cloudfront.title',
    defaultMessage: 'CloudFront Distribution',
  },
  cloudfrontRole: {
    id: 'launch.edge.cloudfront.role',
    defaultMessage: 'AWS CDN Storefront',
  },
  cloudfrontDescription: {
    id: 'launch.edge.cloudfront.description',
    defaultMessage: 'Serves the S3 and CloudFront edge distribution backed by the shared backend contract.',
  },
  renderBadge: {
    id: 'launch.edge.render.badge',
    defaultMessage: 'Render Mirror',
  },
  renderTitle: {
    id: 'launch.edge.render.title',
    defaultMessage: 'Render Mirror Storefront',
  },
  renderRole: {
    id: 'launch.edge.render.role',
    defaultMessage: 'Mirror Storefront',
  },
  renderDescription: {
    id: 'launch.edge.render.description',
    defaultMessage: 'Mirrors main-branch builds while maintaining full authentication and catalog parity.',
  },
  moduleAssistantTitle: {
    id: 'launch.showcase.assistant.title',
    defaultMessage: 'Commerce Copilot & Tool Loop',
  },
  moduleAssistantTag: {
    id: 'launch.showcase.assistant.tag',
    defaultMessage: 'Grounded AI',
  },
  moduleAssistantSummary: {
    id: 'launch.showcase.assistant.summary',
    defaultMessage: 'Multimodal shopping assistant with verified product tool execution, voice dictation, image/audio context, and confirmation cards.',
  },
  moduleAssistantPointOne: {
    id: 'launch.showcase.assistant.pointOne',
    defaultMessage: 'Bounded multi-iteration catalog verification before product citations',
  },
  moduleAssistantPointTwo: {
    id: 'launch.showcase.assistant.pointTwo',
    defaultMessage: 'Persistent viewer-scoped chat sessions synced across routes',
  },
  moduleAssistantPointThree: {
    id: 'launch.showcase.assistant.pointThree',
    defaultMessage: 'Locale-aware voice intake and explicit confirmation before mutations',
  },
  moduleAssistantCta: {
    id: 'launch.showcase.assistant.cta',
    defaultMessage: 'Launch Commerce Copilot',
  },
  moduleIntelligenceTitle: {
    id: 'launch.showcase.intelligence.title',
    defaultMessage: 'Visual Search & AI Compare',
  },
  moduleIntelligenceTag: {
    id: 'launch.showcase.intelligence.tag',
    defaultMessage: 'Decision Engine',
  },
  moduleIntelligenceSummary: {
    id: 'launch.showcase.intelligence.summary',
    defaultMessage: 'Upload or paste product screenshots to inspect live price-gap distributions, authenticity hints, and side-by-side winners.',
  },
  moduleIntelligencePointOne: {
    id: 'launch.showcase.intelligence.pointOne',
    defaultMessage: 'Live median, floor, and ceiling snapshot against matched listings',
  },
  moduleIntelligencePointTwo: {
    id: 'launch.showcase.intelligence.pointTwo',
    defaultMessage: 'Weighted comparison modes across Value, Spec, Trust, and Balanced',
  },
  moduleIntelligencePointThree: {
    id: 'launch.showcase.intelligence.pointThree',
    defaultMessage: 'Direct screenshot-to-comparison handoff for matched SKUs',
  },
  moduleIntelligenceCta: {
    id: 'launch.showcase.intelligence.cta',
    defaultMessage: 'Open Visual Search',
  },
  moduleI18nTitle: {
    id: 'launch.showcase.i18n.title',
    defaultMessage: '20-Locale ICU & Compositional Engine',
  },
  moduleI18nTag: {
    id: 'launch.showcase.i18n.tag',
    defaultMessage: 'Global Native Script',
  },
  moduleI18nSummary: {
    id: 'launch.showcase.i18n.summary',
    defaultMessage: 'FormatJS AST catalogs across 19 localized languages with bidirectional RTL adaptation and zero-egress compositional translation.',
  },
  moduleI18nPointOne: {
    id: 'launch.showcase.i18n.pointOne',
    defaultMessage: 'Native Devanagari, Bengali, Arabic, CJK, and Latin scripts enforced in CI',
  },
  moduleI18nPointTwo: {
    id: 'launch.showcase.i18n.pointTwo',
    defaultMessage: 'Zero-egress PII-redacting runtime compositional phrase translator',
  },
  moduleI18nPointThree: {
    id: 'launch.showcase.i18n.pointThree',
    defaultMessage: 'Locale-driven currency presentment, numbers, and timestamps',
  },
  moduleI18nCta: {
    id: 'launch.showcase.i18n.cta',
    defaultMessage: 'Browse Storefront',
  },
  moduleSecurityTitle: {
    id: 'launch.showcase.security.title',
    defaultMessage: 'Zero-Trust Auth & Resilience Layer',
  },
  moduleSecurityTag: {
    id: 'launch.showcase.security.tag',
    defaultMessage: 'Defense in Depth',
  },
  moduleSecuritySummary: {
    id: 'launch.showcase.security.summary',
    defaultMessage: 'Risk-scored login checkpoints, signed order/payment receipts, webhook idempotency, and admin-gated AWS operations.',
  },
  moduleSecurityPointOne: {
    id: 'launch.showcase.security.pointOne',
    defaultMessage: 'Trusted-device verification and step-up checkpoint enforcement',
  },
  moduleSecurityPointTwo: {
    id: 'launch.showcase.security.pointTwo',
    defaultMessage: 'Verified GitHub release artifacts with desktop and mobile targets',
  },
  moduleSecurityPointThree: {
    id: 'launch.showcase.security.pointThree',
    defaultMessage: 'Strict Content-Security-Policy parity across every frontend edge',
  },
  moduleSecurityCta: {
    id: 'launch.showcase.security.cta',
    defaultMessage: 'Open AI Compare',
  },
  contractAuth: {
    id: 'launch.contract.auth',
    defaultMessage: 'Authentication & session continuity',
  },
  contractApi: {
    id: 'launch.contract.api',
    defaultMessage: 'Unified API & payment security contract',
  },
  contractLocale: {
    id: 'launch.contract.locale',
    defaultMessage: 'Synchronized 20-locale FormatJS catalogs',
  },
  contractAdmin: {
    id: 'launch.contract.admin',
    defaultMessage: 'Role-gated AWS & operations control plane',
  },
});

const ARCHITECTURE_PILLARS = [
  {
    id: 'assistant',
    icon: Bot,
    route: '/assistant',
    titleMessage: launchMessages.moduleAssistantTitle,
    tagMessage: launchMessages.moduleAssistantTag,
    summaryMessage: launchMessages.moduleAssistantSummary,
    pointMessages: [
      launchMessages.moduleAssistantPointOne,
      launchMessages.moduleAssistantPointTwo,
      launchMessages.moduleAssistantPointThree,
    ],
    ctaMessage: launchMessages.moduleAssistantCta,
    surfacePath: '/assistant · POST /api/ai/chat',
  },
  {
    id: 'intelligence',
    icon: Camera,
    route: '/visual-search',
    titleMessage: launchMessages.moduleIntelligenceTitle,
    tagMessage: launchMessages.moduleIntelligenceTag,
    summaryMessage: launchMessages.moduleIntelligenceSummary,
    pointMessages: [
      launchMessages.moduleIntelligencePointOne,
      launchMessages.moduleIntelligencePointTwo,
      launchMessages.moduleIntelligencePointThree,
    ],
    ctaMessage: launchMessages.moduleIntelligenceCta,
    surfacePath: '/visual-search · /compare',
  },
  {
    id: 'i18n',
    icon: Languages,
    route: '/',
    titleMessage: launchMessages.moduleI18nTitle,
    tagMessage: launchMessages.moduleI18nTag,
    summaryMessage: launchMessages.moduleI18nSummary,
    pointMessages: [
      launchMessages.moduleI18nPointOne,
      launchMessages.moduleI18nPointTwo,
      launchMessages.moduleI18nPointThree,
    ],
    ctaMessage: launchMessages.moduleI18nCta,
    surfacePath: 'FormatJS AST + POST /api/i18n/translate',
  },
  {
    id: 'security',
    icon: ShieldCheck,
    route: '/compare',
    titleMessage: launchMessages.moduleSecurityTitle,
    tagMessage: launchMessages.moduleSecurityTag,
    summaryMessage: launchMessages.moduleSecuritySummary,
    pointMessages: [
      launchMessages.moduleSecurityPointOne,
      launchMessages.moduleSecurityPointTwo,
      launchMessages.moduleSecurityPointThree,
    ],
    ctaMessage: launchMessages.moduleSecurityCta,
    surfacePath: 'CSP Parity + Risk Engine + Release Channels',
  },
];

const EXTRA_DISTRIBUTION_EDGES = [
  {
    id: 'cloudfront',
    platform: 'CloudFront',
    href: 'https://dip82eloip5zb.cloudfront.net',
    originLabel: 'dip82eloip5zb.cloudfront.net',
    badgeMessage: launchMessages.cloudfrontBadge,
    labelMessage: launchMessages.cloudfrontTitle,
    roleMessage: launchMessages.cloudfrontRole,
    descriptionMessage: launchMessages.cloudfrontDescription,
  },
  {
    id: 'render',
    platform: 'Render',
    href: 'https://aura-storefront.onrender.com',
    originLabel: 'aura-storefront.onrender.com',
    badgeMessage: launchMessages.renderBadge,
    labelMessage: launchMessages.renderTitle,
    roleMessage: launchMessages.renderRole,
    descriptionMessage: launchMessages.renderDescription,
  },
];

const RUNTIME_CONTRACTS = [
  { id: 'auth', message: launchMessages.contractAuth },
  { id: 'api', message: launchMessages.contractApi },
  { id: 'locale', message: launchMessages.contractLocale },
  { id: 'admin', message: launchMessages.contractAdmin },
];

export default function Launch() {
  const intl = useIntl();
  const formatMessage = useMemo(
    () => (descriptor, values) => intl.formatMessage(descriptor, values),
    [intl],
  );
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const detectedHost = resolveRuntimeHost(currentOrigin);
  const runtimeHostLabel = detectedHost === 'local'
    ? intl.formatMessage(launchMessages.runtimeHostLocal)
    : detectedHost === 'unknown'
      ? intl.formatMessage(launchMessages.runtimeHostUnknown)
      : detectedHost;
  const builtAtLabel = formatReleaseBuiltAt(
    releaseInfo.builtAt,
    intl.locale,
    intl.formatMessage(launchMessages.buildTimeUnavailable),
  );

  const primaryTargets = useMemo(() => resolveFrontendTargets({
    vercelUrl: import.meta.env.VITE_VERCEL_FRONTEND_URL,
    netlifyUrl: import.meta.env.VITE_NETLIFY_FRONTEND_URL,
    currentOrigin,
    formatMessage,
  }), [currentOrigin, formatMessage]);

  const distributionEdges = useMemo(() => ([
    ...primaryTargets.map((target) => ({
      id: target.id,
      platform: target.platform,
      badge: target.badge,
      label: target.label,
      role: target.badge,
      href: target.href,
      originLabel: target.originLabel,
      description: target.description,
      active: Boolean(target.active),
      primary: target.id === 'vercel',
    })),
    ...EXTRA_DISTRIBUTION_EDGES.map((edge) => ({
      id: edge.id,
      platform: edge.platform,
      badge: intl.formatMessage(edge.badgeMessage),
      label: intl.formatMessage(edge.labelMessage),
      role: intl.formatMessage(edge.roleMessage),
      href: edge.href,
      originLabel: edge.originLabel,
      description: intl.formatMessage(edge.descriptionMessage),
      active: Boolean(currentOrigin && currentOrigin.includes(edge.originLabel)),
      primary: false,
    })),
  ]), [currentOrigin, intl, primaryTargets]);

  const [selectedPillarId, setSelectedPillarId] = useState(ARCHITECTURE_PILLARS[0].id);
  const [copiedTargetId, setCopiedTargetId] = useState('');

  const activePillar = useMemo(
    () => ARCHITECTURE_PILLARS.find((entry) => entry.id === selectedPillarId) || ARCHITECTURE_PILLARS[0],
    [selectedPillarId],
  );

  const handleCopyOrigin = async (edge) => {
    if (!edge?.href || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(edge.href);
      setCopiedTargetId(edge.id);
      window.setTimeout(() => {
        setCopiedTargetId((current) => (current === edge.id ? '' : current));
      }, 1800);
    } catch {
      // Clipboard access can be restricted inside automated frames; ignore cleanly.
    }
  };

  const ActiveIcon = activePillar.icon;

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.16),transparent_48%),linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.98))] p-6 shadow-2xl sm:p-10">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-neo-cyan/30 bg-neo-cyan/10 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-neo-cyan">
              <Sparkles className="h-3.5 w-3.5" />
              <FormattedMessage
                id="launch.hero.eyebrow"
                defaultMessage="Aura Architecture & Multi-Edge Gateway"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-neo-emerald" />
                {runtimeHostLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[11px] text-slate-300">
                {releaseInfo.shortCommitSha} · {releaseInfo.channel}
              </span>
            </div>
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl sm:leading-[1.08]">
                <FormattedMessage
                  id="launch.hero.headline"
                  defaultMessage="One commerce platform across four production edges and grounded AI workspaces."
                />
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                <FormattedMessage
                  id="launch.hero.subtitle"
                  defaultMessage="Explore Aura's live storefront mirrors, inspect the multimodal Commerce Copilot, test Visual Search and AI Compare, and verify active build telemetry from one command surface."
                />
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 rounded-xl bg-neo-cyan px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300"
                >
                  <FormattedMessage id="launch.cta.storefront" defaultMessage="Enter Storefront" />
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Link>
                <Link
                  to="/assistant"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white transition hover:border-neo-cyan/45 hover:bg-white/[0.1]"
                >
                  <Bot className="h-4 w-4 text-neo-cyan" />
                  <FormattedMessage id="launch.cta.assistant" defaultMessage="Commerce Copilot" />
                </Link>
                <Link
                  to="/visual-search"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white transition hover:border-neo-cyan/45 hover:bg-white/[0.1]"
                >
                  <Camera className="h-4 w-4 text-neo-emerald" />
                  <FormattedMessage id="launch.cta.visualSearch" defaultMessage="Visual Search" />
                </Link>
                <Link
                  to="/compare"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white transition hover:border-neo-cyan/45 hover:bg-white/[0.1]"
                >
                  <Scale className="h-4 w-4 text-amber-300" />
                  <FormattedMessage id="launch.cta.compare" defaultMessage="AI Compare" />
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-zinc-950/75 p-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  <FormattedMessage id="launch.telemetry.releaseId" defaultMessage="Release ID" />
                </p>
                <p className="mt-1.5 truncate font-mono text-xs font-bold text-white">
                  {releaseInfo.id}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  <FormattedMessage id="launch.telemetry.deployTarget" defaultMessage="Deploy Target" />
                </p>
                <p className="mt-1.5 truncate font-mono text-xs font-bold text-neo-cyan">
                  {releaseInfo.deployTarget}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  <FormattedMessage id="launch.telemetry.builtAt" defaultMessage="Built At" />
                </p>
                <p className="mt-1.5 truncate text-xs font-semibold text-slate-200">
                  {builtAtLabel}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  <FormattedMessage id="launch.telemetry.source" defaultMessage="Build Source" />
                </p>
                <p className="mt-1.5 truncate font-mono text-xs font-semibold text-slate-200">
                  {releaseInfo.source}
                </p>
              </div>
            </div>
          </div>
        </header>

        <section aria-labelledby="launch-edges-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-neo-cyan">
                <FormattedMessage id="launch.edges.eyebrow" defaultMessage="Live Storefront Topology" />
              </p>
              <h2 id="launch-edges-heading" className="mt-1 text-2xl font-black tracking-tight text-white">
                <FormattedMessage id="launch.edges.title" defaultMessage="Production Frontend Destinations" />
              </h2>
            </div>
            <p className="max-w-xl text-sm text-slate-400">
              <FormattedMessage
                id="launch.edges.subtitle"
                defaultMessage="Each distribution endpoint shares the same API gateway, authentication posture, and checkout validation contract."
              />
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {distributionEdges.map((edge) => (
              <article
                key={edge.id}
                className={cn(
                  'flex flex-col justify-between rounded-2xl border p-5 transition-colors',
                  edge.active
                    ? 'border-neo-cyan/45 bg-neo-cyan/[0.08]'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20',
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-neo-cyan">
                      <Globe2 className="h-3.5 w-3.5" />
                      {edge.platform}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        edge.active
                          ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
                          : 'border-white/10 bg-white/[0.04] text-slate-300',
                      )}
                    >
                      {edge.role}
                    </span>
                  </div>

                  <h3 className="mt-3 text-base font-black text-white">{edge.label}</h3>
                  <p className="mt-1 truncate font-mono text-xs text-cyan-200/90">{edge.originLabel}</p>
                  <p className="mt-3 text-xs leading-5 text-slate-400">{edge.description}</p>
                </div>

                <div className="mt-5 flex items-center gap-2 pt-3 border-t border-white/10">
                  {edge.href ? (
                    <a
                      href={edge.href}
                      rel="noreferrer"
                      aria-label={intl.formatMessage(launchMessages.openRuntimeAction, { label: edge.label })}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-neo-cyan/30 bg-neo-cyan/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-neo-cyan/20"
                    >
                      <FormattedMessage id="launch.targets.openStorefront" defaultMessage="Open storefront" />
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-semibold text-slate-500">
                      {edge.originLabel}
                    </span>
                  )}

                  {edge.href ? (
                    <button
                      type="button"
                      onClick={() => void handleCopyOrigin(edge)}
                      aria-label={intl.formatMessage(launchMessages.copyOriginLabel, { label: edge.label })}
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-slate-300 transition hover:border-white/25 hover:text-white"
                    >
                      {copiedTargetId === edge.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-neo-emerald" />
                          <span>{intl.formatMessage(launchMessages.copiedOriginLabel)}</span>
                        </>
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="launch-architecture-heading"
          className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-6 sm:p-8"
        >
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div>
              <p className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-neo-emerald">
                <Layers className="h-3.5 w-3.5" />
                <FormattedMessage id="launch.architecture.eyebrow" defaultMessage="System Showcase" />
              </p>
              <h2 id="launch-architecture-heading" className="mt-1 text-2xl font-black tracking-tight text-white">
                <FormattedMessage id="launch.architecture.title" defaultMessage="Interactive Platform Capabilities" />
              </h2>
            </div>

            <div className="flex flex-wrap gap-2" role="tablist" aria-label={intl.formatMessage({
              id: 'launch.architecture.tablistAria',
              defaultMessage: 'Platform capability views',
            })}>
              {ARCHITECTURE_PILLARS.map((pillar) => {
                const PillarIcon = pillar.icon;
                const isSelected = pillar.id === activePillar.id;
                return (
                  <button
                    key={pillar.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedPillarId(pillar.id)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition',
                      isSelected
                        ? 'border-neo-cyan/50 bg-neo-cyan/15 text-cyan-100'
                        : 'border-white/10 bg-zinc-950/60 text-slate-300 hover:border-white/25 hover:text-white',
                    )}
                  >
                    <PillarIcon className="h-3.5 w-3.5" />
                    <span>{intl.formatMessage(pillar.titleMessage)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1 text-xs font-bold text-neo-cyan">
                <ActiveIcon className="h-4 w-4" />
                <span>{intl.formatMessage(activePillar.tagMessage)}</span>
              </div>
              <h3 className="text-2xl font-black text-white">
                {intl.formatMessage(activePillar.titleMessage)}
              </h3>
              <p className="text-sm leading-6 text-slate-300">
                {intl.formatMessage(activePillar.summaryMessage)}
              </p>

              <ul className="space-y-2.5 pt-1">
                {activePillar.pointMessages.map((pointMessage) => (
                  <li
                    key={pointMessage.id}
                    className="flex items-start gap-2.5 text-sm text-slate-200"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-neo-emerald" />
                    <span>{intl.formatMessage(pointMessage)}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-2">
                <Link
                  to={activePillar.route}
                  className="inline-flex items-center gap-2 rounded-xl border border-neo-cyan/40 bg-neo-cyan/15 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-cyan-100 transition hover:bg-neo-cyan/25"
                >
                  <span>{intl.formatMessage(activePillar.ctaMessage)}</span>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-300">
                  <Terminal className="h-4 w-4 text-neo-cyan" />
                  <FormattedMessage id="launch.contract.heading" defaultMessage="Verified Runtime Contract" />
                </span>
                <span className="font-mono text-[11px] text-neo-emerald">{activePillar.surfacePath}</span>
              </div>

              <div className="space-y-2.5">
                {RUNTIME_CONTRACTS.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs font-semibold text-slate-200"
                  >
                    <span>{intl.formatMessage(item.message)}</span>
                    <Server className="h-3.5 w-3.5 shrink-0 text-neo-cyan" />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-400">
                <a
                  href="https://github.com/MdSaifulIslamMSI/Aura/releases"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-cyan-200 hover:text-cyan-100"
                >
                  <FormattedMessage id="launch.releases.link" defaultMessage="Desktop & Mobile Releases" />
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
                <Link
                  to="/marketplace"
                  className="inline-flex items-center gap-1.5 font-semibold text-slate-300 hover:text-white"
                >
                  <FormattedMessage id="launch.marketplace.link" defaultMessage="Explore Marketplace" />
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
