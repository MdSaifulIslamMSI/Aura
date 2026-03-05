import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Filter,
  ListFilter,
  Search,
  ShieldCheck,
  Star,
  Tag,
  Truck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_MAX_PRICE = 200000;
const REVIEW_OPTIONS = [0, 100, 500, 1000, 5000];
const DISCOUNT_QUICK_OPTIONS = [0, 10, 20, 30, 40, 50];
const RATING_OPTIONS = [4, 3, 2, 1, 0];
const PRICE_CEILING_OPTIONS = [5000, 10000, 25000, 50000, 100000, 200000];
const DELIVERY_WINDOWS = ['1-2 days', '2-3 days', '3-5 days', '5-7 days', '7+ days'];

const uniqueStrings = (items = []) => {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map((item) => `${item || ''}`.trim()).filter(Boolean))];
};

const clamp = (value, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(Math.max(num, min), max);
};

const sanitizeFilters = (raw = {}) => {
  const availableBrands = uniqueStrings(raw.availableBrands);
  const availableCategories = uniqueStrings(raw.availableCategories);
  const ceiling = Number.isFinite(Number(raw?.priceRange?.[1]))
    ? Math.max(Number(raw.priceRange[1]), DEFAULT_MAX_PRICE)
    : DEFAULT_MAX_PRICE;

  const min = clamp(raw?.priceRange?.[0] ?? 0, 0, ceiling);
  const maxCandidate = clamp(raw?.priceRange?.[1] ?? ceiling, 0, ceiling);
  const max = Math.max(min, maxCandidate);

  return {
    priceRange: [min, max],
    brands: uniqueStrings(raw.brands),
    categories: uniqueStrings(raw.categories),
    minRating: clamp(raw.minRating ?? 0, 0, 5),
    minDiscount: clamp(raw.minDiscount ?? 0, 0, 90),
    inStockOnly: Boolean(raw.inStockOnly),
    warrantyOnly: Boolean(raw.warrantyOnly),
    minReviews: Math.max(0, Number(raw.minReviews) || 0),
    deliveryWindows: uniqueStrings(raw.deliveryWindows).filter((entry) => DELIVERY_WINDOWS.includes(entry)),
    availableBrands,
    availableCategories,
  };
};

const formatPrice = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;

const Filters = ({ filters, onFilterChange, className, closeMobile }) => {
  const [expandedSections, setExpandedSections] = useState({
    price: true,
    category: true,
    brand: true,
    quality: true,
    fulfillment: true,
  });
  const [brandQuery, setBrandQuery] = useState('');
  const [draft, setDraft] = useState(() => sanitizeFilters(filters));

  useEffect(() => {
    setDraft(sanitizeFilters(filters));
  }, [filters]);

  const updateDraft = (updater) => {
    setDraft((prev) => {
      const nextRaw = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      const next = sanitizeFilters(nextRaw);
      onFilterChange?.(next);
      return next;
    });
  };

  const hasActiveFilters = useMemo(() => (
    draft.brands.length > 0
      || draft.categories.length > 0
      || draft.minRating > 0
      || draft.minDiscount > 0
      || draft.inStockOnly
      || draft.warrantyOnly
      || draft.minReviews > 0
      || draft.deliveryWindows.length > 0
      || draft.priceRange[0] > 0
      || draft.priceRange[1] < DEFAULT_MAX_PRICE
  ), [draft]);

  const filteredBrandOptions = useMemo(() => {
    if (!brandQuery.trim()) return draft.availableBrands;
    const needle = brandQuery.trim().toLowerCase();
    return draft.availableBrands.filter((brand) => brand.toLowerCase().includes(needle));
  }, [brandQuery, draft.availableBrands]);

  const activeChips = useMemo(() => {
    const chips = [];

    if (draft.priceRange[0] > 0 || draft.priceRange[1] < DEFAULT_MAX_PRICE) {
      chips.push({ key: 'price', label: `${formatPrice(draft.priceRange[0])} - ${formatPrice(draft.priceRange[1])}` });
    }

    draft.categories.forEach((entry) => {
      chips.push({ key: `category:${entry}`, label: `Category: ${entry}` });
    });

    draft.brands.forEach((entry) => {
      chips.push({ key: `brand:${entry}`, label: `Brand: ${entry}` });
    });

    if (draft.minRating > 0) {
      chips.push({ key: 'rating', label: `${draft.minRating}+ rating` });
    }
    if (draft.minDiscount > 0) {
      chips.push({ key: 'discount', label: `${draft.minDiscount}%+ off` });
    }
    if (draft.minReviews > 0) {
      chips.push({ key: 'reviews', label: `${draft.minReviews}+ reviews` });
    }
    if (draft.inStockOnly) {
      chips.push({ key: 'stock', label: 'In stock only' });
    }
    if (draft.warrantyOnly) {
      chips.push({ key: 'warranty', label: 'Warranty only' });
    }
    draft.deliveryWindows.forEach((entry) => {
      chips.push({ key: `delivery:${entry}`, label: entry });
    });

    return chips;
  }, [draft]);

  const clearAll = () => {
    updateDraft((prev) => ({
      ...prev,
      priceRange: [0, DEFAULT_MAX_PRICE],
      brands: [],
      categories: [],
      minRating: 0,
      minDiscount: 0,
      inStockOnly: false,
      warrantyOnly: false,
      minReviews: 0,
      deliveryWindows: [],
    }));
  };

  const removeChip = (chipKey) => {
    if (chipKey === 'price') {
      updateDraft((prev) => ({ ...prev, priceRange: [0, DEFAULT_MAX_PRICE] }));
      return;
    }
    if (chipKey === 'rating') {
      updateDraft((prev) => ({ ...prev, minRating: 0 }));
      return;
    }
    if (chipKey === 'discount') {
      updateDraft((prev) => ({ ...prev, minDiscount: 0 }));
      return;
    }
    if (chipKey === 'reviews') {
      updateDraft((prev) => ({ ...prev, minReviews: 0 }));
      return;
    }
    if (chipKey === 'stock') {
      updateDraft((prev) => ({ ...prev, inStockOnly: false }));
      return;
    }
    if (chipKey === 'warranty') {
      updateDraft((prev) => ({ ...prev, warrantyOnly: false }));
      return;
    }
    if (chipKey.startsWith('brand:')) {
      const value = chipKey.split(':')[1];
      updateDraft((prev) => ({ ...prev, brands: prev.brands.filter((item) => item !== value) }));
      return;
    }
    if (chipKey.startsWith('category:')) {
      const value = chipKey.split(':')[1];
      updateDraft((prev) => ({ ...prev, categories: prev.categories.filter((item) => item !== value) }));
      return;
    }
    if (chipKey.startsWith('delivery:')) {
      const value = chipKey.split(':')[1];
      updateDraft((prev) => ({ ...prev, deliveryWindows: prev.deliveryWindows.filter((item) => item !== value) }));
    }
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleArrayValue = (field, value) => {
    updateDraft((prev) => {
      const list = prev[field] || [];
      const exists = list.includes(value);
      return {
        ...prev,
        [field]: exists ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  };

  const FilterSection = ({ id, title, icon: Icon, children }) => (
    <section className="border-b border-white/10 pb-5 mb-5 last:border-b-0 last:pb-0 last:mb-0">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="w-full flex items-center justify-between gap-3 mb-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] font-black text-neo-cyan">
          <Icon className="w-3.5 h-3.5" />
          {title}
        </span>
        {expandedSections[id] ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expandedSections[id] && children}
    </section>
  );

  return (
    <div className={cn('bg-transparent', className)}>
      <div className="flex items-start justify-between gap-3 pb-5 border-b border-white/10 mb-5">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-neo-cyan" />
            FORTRESS FILTER ENGINE
          </h2>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">Precision Controls For Product Intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider rounded-md border border-neo-rose/35 bg-neo-rose/10 px-2.5 py-1 text-neo-rose hover:text-white hover:bg-neo-rose/20 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
          {typeof closeMobile === 'function' && (
            <button
              type="button"
              onClick={closeMobile}
              className="lg:hidden inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider rounded-md border border-white/20 bg-white/5 px-2.5 py-1 text-slate-300 hover:text-white"
            >
              Done
            </button>
          )}
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => removeChip(chip.key)}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:border-neo-cyan/45 hover:text-neo-cyan transition-colors"
            >
              {chip.label}
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <FilterSection id="price" title="Price Fortress" icon={Filter}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] font-semibold text-slate-300">
                Min
                <input
                  type="number"
                  min="0"
                  value={draft.priceRange[0]}
                  onChange={(event) => {
                    const minValue = clamp(event.target.value, 0, DEFAULT_MAX_PRICE);
                    updateDraft((prev) => ({
                      ...prev,
                      priceRange: [minValue, Math.max(prev.priceRange[1], minValue)],
                    }));
                  }}
                  className="mt-1.5 w-full rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none focus:border-neo-cyan"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-300">
                Max
                <input
                  type="number"
                  min={draft.priceRange[0]}
                  value={draft.priceRange[1]}
                  onChange={(event) => {
                    const maxValue = clamp(event.target.value, draft.priceRange[0], DEFAULT_MAX_PRICE);
                    updateDraft((prev) => ({
                      ...prev,
                      priceRange: [prev.priceRange[0], maxValue],
                    }));
                  }}
                  className="mt-1.5 w-full rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none focus:border-neo-emerald"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <input
                type="range"
                min="0"
                max={DEFAULT_MAX_PRICE}
                step="500"
                value={draft.priceRange[0]}
                onChange={(event) => {
                  const minValue = clamp(event.target.value, 0, draft.priceRange[1]);
                  updateDraft((prev) => ({
                    ...prev,
                    priceRange: [minValue, prev.priceRange[1]],
                  }));
                }}
                className="w-full accent-cyan-400"
              />
              <input
                type="range"
                min="0"
                max={DEFAULT_MAX_PRICE}
                step="500"
                value={draft.priceRange[1]}
                onChange={(event) => {
                  const maxValue = clamp(event.target.value, draft.priceRange[0], DEFAULT_MAX_PRICE);
                  updateDraft((prev) => ({
                    ...prev,
                    priceRange: [prev.priceRange[0], maxValue],
                  }));
                }}
                className="w-full accent-emerald-400"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {PRICE_CEILING_OPTIONS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => updateDraft((prev) => ({ ...prev, priceRange: [0, amount] }))}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors',
                    draft.priceRange[0] === 0 && draft.priceRange[1] === amount
                      ? 'border-neo-cyan/60 bg-neo-cyan/15 text-neo-cyan'
                      : 'border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-white/30'
                  )}
                >
                  Up to {formatPrice(amount)}
                </button>
              ))}
            </div>
          </div>
        </FilterSection>

        <FilterSection id="category" title="Category Matrix" icon={ListFilter}>
          <div className="flex flex-wrap gap-2">
            {draft.availableCategories.map((entry) => {
              const active = draft.categories.includes(entry);
              return (
                <button
                  key={entry}
                  type="button"
                  onClick={() => toggleArrayValue('categories', entry)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors',
                    active
                      ? 'border-neo-emerald/55 bg-neo-emerald/15 text-neo-emerald'
                      : 'border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-white/30'
                  )}
                >
                  {entry}
                </button>
              );
            })}
          </div>
        </FilterSection>

        <FilterSection id="brand" title="Brand Radar" icon={Search}>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={brandQuery}
                onChange={(event) => setBrandQuery(event.target.value)}
                placeholder="Filter brands"
                className="w-full rounded-lg border border-white/15 bg-zinc-950/70 pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-neo-cyan"
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {filteredBrandOptions.map((brand) => {
                const checked = draft.brands.includes(brand);
                return (
                  <label key={brand} className="flex items-center gap-2.5 text-sm text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleArrayValue('brands', brand)}
                      className="w-4 h-4 rounded border-white/25 bg-zinc-950/70 text-cyan-400 focus:ring-cyan-400"
                    />
                    <span className="truncate">{brand}</span>
                  </label>
                );
              })}
              {filteredBrandOptions.length === 0 && (
                <p className="text-xs text-slate-500">No brand matches this search.</p>
              )}
            </div>
          </div>
        </FilterSection>

        <FilterSection id="quality" title="Quality Signals" icon={Star}>
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Minimum Rating</p>
              <div className="flex flex-wrap gap-2">
                {RATING_OPTIONS.map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => updateDraft((prev) => ({ ...prev, minRating: rating }))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors',
                      draft.minRating === rating
                        ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-300'
                        : 'border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-white/30'
                    )}
                  >
                    {rating === 0 ? 'Any' : `${rating}+`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Minimum Discount</p>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={draft.minDiscount}
                onChange={(event) => updateDraft((prev) => ({ ...prev, minDiscount: Number(event.target.value) || 0 }))}
                className="w-full accent-cyan-400"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {DISCOUNT_QUICK_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateDraft((prev) => ({ ...prev, minDiscount: value }))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors',
                      draft.minDiscount === value
                        ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                        : 'border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-white/30'
                    )}
                  >
                    {value === 0 ? 'Any' : `${value}%+`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Minimum Review Volume</p>
              <div className="flex flex-wrap gap-2">
                {REVIEW_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => updateDraft((prev) => ({ ...prev, minReviews: count }))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors',
                      draft.minReviews === count
                        ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                        : 'border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-white/30'
                    )}
                  >
                    {count === 0 ? 'Any' : `${count}+`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </FilterSection>

        <FilterSection id="fulfillment" title="Fulfillment Shield" icon={Truck}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 text-sm text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={draft.inStockOnly}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, inStockOnly: event.target.checked }))}
                  className="w-4 h-4 rounded border-white/25 bg-zinc-950/70 text-cyan-400 focus:ring-cyan-400"
                />
                <Box className="w-4 h-4 text-neo-cyan" />
                In Stock Only
              </label>

              <label className="flex items-center gap-2.5 text-sm text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={draft.warrantyOnly}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, warrantyOnly: event.target.checked }))}
                  className="w-4 h-4 rounded border-white/25 bg-zinc-950/70 text-cyan-400 focus:ring-cyan-400"
                />
                <ShieldCheck className="w-4 h-4 text-neo-emerald" />
                Warranty Coverage Only
              </label>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Delivery Window</p>
              <div className="space-y-2">
                {DELIVERY_WINDOWS.map((window) => (
                  <label key={window} className="flex items-center gap-2.5 text-sm text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={draft.deliveryWindows.includes(window)}
                      onChange={() => toggleArrayValue('deliveryWindows', window)}
                      className="w-4 h-4 rounded border-white/25 bg-zinc-950/70 text-cyan-400 focus:ring-cyan-400"
                    />
                    <Tag className="w-4 h-4 text-slate-400" />
                    {window}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </FilterSection>
      </div>
    </div>
  );
};

export default Filters;
