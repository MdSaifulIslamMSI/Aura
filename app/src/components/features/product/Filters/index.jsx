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
import { useMarket } from '@/context/MarketContext';
import { getLocalizedCategoryLabel } from '@/config/catalogTaxonomy';
import { formatPrice } from '@/utils/format';

const DEFAULT_MAX_PRICE = 200000;
const REVIEW_OPTIONS = [0, 100, 500, 1000, 5000];
const DISCOUNT_QUICK_OPTIONS = [0, 10, 20, 30, 40, 50];
const RATING_OPTIONS = [4, 3, 2, 1, 0];
const PRICE_CEILING_OPTIONS = [5000, 10000, 25000, 50000, 100000, 200000];
const DELIVERY_WINDOWS = ['1-2 days', '2-3 days', '3-5 days', '5-7 days', '7+ days'];
const DELIVERY_WINDOW_LABEL_KEYS = {
  '1-2 days': 'deliveryWindow.1to2Days',
  '2-3 days': 'deliveryWindow.2to3Days',
  '3-5 days': 'deliveryWindow.3to5Days',
  '5-7 days': 'deliveryWindow.5to7Days',
  '7+ days': 'deliveryWindow.7PlusDays',
};

const getDeliveryWindowLabel = (value, t) => t(DELIVERY_WINDOW_LABEL_KEYS[value], {}, value);

const formatCompactCurrency = (amount, currency = 'USD') => {
  const currencySymbol = formatPrice(0, currency).replace(/[0-9.,\s]/g, '') || '$';
  if (amount >= 1000) {
    return `${currencySymbol}${Math.round(amount / 1000)}k`;
  }
  return formatPrice(amount, currency);
};

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

const Filters = ({ filters, onFilterChange, className, closeMobile }) => {
  const { currency, t } = useMarket();
  const [expandedSections, setExpandedSections] = useState({
    price: true,
    category: false,
    brand: false,
    quality: false,
    fulfillment: false,
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
      chips.push({
        key: 'price',
        label: t(
          'filters.chip.price',
          {
            min: formatPrice(draft.priceRange[0], currency),
            max: formatPrice(draft.priceRange[1], currency),
          },
          `${formatPrice(draft.priceRange[0], currency)} - ${formatPrice(draft.priceRange[1], currency)}`
        ),
      });
    }

    draft.categories.forEach((entry) => {
      const localizedCategory = getLocalizedCategoryLabel(entry, t);
      chips.push({
        key: `category:${entry}`,
        label: t('filters.chip.category', { category: localizedCategory }, `Category: ${localizedCategory}`),
      });
    });

    draft.brands.forEach((entry) => {
      chips.push({ key: `brand:${entry}`, label: t('filters.chip.brand', { brand: entry }, `Brand: ${entry}`) });
    });

    if (draft.minRating > 0) {
      chips.push({ key: 'rating', label: t('filters.chip.rating', { count: draft.minRating }, `${draft.minRating}+ rating`) });
    }
    if (draft.minDiscount > 0) {
      chips.push({ key: 'discount', label: t('filters.chip.discount', { count: draft.minDiscount }, `${draft.minDiscount}%+ off`) });
    }
    if (draft.minReviews > 0) {
      chips.push({ key: 'reviews', label: t('filters.chip.reviews', { count: draft.minReviews }, `${draft.minReviews}+ reviews`) });
    }
    if (draft.inStockOnly) {
      chips.push({ key: 'stock', label: t('filters.inStockOnly', {}, 'In stock only') });
    }
    if (draft.warrantyOnly) {
      chips.push({ key: 'warranty', label: t('filters.warrantyOnly', {}, 'Warranty only') });
    }
    draft.deliveryWindows.forEach((entry) => {
      chips.push({ key: `delivery:${entry}`, label: getDeliveryWindowLabel(entry, t) });
    });

    return chips;
  }, [currency, draft, t]);

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
    <section className="listing-filter-section">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="listing-filter-section__trigger"
      >
        <span className="listing-filter-section__title">
          <Icon className="w-3.5 h-3.5" />
          {title}
        </span>
        {expandedSections[id] ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expandedSections[id] && (
        <div className="listing-filter-section__body">
          {children}
        </div>
      )}
    </section>
  );

  return (
    <div className={cn('listing-filter-engine bg-transparent', className)}>
      <div className="listing-filter-engine__header">
        <div>
          <h2 className="listing-filter-engine__title">
            <ShieldCheck className="w-5 h-5 text-neo-cyan" />
            {t('filters.title', {}, 'Filter Engine')}
          </h2>
          <p className="listing-filter-engine__subtitle">
            {t('filters.subtitle', {}, 'Precision Controls For Product Intelligence')}
          </p>
        </div>
        <div className="listing-filter-engine__actions">
          {activeChips.length > 0 && (
            <span className="listing-filter-engine__count">
              {activeChips.length}
            </span>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="listing-filter-clear-button"
            >
              <X className="w-3 h-3" />
              {t('filters.clear', {}, 'Clear')}
            </button>
          )}
          {typeof closeMobile === 'function' && (
            <button
              type="button"
              onClick={closeMobile}
              className="listing-filter-done-button"
            >
              {t('filters.done', {}, 'Done')}
            </button>
          )}
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="listing-filter-chip-tray">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => removeChip(chip.key)}
              className="listing-filter-chip"
            >
              {chip.label}
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      <div className="listing-filter-stack">
        <FilterSection id="price" title={t('filters.section.price', {}, 'Price Range')} icon={Filter}>
          <div className="listing-price-control">
            <div className="listing-price-summary">
              <span>{formatPrice(draft.priceRange[0], currency)}</span>
              <span>{formatPrice(draft.priceRange[1], currency)}</span>
            </div>

            <div className="listing-price-fields">
              <label className="listing-filter-field">
                <span>{t('filters.min', {}, 'Min')}</span>
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
                  className="listing-filter-input"
                />
              </label>
              <label className="listing-filter-field">
                <span>{t('filters.max', {}, 'Max')}</span>
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
                  className="listing-filter-input"
                />
              </label>
            </div>

            <div className="listing-price-slider-stack">
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
                className="listing-price-range listing-price-range--min"
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
                className="listing-price-range listing-price-range--max"
              />
            </div>

            <div className="listing-filter-presets">
              {PRICE_CEILING_OPTIONS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  aria-label={t('filters.upTo', { amount: formatPrice(amount, currency) }, `Up to ${formatPrice(amount, currency)}`)}
                  onClick={() => updateDraft((prev) => ({ ...prev, priceRange: [0, amount] }))}
                  className={cn(
                    'listing-filter-preset',
                    draft.priceRange[0] === 0 && draft.priceRange[1] === amount
                      ? 'listing-filter-preset--active'
                      : ''
                  )}
                >
                  <span className="listing-filter-preset__full">
                    {t('filters.upTo', { amount: formatPrice(amount, currency) }, `Up to ${formatPrice(amount, currency)}`)}
                  </span>
                  <span className="listing-filter-preset__compact">
                    {t('filters.upToCompact', { amount: formatCompactCurrency(amount, currency) }, `Max ${formatCompactCurrency(amount, currency)}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </FilterSection>

        <FilterSection id="category" title={t('filters.section.category', {}, 'Category Matrix')} icon={ListFilter}>
          <div className="listing-filter-option-grid">
            {draft.availableCategories.map((entry) => {
              const active = draft.categories.includes(entry);
              return (
                <button
                  key={entry}
                  type="button"
                  onClick={() => toggleArrayValue('categories', entry)}
                  className={cn(
                    'listing-filter-option',
                    active
                      ? 'listing-filter-option--active'
                      : ''
                  )}
                >
                  {getLocalizedCategoryLabel(entry, t)}
                </button>
              );
            })}
          </div>
        </FilterSection>

        <FilterSection id="brand" title={t('filters.section.brand', {}, 'Brand Radar')} icon={Search}>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={brandQuery}
                onChange={(event) => setBrandQuery(event.target.value)}
                placeholder={t('filters.brandPlaceholder', {}, 'Filter brands')}
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
                <p className="text-xs text-slate-500">{t('filters.noBrandMatches', {}, 'No brand matches this search.')}</p>
              )}
            </div>
          </div>
        </FilterSection>

        <FilterSection id="quality" title={t('filters.section.quality', {}, 'Quality Signals')} icon={Star}>
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{t('filters.minimumRating', {}, 'Minimum Rating')}</p>
              <div className="listing-filter-option-grid listing-filter-option-grid--tight">
                {RATING_OPTIONS.map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => updateDraft((prev) => ({ ...prev, minRating: rating }))}
                    className={cn(
                      'listing-filter-option',
                      draft.minRating === rating
                        ? 'listing-filter-option--active'
                        : ''
                    )}
                  >
                    {rating === 0 ? t('filters.any', {}, 'Any') : `${rating}+`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{t('filters.minimumDiscount', {}, 'Minimum Discount')}</p>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={draft.minDiscount}
                onChange={(event) => updateDraft((prev) => ({ ...prev, minDiscount: Number(event.target.value) || 0 }))}
                className="listing-price-range"
              />
              <div className="listing-filter-option-grid listing-filter-option-grid--tight mt-2">
                {DISCOUNT_QUICK_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateDraft((prev) => ({ ...prev, minDiscount: value }))}
                    className={cn(
                      'listing-filter-option',
                      draft.minDiscount === value
                        ? 'listing-filter-option--active'
                        : ''
                    )}
                  >
                    {value === 0 ? t('filters.any', {}, 'Any') : `${value}%+`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{t('filters.minimumReviewVolume', {}, 'Minimum Review Volume')}</p>
              <div className="listing-filter-option-grid listing-filter-option-grid--tight">
                {REVIEW_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => updateDraft((prev) => ({ ...prev, minReviews: count }))}
                    className={cn(
                      'listing-filter-option',
                      draft.minReviews === count
                        ? 'listing-filter-option--active'
                        : ''
                    )}
                  >
                    {count === 0 ? t('filters.any', {}, 'Any') : `${count}+`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </FilterSection>

        <FilterSection id="fulfillment" title={t('filters.section.fulfillment', {}, 'Fulfillment Shield')} icon={Truck}>
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
                {t('filters.inStockOnly', {}, 'In Stock Only')}
              </label>

              <label className="flex items-center gap-2.5 text-sm text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={draft.warrantyOnly}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, warrantyOnly: event.target.checked }))}
                  className="w-4 h-4 rounded border-white/25 bg-zinc-950/70 text-cyan-400 focus:ring-cyan-400"
                />
                <ShieldCheck className="w-4 h-4 text-neo-emerald" />
                {t('filters.warrantyCoverageOnly', {}, 'Warranty Coverage Only')}
              </label>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{t('filters.deliveryWindow', {}, 'Delivery Window')}</p>
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
                    {getDeliveryWindowLabel(window, t)}
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
