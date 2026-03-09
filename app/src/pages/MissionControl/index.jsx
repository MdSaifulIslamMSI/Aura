import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Camera, Loader2, Radar, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { productApi, listingApi } from '@/services/api';
import { CATALOG_CATEGORY_OPTIONS, getCategoryApiValue, getCategoryLabel, normalizeCategorySlug } from '@/config/catalogTaxonomy';
import { formatPrice } from '@/utils/format';
import {
  buildLifecycleIntelligence,
  buildListingSafetyLens,
  buildMarketplaceSafetySummary,
  buildMissionPlan,
  buildProductTrustGraph,
} from '@/utils/commerceIntelligence';

const QUICK_MISSIONS = [
  { label: 'Gaming Setup', goal: 'gaming setup under Rs 80000', category: 'gaming', budget: 80000 },
  { label: 'Creator Desk', goal: 'creator studio desk refresh', category: 'electronics', budget: 120000 },
  { label: 'Phone Upgrade', goal: 'premium phone upgrade', category: 'mobiles', budget: 70000 },
  { label: 'Smart Home', goal: 'first apartment smart essentials', category: 'home-kitchen', budget: 45000 },
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

  const comparePath = missionPlan.compareIds.length >= 2 ? `/compare?ids=${missionPlan.compareIds.join(',')}` : '/compare';

  return (
    <div className="min-h-screen bg-[#04060f] pb-16 text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-8%] top-[10%] h-[420px] w-[420px] rounded-full bg-cyan-500/14 blur-3xl" />
        <div className="absolute right-[-10%] top-[18%] h-[460px] w-[460px] rounded-full bg-emerald-500/12 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8">
        <section className="rounded-[2rem] border border-cyan-300/20 bg-gradient-to-r from-cyan-500/12 via-slate-950/80 to-emerald-500/12 p-6 shadow-[0_0_60px_rgba(34,211,238,0.08)] md:p-8">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-100">Shopping Mission OS</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white md:text-5xl">Run all five commerce systems in one place.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">Describe the goal once. The page ranks products, checks trust, opens zero-query paths, estimates lifecycle leverage, and scans local marketplace safety.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {QUICK_MISSIONS.map((preset) => (
              <button key={preset.label} type="button" onClick={() => setForm((prev) => ({ ...prev, goal: preset.goal, category: preset.category, budget: preset.budget }))} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-300/35 hover:text-cyan-100">
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <form onSubmit={runMission} className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
            <div className="mb-5 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-cyan-100"><Radar className="h-4 w-4" /> Mission Input</div>
            <div className="grid gap-4 md:grid-cols-2">
              <textarea value={form.goal} onChange={(event) => updateForm('goal', event.target.value)} rows={3} className="md:col-span-2 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" placeholder="Example: Build a gaming setup under Rs 80k before Friday." />
              <select value={form.category} onChange={(event) => updateForm('category', event.target.value)} className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none focus:border-cyan-300/35">
                {CATALOG_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input type="number" min={5000} max={250000} step={1000} value={form.budget} onChange={(event) => updateForm('budget', clampBudget(event.target.value))} className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none focus:border-cyan-300/35" />
              <input type="text" value={form.city} onChange={(event) => updateForm('city', event.target.value)} placeholder="City" className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" />
              <input type="date" value={form.deadline} onChange={(event) => updateForm('deadline', event.target.value)} className="h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none focus:border-cyan-300/35" />
              <input type="text" value={form.hints} onChange={(event) => updateForm('hints', event.target.value)} placeholder="Screenshot hint, owned device, favorite brand" className="md:col-span-2 h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" />
              <input type="url" value={form.imageUrl} onChange={(event) => updateForm('imageUrl', event.target.value)} placeholder="Optional image URL for visual search" className="md:col-span-2 h-12 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35" />
            </div>
            <label className="mt-4 inline-flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              <input type="checkbox" checked={form.needsTradeIn} onChange={(event) => updateForm('needsTradeIn', event.target.checked)} className="h-4 w-4 rounded border-emerald-300/40 bg-transparent text-emerald-300" />
              Include trade-in and upgrade path.
            </label>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/35 bg-cyan-500/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                {loading ? 'Running mission' : 'Run mission'}
              </button>
              <button type="button" onClick={launchVisualSearch} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-200 transition hover:border-emerald-400/35 hover:text-emerald-200">
                <Camera className="h-4 w-4" />
                Start from screenshot
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
            <div className="mb-5 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-emerald-100"><Sparkles className="h-4 w-4" /> Zero-Query Entry</div>
            <div className="space-y-4 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">Use screenshot or pasted image when you do not know product names yet.</div>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">Describe the mission instead of specific SKUs to get trust-ranked candidates and bundles.</div>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">Turn on trade-in to expose upgrade leverage before checkout or price alerts.</div>
              <Link to="/trade-in" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-100">Open trade-in lane <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </section>
        </div>

        {missionRan && (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Mission readiness</p><p className="mt-3 text-3xl font-black text-white">{missionPlan.readinessScore}</p></article>
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Top trust</p><p className="mt-3 text-3xl font-black text-white">{candidateDeck[0]?.trust?.overallScore || 0}</p></article>
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Bundle total</p><p className="mt-3 text-3xl font-black text-white">{formatPrice(results.bundle?.totalPrice || 0)}</p></article>
              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-glass"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Local safety</p><p className="mt-3 text-3xl font-black text-white">{marketplaceSummary.averageSafety || 0}</p></article>
            </section>

            <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
              <div className="flex flex-wrap gap-2">
                {missionPlan.nextActions.map((action) => <Link key={action.label} to={action.path} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:border-cyan-300/35 hover:text-cyan-100">{action.label}</Link>)}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {missionPlan.keyMoves.map((move) => <div key={move} className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4 text-sm leading-7 text-slate-300">{move}</div>)}
              </div>
            </section>

            {error && <div className="mt-6 rounded-3xl border border-rose-300/35 bg-rose-500/10 px-5 py-4 text-sm font-semibold text-rose-100">{error}</div>}

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div><p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">Trust Graph</p><h2 className="mt-2 text-2xl font-black text-white">Primary candidates</h2></div>
                  <Link to={comparePath} className="text-sm font-bold text-cyan-100">Open compare <ArrowRight className="ml-1 inline h-4 w-4" /></Link>
                </div>
                <div className="space-y-4">
                  {candidateDeck.slice(0, 3).map(({ product, trust, lifecycle }) => (
                    <article key={product.id || product._id} className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row">
                        <img src={product.image} alt={product.title} className="h-32 w-full rounded-2xl bg-zinc-900/70 object-contain p-3 lg:w-32" />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{product.brand} | {getCategoryLabel(product.category)}</p>
                              <h3 className="mt-1 text-lg font-black text-white">{product.title}</h3>
                              <p className="mt-2 text-sm text-slate-400">{trust.headline}</p>
                            </div>
                            <div className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em] ${toneClasses[trust.tone] || toneClasses.cyan}`}>Trust {trust.overallScore}</div>
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
                            {lifecycle.upgradeWindow}. Trade-in estimate {formatPrice(lifecycle.tradeInEstimate)} and resale band {formatPrice(lifecycle.resaleLow)} - {formatPrice(lifecycle.resaleHigh)}.
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link to={`/product/${product.id || product._id}`} className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-100">Open product</Link>
                            <Link to={lifecycle.nextBestAction.path} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">{lifecycle.nextBestAction.label}</Link>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {candidateDeck.length === 0 && <div className="rounded-2xl border border-white/10 bg-zinc-950/45 px-4 py-8 text-center text-sm text-slate-400">No product lane matched the current mission yet.</div>}
                </div>
              </section>

              <div className="space-y-6">
                <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100">Bundle and lifecycle</p>
                  <div className="mt-4 space-y-3">
                    {(results.bundle?.items || []).slice(0, 4).map((item) => (
                      <Link key={item.id || item._id} to={`/product/${item.id || item._id}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950/45 p-3">
                        <img src={item.image} alt={item.title} className="h-14 w-14 rounded-xl bg-zinc-900/70 object-cover" />
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-white">{item.title}</p><p className="text-xs text-slate-400">{item.brand} | {formatPrice(item.price)}</p></div>
                      </Link>
                    ))}
                    {!results.bundle?.items?.length && <div className="rounded-2xl border border-white/10 bg-zinc-950/45 px-4 py-8 text-center text-sm text-slate-400">Bundle generation did not return a stack for this mission yet.</div>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/bundles?theme=${encodeURIComponent(form.goal)}&budget=${encodeURIComponent(String(form.budget))}`} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-100">Open bundle lane</Link>
                    {form.needsTradeIn && <Link to="/trade-in" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">Use trade-in</Link>}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-glass">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">Local commerce safety mode</p>
                  <p className="mt-3 text-sm text-slate-400">{marketplaceSummary.meetupBrief}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-3"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Escrow coverage</p><p className="mt-2 text-2xl font-black text-white">{marketplaceSummary.escrowCoverage || 0}%</p></div>
                    <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-3"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Verified sellers</p><p className="mt-2 text-2xl font-black text-white">{marketplaceSummary.verifiedSellerRate || 0}%</p></div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {marketplaceDeck.map(({ listing, safety }) => (
                      <Link key={listing._id} to={`/listing/${listing._id}`} className="block rounded-2xl border border-white/10 bg-zinc-950/45 p-3">
                        <div className="flex gap-3">
                          <img src={listing.images?.[0] || '/placeholder.png'} alt={listing.title} className="h-20 w-20 rounded-2xl object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div><p className="truncate text-sm font-bold text-white">{listing.title}</p><p className="text-xs text-slate-400">{listing.location?.city || 'Unknown city'} | {listing.seller?.name || 'Seller'}</p></div>
                              <div className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">Safety {safety.score}</div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-black text-white">{formatPrice(listing.price || 0)}</span>
                              {listing.escrowOptIn && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-100"><ShieldCheck className="h-3 w-3" />Escrow</span>}
                              {listing.seller?.isVerified && <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-bold text-slate-200">Verified seller</span>}
                            </div>
                            <p className="mt-2 text-xs text-slate-400">{safety.highlights[0] || safety.watchouts[0] || 'Review meetup terms and item condition before paying.'}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                    {marketplaceDeck.length === 0 && <div className="rounded-2xl border border-white/10 bg-zinc-950/45 px-4 py-8 text-center text-sm text-slate-400">No nearby listings matched this mission yet.</div>}
                  </div>
                  <div className="mt-4"><Link to="/marketplace" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-100">Open marketplace safety mode <ArrowRight className="h-4 w-4" /></Link></div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
