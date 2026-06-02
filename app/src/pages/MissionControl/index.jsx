import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Camera, Loader2, Radar, ShieldCheck, Sparkles, Target } from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { productApi, listingApi } from '@/services/api';
import { CATALOG_CATEGORY_OPTIONS, getCategoryApiValue, getLocalizedCategoryLabel, normalizeCategorySlug } from '@/config/catalogTaxonomy';
import { formatPrice } from '@/utils/format';
import { formatBasePrice, formatEntityPrice } from '@/utils/pricing';
import {
  buildLifecycleIntelligence,
  buildListingSafetyLens,
  buildMarketplaceSafetySummary,
  buildMissionPlan,
  buildProductTrustGraph,
} from '@/utils/commerceIntelligence';

import { StableText } from '@/i18n/StableText';
const QUICK_MISSIONS = [
  { labelDefault: 'Gaming Setup', labelId: 'missionControl.quickMission.gamingSetup', goal: 'gaming setup under Rs 80000', category: 'gaming', budget: 80000 },
  { labelDefault: 'Creator Desk', labelId: 'missionControl.quickMission.creatorDesk', goal: 'creator studio desk refresh', category: 'electronics', budget: 120000 },
  { labelDefault: 'Phone Upgrade', labelId: 'missionControl.quickMission.phoneUpgrade', goal: 'premium phone upgrade', category: 'mobiles', budget: 70000 },
  { labelDefault: 'Smart Home', labelId: 'missionControl.quickMission.smartHome', goal: 'first apartment smart essentials', category: 'home-kitchen', budget: 45000 },
];

const clampBudget = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50000;
  return Math.max(5000, Math.min(250000, Math.round(parsed)));
};

const toneClasses = {
  emerald: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100',
  cyan: 'border-cyan-300/35 bg-cyan-500/10 text-cyan-100',
  amber: 'border-amber-300/35 bg-amber-500/10 text-amber-100',
  rose: 'border-rose-300/35 bg-rose-500/10 text-rose-100',
};

export default function MissionControl() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t: legacyT } = useMarket();
  const t = useStableIcuMessages(legacyT);
  const autoRunRef = useRef(false);
  const [form, setForm] = useState(() => ({
    goal: searchParams.get('goal') || searchParams.get('theme') || 'gaming setup under Rs 80000',
    category: normalizeCategorySlug(searchParams.get('category') || searchParams.get('theme') || '') || 'gaming',
    budget: clampBudget(searchParams.get('budget') || 80000),
    city: searchParams.get('city') || '',
    deadline: searchParams.get('deadline') || '',
    hints: searchParams.get('hints') || '',
    imageUrl: searchParams.get('imageUrl') || '',
    needsTradeIn: searchParams.get('tradeIn') === 'true',
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState({ products: [], bundle: null, listings: [], hotspots: [] });
  const [missionRan, setMissionRan] = useState(false);

  const updateForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const launchVisualSearch = () => {
    const params = new URLSearchParams();
    if (String(form.imageUrl || '').trim()) params.set('imageUrl', String(form.imageUrl || '').trim());
    params.set('hints', String(form.hints || form.goal || '').trim());
    navigate(`/visual-search?${params.toString()}`);
  };

  const runMission = async (event) => {
    event?.preventDefault?.();
    const categorySlug = normalizeCategorySlug(form.category || '');
    const apiCategory = categorySlug ? getCategoryApiValue(categorySlug) : '';
    const missionGoal = String(form.goal || '').trim() || String(form.hints || '').trim() || 'smart essentials';
    const budget = clampBudget(form.budget);

    setLoading(true);
    setError('');
    try {
      const [productsResult, bundleResult, listingsResult, hotspotsResult] = await Promise.allSettled([
        productApi.getProducts({
          keyword: String(form.hints || '').trim() || missionGoal,
          category: apiCategory || undefined,
          sort: 'relevance',
          limit: 6,
          includeMeta: false,
          includeTelemetry: false,
        }),
        productApi.buildSmartBundle({ theme: missionGoal, budget, maxItems: 5 }),
        listingApi.getListings({
          category: apiCategory || undefined,
          city: String(form.city || '').trim() || undefined,
          sort: 'newest',
          page: 1,
        }),
        listingApi.getHotspots({
          category: apiCategory || undefined,
          city: String(form.city || '').trim() || undefined,
          limit: 4,
          windowDays: 21,
        }),
      ]);

      setResults({
        products: productsResult.status === 'fulfilled' ? (productsResult.value?.products || []) : [],
        bundle: bundleResult.status === 'fulfilled' ? bundleResult.value : null,
        listings: listingsResult.status === 'fulfilled' ? (listingsResult.value?.listings || []).slice(0, 4) : [],
        hotspots: hotspotsResult.status === 'fulfilled' ? (hotspotsResult.value?.hotspots || []) : [],
      });
      setMissionRan(true);

      const nextParams = new URLSearchParams();
      nextParams.set('goal', missionGoal);
      nextParams.set('budget', String(budget));
      if (categorySlug) nextParams.set('category', categorySlug);
      if (form.city) nextParams.set('city', form.city);
      if (form.deadline) nextParams.set('deadline', form.deadline);
      if (form.hints) nextParams.set('hints', form.hints);
      if (form.imageUrl) nextParams.set('imageUrl', form.imageUrl);
      if (form.needsTradeIn) nextParams.set('tradeIn', 'true');
      setSearchParams(nextParams, { replace: true });
    } catch (missionError) {
      setError(missionError?.message || 'Mission execution failed.');
      setMissionRan(true);
      setResults({ products: [], bundle: null, listings: [], hotspots: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoRunRef.current) return;
    autoRunRef.current = true;
    if (searchParams.get('goal') || searchParams.get('theme') || searchParams.get('category') || searchParams.get('hints')) {
      runMission();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidateDeck = useMemo(() => results.products.map((product) => ({
    product,
    trust: buildProductTrustGraph({ product }),
    lifecycle: buildLifecycleIntelligence({ product }),
  })).sort((left, right) => right.trust.overallScore - left.trust.overallScore), [results.products]);

  const hotspotMap = useMemo(() => new Map(results.hotspots.map((hotspot) => [
    `${String(hotspot?.city || '').toLowerCase()}::${String(hotspot?.category || '').toLowerCase()}`,
    hotspot,
  ])), [results.hotspots]);

  const marketplaceDeck = useMemo(() => results.listings.map((listing) => {
    const hotspot = hotspotMap.get(
      `${String(listing?.location?.city || '').toLowerCase()}::${String(listing?.category || '').toLowerCase()}`,
    ) || null;
    return { listing, safety: buildListingSafetyLens({ listing, hotspot }) };
  }), [results.listings, hotspotMap]);

  const missionPlan = useMemo(() => buildMissionPlan({
    goal: form.goal,
    budget: form.budget,
    deadline: form.deadline,
    needsTradeIn: form.needsTradeIn,
    candidates: candidateDeck,
    bundle: results.bundle,
    marketplaceListings: results.listings,
  }), [candidateDeck, form.budget, form.deadline, form.goal, form.needsTradeIn, results.bundle, results.listings]);

  const marketplaceSummary = useMemo(() => buildMarketplaceSafetySummary({
    listings: results.listings,
    hotspots: results.hotspots,
    city: form.city,
  }), [form.city, results.hotspots, results.listings]);
  const missionDynamicTexts = useMemo(() => ([
    ...QUICK_MISSIONS.map((mission) => mission.goal),
    ...candidateDeck.flatMap(({ product, trust, lifecycle }) => [
      product?.title,
      trust?.headline,
      ...(Array.isArray(trust?.metrics) ? trust.metrics.flatMap((metric) => [metric?.label, metric?.insight]) : []),
      ...(Array.isArray(trust?.watchouts) ? trust.watchouts : []),
      ...(Array.isArray(trust?.strengths) ? trust.strengths : []),
      lifecycle?.upgradeWindow,
      lifecycle?.nextBestAction?.label,
      lifecycle?.nextBestAction?.reason,
      ...(Array.isArray(lifecycle?.milestones) ? lifecycle.milestones : []),
    ]),
    ...(Array.isArray(results?.bundle?.items) ? results.bundle.items.map((item) => item?.title) : []),
    ...marketplaceDeck.flatMap(({ listing, safety }) => [
      listing?.title,
      ...(Array.isArray(safety?.highlights) ? safety.highlights : []),
      ...(Array.isArray(safety?.watchouts) ? safety.watchouts : []),
    ]),
    marketplaceSummary?.meetupBrief,
    ...(Array.isArray(missionPlan?.keyMoves) ? missionPlan.keyMoves : []),
    ...(Array.isArray(missionPlan?.nextActions) ? missionPlan.nextActions.map((action) => action?.label) : []),
    error,
  ]), [candidateDeck, error, marketplaceDeck, marketplaceSummary?.meetupBrief, missionPlan?.keyMoves, missionPlan?.nextActions, results?.bundle?.items]);
  const { translateText: translateMissionText } = useDynamicTranslations(missionDynamicTexts);
  const translatedCandidateDeck = useMemo(() => (
    candidateDeck.map(({ product, trust, lifecycle }) => ({
      product: {
        ...product,
        title: translateMissionText(product?.title) || product?.title,
      },
      trust: {
        ...trust,
        headline: translateMissionText(trust?.headline) || trust?.headline,
        metrics: Array.isArray(trust?.metrics)
          ? trust.metrics.map((metric) => ({
            ...metric,
            label: translateMissionText(metric?.label) || metric?.label,
            insight: translateMissionText(metric?.insight) || metric?.insight,
          }))
          : [],
        strengths: Array.isArray(trust?.strengths) ? trust.strengths.map((item) => translateMissionText(item) || item) : [],
        watchouts: Array.isArray(trust?.watchouts) ? trust.watchouts.map((item) => translateMissionText(item) || item) : [],
      },
      lifecycle: {
        ...lifecycle,
        upgradeWindow: translateMissionText(lifecycle?.upgradeWindow) || lifecycle?.upgradeWindow,
        nextBestAction: lifecycle?.nextBestAction
          ? {
            ...lifecycle.nextBestAction,
            label: translateMissionText(lifecycle.nextBestAction.label) || lifecycle.nextBestAction.label,
            reason: translateMissionText(lifecycle.nextBestAction.reason) || lifecycle.nextBestAction.reason,
          }
          : lifecycle?.nextBestAction,
      },
    }))
  ), [candidateDeck, translateMissionText]);
  const translatedMarketplaceDeck = useMemo(() => (
    marketplaceDeck.map(({ listing, safety }) => ({
      listing: {
        ...listing,
        title: translateMissionText(listing?.title) || listing?.title,
      },
      safety: {
        ...safety,
        highlights: Array.isArray(safety?.highlights) ? safety.highlights.map((item) => translateMissionText(item) || item) : [],
        watchouts: Array.isArray(safety?.watchouts) ? safety.watchouts.map((item) => translateMissionText(item) || item) : [],
      },
    }))
  ), [marketplaceDeck, translateMissionText]);
  const translatedMissionPlan = useMemo(() => ({
    ...missionPlan,
    keyMoves: Array.isArray(missionPlan?.keyMoves) ? missionPlan.keyMoves.map((item) => translateMissionText(item) || item) : [],
    nextActions: Array.isArray(missionPlan?.nextActions)
      ? missionPlan.nextActions.map((action) => ({
        ...action,
        label: translateMissionText(action?.label) || action?.label,
      }))
      : [],
  }), [missionPlan, translateMissionText]);
  const translatedMarketplaceSummary = useMemo(() => ({
    ...marketplaceSummary,
    meetupBrief: translateMissionText(marketplaceSummary?.meetupBrief) || marketplaceSummary?.meetupBrief,
  }), [marketplaceSummary, translateMissionText]);
  const translatedBundleItems = useMemo(() => (
    Array.isArray(results?.bundle?.items)
      ? results.bundle.items.map((item) => ({
        ...item,
        title: translateMissionText(item?.title) || item?.title,
      }))
      : []
  ), [results?.bundle?.items, translateMissionText]);

  const comparePath = translatedMissionPlan.compareIds.length >= 2 ? `/compare?ids=${translatedMissionPlan.compareIds.join(',')}` : '/compare';

  return (
    <div className="mission-control-theme-shell min-h-screen bg-[#04060f] pb-16 text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-8%] top-[10%] h-[420px] w-[420px] rounded-full bg-cyan-500/14 blur-3xl" />
        <div className="absolute right-[-10%] top-[18%] h-[460px] w-[460px] rounded-full bg-emerald-500/12 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8">
        <section className="rounded-[2rem] border border-cyan-300/20 bg-gradient-to-r from-cyan-500/12 via-slate-950/80 to-emerald-500/12 p-6 shadow-[0_0_60px_rgba(34,211,238,0.08)] md:p-8">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-100">{<StableText id={"common.jsx.expression.shopping.mission.os.2ace800b"} defaultMessage={"Shopping Mission OS"} />}</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white md:text-5xl">{<StableText id={"common.jsx.expression.run.all.five.commerce.systems.in.one.308b004f"} defaultMessage={"Run all five commerce systems in one place."} />}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">{<StableText id={"product.jsx.expression.describe.the.goal.once.the.page.ranks.d0ef4b16"} defaultMessage={"Describe the goal once. The page ranks products, checks trust, opens zero-query paths, estimates lifecycle leverage, and scans local marketplace safety."} />}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {QUICK_MISSIONS.map((preset) => (
              <button key={preset.labelId} type="button" onClick={() => setForm((prev) => ({ ...prev, goal: preset.goal, category: preset.category, budget: preset.budget }))} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-300/35 hover:text-cyan-100">
                <StableText id={preset.labelId} defaultMessage={preset.labelDefault} />
              </button>
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <form onSubmit={runMission} className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
            <div className="mb-5 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-cyan-100"><Radar className="h-4 w-4" /> {<StableText id={"common.jsx.expression.mission.input.abcc1e40"} defaultMessage={"Mission Input"} />}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <textarea value={form.goal} onChange={(event) => updateForm('goal', event.target.value)} rows={3} className="md:col-span-2 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" placeholder={<StableText id={"common.jsx.expression.example.build.a.gaming.setup.under.rs.09e19f88"} defaultMessage={"Example: Build a gaming setup under Rs 80k before Friday."} />} />
              <PremiumSelect value={form.category} onChange={(event) => updateForm('category', event.target.value)} className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none focus:border-cyan-300/35">
                {CATALOG_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{getLocalizedCategoryLabel(option.value, t) || option.label}</option>)}
              </PremiumSelect>
              <input type="number" min={5000} max={250000} step={1000} value={form.budget} onChange={(event) => updateForm('budget', clampBudget(event.target.value))} className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none focus:border-cyan-300/35" />
              <input type="text" value={form.city} onChange={(event) => updateForm('city', event.target.value)} placeholder={t('missionControl.form.cityPlaceholder', {}, 'City')} className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" />
              <input type="date" value={form.deadline} onChange={(event) => updateForm('deadline', event.target.value)} className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none focus:border-cyan-300/35" />
              <input type="text" value={form.hints} onChange={(event) => updateForm('hints', event.target.value)} placeholder={<StableText id={"common.jsx.expression.screenshot.hint.owned.device.favorite.brand.c00d0b60"} defaultMessage={"Screenshot hint, owned device, favorite brand"} />} className="md:col-span-2 h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" />
              <input type="url" value={form.imageUrl} onChange={(event) => updateForm('imageUrl', event.target.value)} placeholder={<StableText id={"search.jsx.expression.optional.image.url.for.visual.search.3b28096f"} defaultMessage={"Optional image URL for visual search"} />} className="md:col-span-2 h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" />
            </div>
            <label className="mt-4 inline-flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              <input type="checkbox" checked={form.needsTradeIn} onChange={(event) => updateForm('needsTradeIn', event.target.checked)} className="h-4 w-4 rounded border-emerald-300/40 bg-transparent text-emerald-300" />
              {<StableText id={"common.jsx.expression.include.trade.in.and.upgrade.path.fb12dbda"} defaultMessage={"Include trade-in and upgrade path."} />}
            </label>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/35 bg-cyan-500/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                {loading ? <StableText id={"common.jsx.expression.running.mission.b966f27a"} defaultMessage={"Running mission"} /> : <StableText id={"common.jsx.expression.run.mission.412569d0"} defaultMessage={"Run mission"} />}
              </button>
              <button type="button" onClick={launchVisualSearch} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-200 transition hover:border-emerald-400/35 hover:text-emerald-200">
                <Camera className="h-4 w-4" />
                {<StableText id={"common.jsx.expression.start.from.screenshot.e2ba722e"} defaultMessage={"Start from screenshot"} />}
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
            <div className="mb-5 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-emerald-100"><Sparkles className="h-4 w-4" /> {<StableText id={"common.jsx.expression.zero.query.entry.f4765066"} defaultMessage={"Zero-Query Entry"} />}</div>
            <div className="space-y-4 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">{<StableText id={"product.jsx.expression.use.screenshot.or.pasted.image.when.you.4ebb4c79"} defaultMessage={"Use screenshot or pasted image when you do not know product names yet."} />}</div>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">{<StableText id={"common.jsx.expression.describe.the.mission.instead.of.specific.skus.1490bce5"} defaultMessage={"Describe the mission instead of specific SKUs to get trust-ranked candidates and bundles."} />}</div>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4"><StableText id={"missionControl.zeroQuery.tradeInLeverage"} defaultMessage={"Turn on trade-in to expose upgrade leverage before checkout or price alerts."} /></div>
              <Link to="/trade-in" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-100">{<StableText id={"common.jsx.expression.open.trade.in.lane.e123c7df"} defaultMessage={"Open trade-in lane"} />} <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </section>
        </div>

        {missionRan && (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{<StableText id={"common.jsx.expression.mission.readiness.6e520e73"} defaultMessage={"Mission readiness"} />}</p><p className="mt-3 text-3xl font-black text-white">{translatedMissionPlan.readinessScore}</p></article>
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{<StableText id={"common.jsx.expression.top.trust.a860cd2c"} defaultMessage={"Top trust"} />}</p><p className="mt-3 text-3xl font-black text-white">{translatedCandidateDeck[0]?.trust?.overallScore || 0}</p></article>
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{<StableText id={"common.jsx.expression.bundle.total.8f9879d5"} defaultMessage={"Bundle total"} />}</p><p className="mt-3 text-3xl font-black text-white">{formatBasePrice(formatPrice, results.bundle?.totalPrice || 0)}</p></article>
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{<StableText id={"common.jsx.expression.local.safety.2f828dea"} defaultMessage={"Local safety"} />}</p><p className="mt-3 text-3xl font-black text-white">{translatedMarketplaceSummary.averageSafety || 0}</p></article>
            </section>

            <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
              <div className="flex flex-wrap gap-2">
                {translatedMissionPlan.nextActions.map((action) => <Link key={action.label} to={action.path} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:border-cyan-300/35 hover:text-cyan-100">{action.label}</Link>)}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {translatedMissionPlan.keyMoves.map((move) => <div key={move} className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4 text-sm leading-7 text-slate-300">{move}</div>)}
              </div>
            </section>

            {error && <div className="mt-6 rounded-3xl border border-rose-300/35 bg-rose-500/10 px-5 py-4 text-sm font-semibold text-rose-100">{translateMissionText(error) || error}</div>}

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div><p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100"><StableText id={"missionControl.trustGraph"} defaultMessage={"Trust Graph"} /></p><h2 className="mt-2 text-2xl font-black text-white">{<StableText id={"common.jsx.expression.primary.candidates.93dc7e36"} defaultMessage={"Primary candidates"} />}</h2></div>
                  <Link to={comparePath} className="text-sm font-bold text-cyan-100">{<StableText id={"common.jsx.expression.open.compare.09410d00"} defaultMessage={"Open compare"} />} <ArrowRight className="ml-1 inline h-4 w-4" /></Link>
                </div>
                <div className="space-y-4">
                  {translatedCandidateDeck.slice(0, 3).map(({ product, trust, lifecycle }) => (
                    <article key={product.id || product._id} className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row">
                        <img src={product.image} alt={product.title} className="h-32 w-full rounded-2xl bg-zinc-900/70 object-contain p-3 lg:w-32" />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{product.brand} | {getLocalizedCategoryLabel(product.category, t) || product.category}</p>
                              <h3 className="mt-1 text-lg font-black text-white">{product.title}</h3>
                              <p className="mt-2 text-sm text-slate-400">{trust.headline}</p>
                            </div>
                            <div className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em] ${toneClasses[trust.tone] || toneClasses.cyan}`}><StableText id={"missionControl.trustScore"} defaultMessage={"Trust {overallScore}"} values={{ overallScore: trust.overallScore }} /></div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {trust.metrics.slice(0, 4).map((metric) => (
                              <div key={metric.key} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                                <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{metric.label}</span><span className="text-sm font-black text-white">{metric.score}</span></div>
                                <p className="mt-1 text-xs text-slate-400">{metric.insight}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-slate-200">
                            {lifecycle.upgradeWindow}. <StableText id={"missionControl.lifecycle.tradeInResaleBand"} defaultMessage={"Trade-in estimate {tradeInEstimate} and resale band {resaleLow} - {resaleHigh}."} values={{
                              resaleHigh: formatBasePrice(formatPrice, lifecycle.resaleHigh),
                              resaleLow: formatBasePrice(formatPrice, lifecycle.resaleLow),
                              tradeInEstimate: formatBasePrice(formatPrice, lifecycle.tradeInEstimate),
                            }} />
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link to={`/product/${product.id || product._id}`} className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-100">{<StableText id={"product.jsx.expression.open.product.2c5aa835"} defaultMessage={"Open product"} />}</Link>
                            <Link to={lifecycle.nextBestAction.path} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">{lifecycle.nextBestAction.label}</Link>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {translatedCandidateDeck.length === 0 && <div className="rounded-2xl border border-white/10 bg-zinc-950/45 px-4 py-8 text-center text-sm text-slate-400">{<StableText id={"product.jsx.expression.no.product.lane.matched.the.current.mission.951f6696"} defaultMessage={"No product lane matched the current mission yet."} />}</div>}
                </div>
              </section>

              <div className="space-y-6">
                <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100">{<StableText id={"common.jsx.expression.bundle.and.lifecycle.e498118c"} defaultMessage={"Bundle and lifecycle"} />}</p>
                  <div className="mt-4 space-y-3">
                    {translatedBundleItems.slice(0, 4).map((item) => (
                      <Link key={item.id || item._id} to={`/product/${item.id || item._id}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950/45 p-3">
                        <img src={item.image} alt={item.title} className="h-14 w-14 rounded-xl bg-zinc-900/70 object-cover" />
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-white">{item.title}</p><p className="text-xs text-slate-400">{item.brand} | {formatEntityPrice(formatPrice, item)}</p></div>
                      </Link>
                    ))}
                    {!translatedBundleItems.length && <div className="rounded-2xl border border-white/10 bg-zinc-950/45 px-4 py-8 text-center text-sm text-slate-400"><StableText id={"missionControl.bundle.empty"} defaultMessage={"Bundle generation did not return a stack for this mission yet."} /></div>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/bundles?theme=${encodeURIComponent(form.goal)}&budget=${encodeURIComponent(String(form.budget))}`} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-100">{<StableText id={"common.jsx.expression.open.bundle.lane.4a8b5a5a"} defaultMessage={"Open bundle lane"} />}</Link>
                    {form.needsTradeIn && <Link to="/trade-in" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">{<StableText id={"common.jsx.expression.use.trade.in.5b0ad95d"} defaultMessage={"Use trade-in"} />}</Link>}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100"><StableText id={"missionControl.localSafety.title"} defaultMessage={"Local commerce safety mode"} /></p>
                  <p className="mt-3 text-sm text-slate-400">{translatedMarketplaceSummary.meetupBrief}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-3"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400"><StableText id={"missionControl.localSafety.escrowCoverage"} defaultMessage={"Escrow coverage"} /></p><p className="mt-2 text-2xl font-black text-white">{translatedMarketplaceSummary.escrowCoverage || 0}%</p></div>
                    <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-3"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400"><StableText id={"missionControl.localSafety.verifiedSellers"} defaultMessage={"Verified sellers"} /></p><p className="mt-2 text-2xl font-black text-white">{translatedMarketplaceSummary.verifiedSellerRate || 0}%</p></div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {translatedMarketplaceDeck.map(({ listing, safety }) => (
                      <Link key={listing._id} to={`/listing/${listing._id}`} className="block rounded-2xl border border-white/10 bg-zinc-950/45 p-3">
                        <div className="flex gap-3">
                          <img src={listing.images?.[0] || '/placeholder.png'} alt={listing.title} className="h-20 w-20 rounded-2xl object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div><p className="truncate text-sm font-bold text-white">{listing.title}</p><p className="text-xs text-slate-400">{listing.location?.city || <StableText id={"missionControl.marketplace.unknownCity"} defaultMessage={"Unknown city"} />} | {listing.seller?.name || <StableText id={"missionControl.marketplace.seller"} defaultMessage={"Seller"} />}</p></div>
                              <div className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100"><StableText id={"missionControl.safetyScore"} defaultMessage={"Safety {score}"} values={{ score: safety.score }} /></div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-black text-white">{formatEntityPrice(formatPrice, listing)}</span>
                              {listing.escrowOptIn && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-100"><ShieldCheck className="h-3 w-3" /><StableText id={"missionControl.marketplace.escrow"} defaultMessage={"Escrow"} /></span>}
                              {listing.seller?.isVerified && <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-bold text-slate-200"><StableText id={"missionControl.marketplace.verifiedSeller"} defaultMessage={"Verified seller"} /></span>}
                            </div>
                            <p className="mt-2 text-xs text-slate-400">{safety.highlights[0] || safety.watchouts[0] || <StableText id={"common.jsx.expression.review.meetup.terms.and.item.condition.before.a308652f"} defaultMessage={"Review meetup terms and item condition before paying."} />}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                    {translatedMarketplaceDeck.length === 0 && <div className="rounded-2xl border border-white/10 bg-zinc-950/45 px-4 py-8 text-center text-sm text-slate-400">{<StableText id={"seller.jsx.expression.no.nearby.listings.matched.this.mission.yet.15f73361"} defaultMessage={"No nearby listings matched this mission yet."} />}</div>}
                  </div>
                  <div className="mt-4"><Link to="/marketplace" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-100">{<StableText id={"common.jsx.expression.open.marketplace.safety.mode.c1a71f83"} defaultMessage={"Open marketplace safety mode"} />} <ArrowRight className="h-4 w-4" /></Link></div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
