import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Brain, Loader2, Search, Sparkles, Trophy, X } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { productApi } from '@/services/api';
import { aiApi } from '@/services/aiApi';
import { cn } from '@/lib/utils';
import { formatEntityPrice } from '@/utils/pricing';

const MAX_COMPARE_ITEMS = 4;
const MODES = [
  { value: 'balanced', label: 'Balanced AI' },
  { value: 'budget', label: 'Budget Hunter' },
  { value: 'premium', label: 'Premium First' },
  { value: 'speed', label: 'Fast Delivery' },
];

const parseDaysFromDelivery = (deliveryTime = '') => {
  const text = String(deliveryTime || '').toLowerCase();
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const single = text.match(/(\d+)/);
  return single ? Number(single[1]) : 7;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const scoreProduct = ({ product, mode, minPrice, maxPrice, minDays, maxDays, maxReviews }) => {
  const price = Number(product.price) || 0;
  const rating = Number(product.rating) || 0;
  const discount = Number(product.discountPercentage) || 0;
  const reviews = Number(product.ratingCount) || 0;
  const stock = Number(product.stock) || 0;
  const days = parseDaysFromDelivery(product.deliveryTime);
  const hasWarranty = Boolean(String(product.warranty || '').trim());

  const safePriceRange = Math.max(1, maxPrice - minPrice);
  const priceScore = 1 - clamp((price - minPrice) / safePriceRange, 0, 1);
  const ratingScore = clamp(rating / 5, 0, 1);
  const discountScore = clamp(discount / 80, 0, 1);
  const reviewScore = clamp(reviews / Math.max(1, maxReviews), 0, 1);
  const stockScore = stock > 0 ? 1 : 0;
  const safeDayRange = Math.max(1, maxDays - minDays);
  const deliveryScore = 1 - clamp((days - minDays) / safeDayRange, 0, 1);
  const warrantyScore = hasWarranty ? 1 : 0;

  const weightsByMode = {
    budget: { priceScore: 0.38, discountScore: 0.25, ratingScore: 0.17, reviewScore: 0.1, deliveryScore: 0.05, stockScore: 0.05, warrantyScore: 0 },
    premium: { ratingScore: 0.3, reviewScore: 0.2, warrantyScore: 0.18, stockScore: 0.12, deliveryScore: 0.1, priceScore: 0.05, discountScore: 0.05 },
    speed: { deliveryScore: 0.4, stockScore: 0.2, ratingScore: 0.18, reviewScore: 0.08, priceScore: 0.07, discountScore: 0.07, warrantyScore: 0 },
    balanced: { ratingScore: 0.26, priceScore: 0.2, discountScore: 0.16, reviewScore: 0.14, deliveryScore: 0.1, stockScore: 0.09, warrantyScore: 0.05 },
  };

  const weights = weightsByMode[mode] || weightsByMode.balanced;
  const metricValues = {
    priceScore,
    ratingScore,
    discountScore,
    reviewScore,
    stockScore,
    deliveryScore,
    warrantyScore,
  };
  const total = Object.entries(weights).reduce((sum, [metric, weight]) => {
    const metricValue = Number(metricValues[metric] ?? 0);
    return sum + (metricValue * weight);
  }, 0);

  return {
    totalScore: Number((total * 100).toFixed(1)),
    metrics: {
      priceScore,
      ratingScore,
      discountScore,
      reviewScore,
      stockScore,
      deliveryScore,
      warrantyScore,
    },
  };
};

const getProductId = (product) => product?.id || product?._id || '';

const AICompare = () => {
  const navigate = useNavigate();
  const { formatPrice } = useMarket();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [mode, setMode] = useState('balanced');
  const [error, setError] = useState('');
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    const idsFromQuery = (searchParams.get('ids') || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, MAX_COMPARE_ITEMS);

    if (idsFromQuery.length === 0) return;

    let active = true;
    Promise.all(idsFromQuery.map((id) => productApi.getProductById(id).catch(() => null)))
      .then((products) => {
        if (!active) return;
        const valid = products.filter(Boolean);
        setSelectedProducts(valid);
      })
      .catch(() => {
        if (active) setError('Failed to load products from compare link.');
      });

    return () => { active = false; };
  }, [searchParams]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      try {
        const result = await productApi.getProducts({ keyword: query.trim(), limit: 8, sort: 'relevance' });
        if (!active) return;
        setSuggestions(result.products || []);
      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) setSuggestionLoading(false);
      }
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const syncCompareQueryParam = (products) => {
    const ids = products.map((product) => product.id || product._id).filter(Boolean);
    if (ids.length === 0) {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ ids: ids.join(',') }, { replace: true });
  };

  const addProduct = (product) => {
    const productId = product.id || product._id;
    if (!productId) return;

    if (selectedProducts.some((entry) => (entry.id || entry._id) === productId)) {
      setQuery('');
      setSuggestions([]);
      return;
    }

    if (selectedProducts.length >= MAX_COMPARE_ITEMS) {
      setError(`You can compare up to ${MAX_COMPARE_ITEMS} products.`);
      return;
    }

    const next = [...selectedProducts, product];
    setSelectedProducts(next);
    syncCompareQueryParam(next);
    setQuery('');
    setSuggestions([]);
    setError('');
  };

  const removeProduct = (id) => {
    const next = selectedProducts.filter((product) => (product.id || product._id) !== id);
    setSelectedProducts(next);
    syncCompareQueryParam(next);
  };

  const compareData = useMemo(() => {
    if (selectedProducts.length === 0) return [];

    const prices = selectedProducts.map((product) => Number(product.price) || 0);
    const days = selectedProducts.map((product) => parseDaysFromDelivery(product.deliveryTime));
    const reviews = selectedProducts.map((product) => Number(product.ratingCount) || 0);

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const minDays = Math.min(...days);
    const maxDays = Math.max(...days);
    const maxReviews = Math.max(...reviews, 1);

    return selectedProducts.map((product) => {
      const score = scoreProduct({ product, mode, minPrice, maxPrice, minDays, maxDays, maxReviews });
      return { product, ...score };
    }).sort((a, b) => b.totalScore - a.totalScore);
  }, [selectedProducts, mode]);

  const winner = compareData[0] || null;

  const verdictLines = useMemo(() => {
    if (!winner) return [];
    const lines = [];
    lines.push(`${winner.product.title} leads in ${MODES.find((entry) => entry.value === mode)?.label || 'Balanced AI'} mode.`);

    const { metrics } = winner;
    if (metrics.priceScore > 0.7) lines.push('It offers strong price efficiency against other selected options.');
    if (metrics.ratingScore > 0.75) lines.push('Its rating profile is among the strongest in this set.');
    if (metrics.deliveryScore > 0.7) lines.push('Delivery speed is better than most compared products.');
    if (metrics.warrantyScore > 0.9) lines.push('Warranty coverage adds long-term confidence.');
    if (metrics.stockScore < 0.5) lines.push('Inventory risk exists. If this is urgent, consider backup options.');

    return lines.slice(0, 4);
  }, [winner, mode]);

  useEffect(() => {
    const productIds = selectedProducts
      .map((product) => getProductId(product))
      .filter(Boolean)
      .slice(0, MAX_COMPARE_ITEMS);

    if (productIds.length < 2) {
      setAiSummary(null);
      setAiError('');
      setAiLoading(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setAiLoading(true);
      setAiError('');

      try {
        const response = await aiApi.chat({
          message: `Compare these products in ${mode} mode and recommend the best grounded option.`,
          assistantMode: 'compare',
          context: {
            productIds,
            compareMode: mode,
          },
        });

        if (!active) return;
        setAiSummary(response);
      } catch (requestError) {
        if (!active) return;
        setAiSummary(null);
        setAiError(requestError.message || 'AI comparison is unavailable right now.');
      } finally {
        if (active) setAiLoading(false);
      }
    }, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, selectedProducts]);

  const aiWinnerAction = useMemo(
    () => (aiSummary?.actions || []).find((action) => action?.type === 'open_product' && action?.productId),
    [aiSummary]
  );

  return (
    <div className="container-custom max-w-7xl mx-auto px-4 py-8 min-h-screen">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-neo-cyan font-bold">Decision Engine</p>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">AI Compare Lab</h1>
          <p className="text-slate-400 mt-2">Select up to 4 products and let the engine pick the best fit.</p>
        </div>
        <Link to="/visual-search" className="btn-secondary text-xs uppercase tracking-widest">Open Visual Search</Link>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-white font-black text-sm uppercase tracking-wider mb-4">
            <Search className="w-4 h-4 text-neo-cyan" />
            Add Products
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products to compare"
              className="w-full rounded-xl border border-white/15 bg-zinc-950/70 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-neo-cyan"
            />
            {suggestionLoading && (
              <p className="text-xs text-slate-400">Scanning catalog...</p>
            )}
            {suggestions.length > 0 && (
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {suggestions.map((product) => {
                  const id = product.id || product._id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => addProduct(product)}
                      className="w-full text-left rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:border-neo-cyan/45 hover:bg-white/10 transition-colors"
                    >
                      <p className="text-sm font-bold text-white line-clamp-1">{product.title}</p>
                      <p className="text-xs text-slate-400 mt-1">{product.brand} · {formatEntityPrice(formatPrice, product)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-5">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-2">Compare Mode</p>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setMode(entry.value)}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-xs font-bold transition-colors',
                    mode === entry.value
                      ? 'border-neo-cyan/50 bg-neo-cyan/15 text-neo-cyan'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:text-white hover:border-white/20'
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-neo-rose/35 bg-neo-rose/10 px-3 py-2 text-xs text-neo-rose">
              {error}
            </div>
          )}
        </section>

        <section className="lg:col-span-8 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-neo-cyan" />
                Compare Deck
              </h2>
              <span className="text-xs text-slate-400">{selectedProducts.length}/{MAX_COMPARE_ITEMS} selected</span>
            </div>

            {selectedProducts.length === 0 ? (
              <p className="text-sm text-slate-400">Add products from the left panel to start comparing.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {selectedProducts.map((product) => {
                  const id = product.id || product._id;
                  const score = compareData.find((entry) => (entry.product.id || entry.product._id) === id);
                  return (
                    <div key={id} className="rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-white line-clamp-1">{product.title}</p>
                          <p className="text-xs text-slate-400 mt-1">{product.brand} · {product.category}</p>
                          <p className="text-xs text-neo-cyan mt-1">{formatEntityPrice(formatPrice, product)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeProduct(id)}
                          className="p-1.5 rounded-md border border-white/15 bg-white/5 text-slate-400 hover:text-neo-rose hover:border-neo-rose/40"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {score && (
                        <div className="mt-2 text-xs text-slate-300">AI score: <span className="text-white font-bold">{score.totalScore}</span></div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {winner && (
            <div className="rounded-2xl border border-neo-cyan/25 bg-neo-cyan/10 p-5">
              <div className="flex items-center gap-2 text-neo-cyan text-sm font-black uppercase tracking-wider">
                <Trophy className="w-4 h-4" />
                AI Verdict
              </div>
              <h3 className="mt-2 text-xl font-black text-white">{winner.product.title}</h3>
              <p className="text-sm text-slate-300 mt-1">Mode: {MODES.find((entry) => entry.value === mode)?.label}</p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-200">
                {verdictLines.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Brain className="w-4 h-4 text-neo-cyan mt-0.5" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selectedProducts.length >= 2 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neo-cyan font-bold">Frontier AI Layer</p>
                  <h3 className="text-lg font-black text-white mt-1">Grounded Compare Analysis</h3>
                </div>
                <span className="rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  {aiLoading ? 'Thinking' : (aiSummary?.provider || 'local')}
                </span>
              </div>

              {aiLoading && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-sm text-slate-300">
                  <Loader2 className="w-4 h-4 animate-spin text-neo-cyan" />
                  Building grounded verdict...
                </div>
              )}

              {!aiLoading && aiError && (
                <div className="mt-4 rounded-xl border border-neo-rose/35 bg-neo-rose/10 px-4 py-3 text-sm text-neo-rose">
                  {aiError}
                </div>
              )}

              {!aiLoading && !aiError && aiSummary && (
                <>
                  <p className="mt-4 text-sm leading-7 text-slate-200">{aiSummary.answer}</p>

                  {aiSummary.followUps?.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {aiSummary.followUps.map((item) => (
                        <span
                          key={item}
                          className="rounded-full border border-neo-cyan/30 bg-neo-cyan/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-neo-cyan"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}

                  {aiWinnerAction?.productId && (
                    <button
                      type="button"
                      onClick={() => navigate(`/product/${aiWinnerAction.productId}`)}
                      className="mt-4 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:border-neo-cyan/40 hover:text-neo-cyan transition-colors"
                    >
                      Open AI Winner
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {compareData.length >= 2 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 overflow-x-auto">
              <h3 className="text-sm font-black uppercase tracking-wider text-white mb-3">Spec Matrix</h3>
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-white/10">
                    <th className="py-2 pr-3">Metric</th>
                    {compareData.map((entry) => (
                      <th key={entry.product.id || entry.product._id} className="py-2 pr-3 text-white">{entry.product.title.slice(0, 24)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[['Price', (p) => formatEntityPrice(formatPrice, p)], ['Rating', (p) => `${p.rating || 0}/5`], ['Reviews', (p) => (p.ratingCount || 0).toLocaleString('en-IN')], ['Discount', (p) => `${p.discountPercentage || 0}%`], ['Delivery', (p) => p.deliveryTime || 'N/A'], ['Stock', (p) => (p.stock > 0 ? 'In Stock' : 'Out of Stock')], ['Warranty', (p) => (p.warranty ? 'Yes' : 'No')], ['AI Score', (p, row) => `${row.totalScore}`]].map(([label, formatter]) => (
                    <tr key={label} className="border-b border-white/5 last:border-b-0">
                      <td className="py-2 pr-3 text-slate-300 font-semibold">{label}</td>
                      {compareData.map((entry) => (
                        <td key={`${entry.product.id || entry.product._id}-${label}`} className="py-2 pr-3 text-white">
                          {formatter(entry.product, entry)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AICompare;


