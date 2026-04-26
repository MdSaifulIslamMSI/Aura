import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgePercent,
  ChevronLeft,
  ChevronRight,
  Grid,
  List,
  PackageCheck,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import ProductCard from '@/components/features/product/ProductCard';
import Filters from '@/components/features/product/Filters';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { productApi } from '@/services/api';
import {
  DEFAULT_CATALOG_CATEGORY_LABELS,
  getCategoryApiValue,
  getLocalizedCategoryLabel,
  normalizeCategorySlug,
} from '@/config/catalogTaxonomy';
import { getErrorReference } from '@/services/clientObservability';
import { resolveProductListingFetchCopy } from '@/utils/backendFailurePresentation';
import { cn } from '@/lib/utils';
import PremiumSelect from '@/components/ui/premium-select';
import { solveAuraGrid, solveChromaticHarmony } from '@/utils/frontendOptimizers';
import { usePrefetchOracle } from '@/hooks/usePrefetchOracle';
import { useMarket } from '@/context/MarketContext';
import { formatPrice } from '@/utils/format';

const SORT_OPTIONS = new Set(['relevance', 'price-asc', 'price-desc', 'newest', 'rating', 'discount']);
const DEFAULT_MIN_PRICE = 0;
const DEFAULT_MAX_PRICE = 200000;
const DEFAULT_BRANDS = ['Apple', 'Samsung', 'Nike', 'Adidas', 'Puma', 'Sony', 'Dell', 'HP'];
const DEFAULT_CATEGORIES = DEFAULT_CATALOG_CATEGORY_LABELS;
const CATEGORY_ROUTE_FALLBACKS = {
  "men's-fashion": ['footwear'],
  gaming: ['electronics'],
  'home-kitchen': [],
  books: [],
};
const SORT_LABEL_KEY_MAP = {
  relevance: 'listing.sort.relevance',
  'price-asc': 'listing.sort.priceAsc',
  'price-desc': 'listing.sort.priceDesc',
  newest: 'listing.sort.newest',
  rating: 'listing.sort.rating',
  discount: 'listing.sort.discount',
};

const getSortLabel = (value, t) => {
  const fallbackMap = {
    relevance: 'Relevance',
    'price-asc': 'Price: Low to High',
    'price-desc': 'Price: High to Low',
    newest: 'Newest First',
    rating: 'Top Rated',
    discount: 'Best Discount',
  };
  return t(SORT_LABEL_KEY_MAP[value], {}, fallbackMap[value] || value);
};

const createDefaultFilters = (priceRange = [DEFAULT_MIN_PRICE, DEFAULT_MAX_PRICE]) => ({
  priceRange,
  brands: [],
  categories: [],
  minRating: 0,
  minDiscount: 0,
  inStockOnly: false,
  warrantyOnly: false,
  minReviews: 0,
  deliveryWindows: [],
  availableBrands: DEFAULT_BRANDS,
  availableCategories: DEFAULT_CATEGORIES,
});

const getRouteDefaultSort = (pathname = '') => {
  if (pathname === '/deals') return 'discount';
  if (pathname === '/trending') return 'rating';
  if (pathname === '/new-arrivals') return 'newest';
  return 'relevance';
};

const normalizeSort = (value, pathname) => {
  const sortValue = `${value || ''}`.toLowerCase();
  if (SORT_OPTIONS.has(sortValue)) {
    return sortValue;
  }
  return getRouteDefaultSort(pathname);
};

const clampPrice = (value, fallback) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(200000, parsed));
};

const buildPriceRange = (minValue, maxValue) => {
  const min = clampPrice(minValue, 0);
  let max = clampPrice(maxValue, 200000);
  if (max === 0) {
    max = DEFAULT_MAX_PRICE;
  }
  if (min > max) {
    return [DEFAULT_MIN_PRICE, DEFAULT_MAX_PRICE];
  }
  return [min, max];
};

const parseMinRating = (value) => {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return 0;
  return Math.max(0, Math.min(5, rating));
};

const parseDeliveryWindows = (value = '') => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const createFiltersFromParams = (params, previous = {}) => ({
  ...createDefaultFilters(buildPriceRange(params.get('minPrice'), params.get('maxPrice'))),
  minRating: parseMinRating(params.get('rating')),
  inStockOnly: params.get('inStock') === 'true',
  deliveryWindows: parseDeliveryWindows(params.get('deliveryTime')),
  availableBrands: previous.availableBrands || DEFAULT_BRANDS,
  availableCategories: previous.availableCategories || DEFAULT_CATEGORIES,
});

const buildListingTelemetryContext = ({ searchQuery, effectiveCategorySlug, viewMode }) => {
  if (searchQuery) return `search_results_${viewMode}`;
  if (effectiveCategorySlug) return `category_listing_${viewMode}`;
  return `catalog_listing_${viewMode}`;
};

const isDefaultLaneOnlyView = ({ effectiveCategorySlug, searchQuery, filters }) => (
  Boolean(effectiveCategorySlug)
  && !searchQuery
  && filters.brands.length === 0
  && filters.categories.length === 0
  && filters.minRating === 0
  && filters.minDiscount === 0
  && !filters.inStockOnly
  && !filters.warrantyOnly
  && filters.minReviews === 0
  && filters.deliveryWindows.length === 0
  && filters.priceRange[0] === DEFAULT_MIN_PRICE
  && filters.priceRange[1] === DEFAULT_MAX_PRICE
);

const ProductListing = () => {
  const { currency, t } = useMarket();
  const { category } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('q') || '';
  const queryCategory = searchParams.get('category') || '';
  const effectiveCategorySlug = useMemo(
    () => normalizeCategorySlug(queryCategory || (!searchQuery ? category : '')),
    [category, queryCategory, searchQuery]
  );
  const localizedCategoryLabel = useMemo(
    () => getLocalizedCategoryLabel(effectiveCategorySlug, t),
    [effectiveCategorySlug, t]
  );
  const activeRequestRef = useRef(0);

  // Server Data State
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [fetchErrorReference, setFetchErrorReference] = useState('');
  const [laneFallback, setLaneFallback] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);

  // UI State
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState(() => normalizeSort(searchParams.get('sort'), location.pathname));
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const [filters, setFilters] = useState(() =>
    createFiltersFromParams(searchParams)
  );

  // NP-Hard: Intent-based Prefetching (Steiner Tree)
  usePrefetchOracle(products);

  const resetScanParameters = useCallback(() => {
    setFilters((prev) => ({
      ...createDefaultFilters(),
      availableBrands: prev.availableBrands,
      availableCategories: prev.availableCategories,
    }));
    setSortBy(getRouteDefaultSort(location.pathname));
    setPage(1);

    const nextParams = new URLSearchParams();
    if (searchQuery) nextParams.set('q', searchQuery);
    if (queryCategory) nextParams.set('category', normalizeCategorySlug(queryCategory));
    setSearchParams(nextParams, { replace: true });
  }, [location.pathname, queryCategory, searchQuery, setSearchParams]);

  const activeScanSignals = useMemo(() => {
    const signals = [];

    if (searchQuery) signals.push(t('listing.signal.query', { query: searchQuery }, `Query: ${searchQuery}`));
    if (effectiveCategorySlug) {
      signals.push(t('listing.signal.lane', { category: localizedCategoryLabel }, `Lane: ${localizedCategoryLabel}`));
    }
    if (filters.brands.length > 0) {
      signals.push(t('listing.signal.brands', { brands: filters.brands.join(', ') }, `Brands: ${filters.brands.join(', ')}`));
    }
    if (filters.minRating > 0) signals.push(t('listing.signal.rating', { count: filters.minRating }, `Rating ${filters.minRating}+`));
    if (filters.inStockOnly) signals.push(t('listing.signal.stock', {}, 'In stock only'));
    if (filters.warrantyOnly) signals.push(t('listing.signal.warranty', {}, 'Warranty only'));
    if (filters.minDiscount > 0) signals.push(t('listing.signal.discount', { count: filters.minDiscount }, `${filters.minDiscount}%+ off`));
    if (filters.deliveryWindows.length > 0) {
      signals.push(t('listing.signal.delivery', { window: filters.deliveryWindows.join(', ') }, `Delivery: ${filters.deliveryWindows.join(', ')}`));
    }
    if (
      filters.priceRange[0] !== DEFAULT_MIN_PRICE ||
      filters.priceRange[1] !== DEFAULT_MAX_PRICE
    ) {
      signals.push(t(
        'listing.signal.price',
        {
          min: formatPrice(filters.priceRange[0], currency),
          max: formatPrice(filters.priceRange[1], currency),
        },
        `Price ${formatPrice(filters.priceRange[0], currency)} - ${formatPrice(filters.priceRange[1], currency)}`
      ));
    }

    return signals;
  }, [currency, effectiveCategorySlug, filters, localizedCategoryLabel, searchQuery, t]);

  const listingHeader = useMemo(() => {
    if (searchQuery) {
      return {
        eyebrow: t('listing.searchEyebrow', {}, 'Search desk'),
        title: t('listing.resultsForQuery', { query: searchQuery }, `Results for "${searchQuery}"`),
        description: t('listing.filteredLiveCatalog', {}, 'Filtered from live catalog inventory'),
      };
    }

    if (effectiveCategorySlug) {
      return {
        eyebrow: t('listing.curatedCollection', {}, 'Curated Collection'),
        title: localizedCategoryLabel,
        description: t('listing.categoryDeskBody', { category: localizedCategoryLabel }, `${localizedCategoryLabel} picks sorted by live catalog signals, delivery, and price movement.`),
      };
    }

    return {
      eyebrow: t('listing.catalogEyebrow', {}, 'Full catalog'),
      title: t('listing.catalogTitleFull', {}, 'Aura Catalog'),
      description: t('listing.catalogSubtitle', {}, 'Explore our full selection of premium products'),
    };
  }, [effectiveCategorySlug, localizedCategoryLabel, searchQuery, t]);

  const listingStats = useMemo(() => [
    {
      label: t('listing.statsShowing', {}, 'Showing'),
      value: loading ? t('listing.statsLoading', {}, 'Sync') : `${products.length}`,
      detail: t('listing.statsTotal', { count: totalProducts }, `of ${totalProducts} items`),
      icon: PackageCheck,
    },
    {
      label: t('listing.statsSort', {}, 'Sort'),
      value: getSortLabel(sortBy, t),
      detail: t('listing.statsSortBody', {}, 'current order'),
      icon: BadgePercent,
    },
    {
      label: t('listing.statsSignals', {}, 'Signals'),
      value: activeScanSignals.length > 0 ? `${activeScanSignals.length}` : t('listing.statsClean', {}, 'Clean'),
      detail: t('listing.statsSignalsBody', {}, 'active filters'),
      icon: ShieldCheck,
    },
  ], [activeScanSignals.length, loading, products.length, sortBy, t, totalProducts]);

  const fetchProducts = useCallback(async (signal) => {
    const requestId = Date.now();
    activeRequestRef.current = requestId;
    setLoading(true);
    setFetchError(null);
    setFetchErrorReference('');
    setLaneFallback(null);
    try {
      const resolvedCategoryFilter = effectiveCategorySlug
        ? getCategoryApiValue(effectiveCategorySlug)
        : (filters.categories.length > 0 ? filters.categories.join(',') : undefined);
      const telemetryContext = searchQuery
        ? buildListingTelemetryContext({ searchQuery, effectiveCategorySlug, viewMode })
        : undefined;

      const buildQuery = (categoryOverride) => ({
        page,
        limit: 12,
        sort: sortBy,
        telemetryContext,
        keyword: searchQuery,
        category: categoryOverride,
        minPrice: filters.priceRange[0],
        maxPrice: filters.priceRange[1],
        rating: filters.minRating > 0 ? filters.minRating : undefined,
        brand: filters.brands.length > 0 ? filters.brands.join(',') : undefined,
        discount: filters.minDiscount > 0 ? filters.minDiscount : undefined,
        inStock: filters.inStockOnly ? 'true' : undefined,
        hasWarranty: filters.warrantyOnly ? 'true' : undefined,
        minReviews: filters.minReviews > 0 ? filters.minReviews : undefined,
        deliveryTime: filters.deliveryWindows.length > 0 ? filters.deliveryWindows.join(',') : undefined,
      });

      const query = buildQuery(resolvedCategoryFilter);
      const data = await productApi.getProducts(query, { signal });
      if (signal?.aborted || activeRequestRef.current !== requestId) return;

      const buildTelemetry = (payload, categoryValue) => ({
        searchEventId: payload.searchEventId || '',
        query: searchQuery,
        filters: {
          category: categoryValue,
          minPrice: filters.priceRange[0],
          maxPrice: filters.priceRange[1],
          rating: filters.minRating > 0 ? filters.minRating : undefined,
          brand: filters.brands.length > 0 ? filters.brands.join(',') : undefined,
          discount: filters.minDiscount > 0 ? filters.minDiscount : undefined,
          inStock: filters.inStockOnly ? 'true' : undefined,
          hasWarranty: filters.warrantyOnly ? 'true' : undefined,
          minReviews: filters.minReviews > 0 ? filters.minReviews : undefined,
          deliveryTime: filters.deliveryWindows.length > 0 ? filters.deliveryWindows.join(',') : undefined,
          sort: sortBy,
        },
        sourceContext: buildListingTelemetryContext({ searchQuery, effectiveCategorySlug, viewMode }),
      });

      const applyListingPayload = (payload, telemetryCategory) => {
        const searchTelemetry = buildTelemetry(payload, telemetryCategory);
        let processedProducts = (payload.products || []).map((product, index) => ({
          ...product,
          searchTelemetry: {
            ...searchTelemetry,
            position: index + 1,
          },
        }));

        // NP-Hard: Solve for Grid Layout and Visual Harmony
        if (viewMode === 'grid') {
          processedProducts = solveAuraGrid(processedProducts);
          processedProducts = solveChromaticHarmony(processedProducts);
        }

        setProducts(processedProducts);
        setPage(payload.page || 1);
        setTotalPages(payload.pages || 1);
        setTotalProducts(payload.total || 0);
      };

      if ((data.total || 0) === 0 && isDefaultLaneOnlyView({ effectiveCategorySlug, searchQuery, filters })) {
        const fallbackSlugs = CATEGORY_ROUTE_FALLBACKS[effectiveCategorySlug] || [];
        const fallbackCategories = fallbackSlugs.map((slug) => getCategoryApiValue(slug)).filter(Boolean);
        const fallbackCategoryFilter = fallbackCategories.length > 0 ? fallbackCategories.join(',') : undefined;
        const fallbackData = await productApi.getProducts(buildQuery(fallbackCategoryFilter), { signal });
        if (signal?.aborted || activeRequestRef.current !== requestId) return;
        if ((fallbackData.total || 0) > 0) {
          const fallbackDisplayLabel = fallbackSlugs.length > 0
            ? fallbackSlugs.map((slug) => getLocalizedCategoryLabel(slug, t)).join(' + ')
            : t('listing.liveCatalog', {}, 'Live Catalog');
          setLaneFallback({
            requestedLabel: getLocalizedCategoryLabel(effectiveCategorySlug, t),
            fallbackLabel: fallbackDisplayLabel,
            fallbackType: fallbackCategories.length > 0 ? 'adjacent' : 'catalog',
          });
          applyListingPayload(fallbackData, fallbackCategoryFilter);
          return;
        }
      }

      applyListingPayload(data, resolvedCategoryFilter);
    } catch (error) {
      if (signal?.aborted || error?.message === 'Request cancelled') {
        return;
      }
      console.error("Failed to fetch products:", error);
      setProducts([]);
      setTotalProducts(0);
      setFetchErrorReference(getErrorReference(error));
      setFetchError(resolveProductListingFetchCopy(error));
    } finally {
      if (!signal?.aborted && activeRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [page, sortBy, searchQuery, effectiveCategorySlug, filters, t, viewMode]);

  const retryFetch = useCallback(() => {
    const controller = new AbortController();
    fetchProducts(controller.signal);
  }, [fetchProducts]);

  useEffect(() => {
    const controller = new AbortController();
    fetchProducts(controller.signal);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return () => controller.abort();
  }, [fetchProducts]);

  useEffect(() => {
    if (!category || !searchQuery || queryCategory) return;
    const params = new URLSearchParams(location.search);
    const qs = params.toString();
    navigate(qs ? `/search?${qs}` : '/search', { replace: true });
  }, [category, searchQuery, queryCategory, location.search, navigate]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const body = document.body;
    const root = document.documentElement;
    if (showMobileFilters) {
      body.classList.add('aura-filter-drawer-open');
      root.classList.add('aura-filter-drawer-open');
    } else {
      body.classList.remove('aura-filter-drawer-open');
      root.classList.remove('aura-filter-drawer-open');
    }
    return () => {
      body.classList.remove('aura-filter-drawer-open');
      root.classList.remove('aura-filter-drawer-open');
    };
  }, [showMobileFilters]);

  useEffect(() => {
    const routeParams = new URLSearchParams(location.search);
    setFilters((prev) => createFiltersFromParams(routeParams, prev));

    setSortBy(normalizeSort(routeParams.get('sort'), location.pathname));
    setPage(1);
  }, [effectiveCategorySlug, location.pathname, location.search]);

  useEffect(() => {
    setPage(1);
  }, [sortBy, searchQuery, effectiveCategorySlug, filters]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  };

  return (
    <div className="product-listing-theme-shell container-custom max-w-7xl mx-auto px-4 py-5 sm:py-6 lg:py-8 min-h-screen relative">
      <div className="listing-page-texture pointer-events-none absolute inset-x-0 top-0 -z-10 h-[24rem]" />

      <RevealOnScroll anchorId="listing-header" anchorLabel="Listing Header" className="listing-command-hero mb-6">
        <div className="listing-command-copy">
          <div className="premium-eyebrow mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            {listingHeader.eyebrow}
          </div>
          <h1 className="text-3xl font-black leading-tight text-white md:text-5xl">
            {listingHeader.title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">
            {listingHeader.description}
          </p>
        </div>
        <div className="listing-command-stats">
          {listingStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="listing-command-stat">
                <Icon className="h-4 w-4" />
                <span className="text-lg font-black text-white">{stat.value}</span>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{stat.label}</span>
                <span className="text-xs text-slate-400">{stat.detail}</span>
              </div>
            );
          })}
        </div>
      </RevealOnScroll>

      {/* Mobile Filter Toggle */}
      <div className="listing-mobile-filter-bar lg:hidden mb-4">
        <button
          onClick={() => setShowMobileFilters(!showMobileFilters)}
          className="listing-filter-open-button"
        >
          <SlidersHorizontal className="w-4 h-4 text-neo-cyan" />
          {t('filters.open', {}, 'Filters')}
        </button>
        <span className="listing-mobile-filter-count">
          <span className="text-white">{totalProducts}</span> {t('listing.itemsLabel', {}, 'Items')}
        </span>
      </div>

      {showMobileFilters && (
        <button
          type="button"
          aria-label="Close filters backdrop"
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setShowMobileFilters(false)}
        />
      )}

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Filters Sidebar */}
        <aside
          id="listing-filters"
          data-scroll-anchor="true"
          data-scroll-anchor-label="Filters"
          className={cn(
            'listing-filter-rail lg:w-[19rem] flex-shrink-0 h-fit sticky top-24 transition-transform duration-300 z-[90] lg:z-40',
            'fixed inset-y-0 left-0 w-[min(22rem,calc(100vw-1.25rem))] lg:relative lg:transform-none lg:translate-x-0',
            showMobileFilters ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <div className="listing-filter-panel">
            <Filters
              filters={filters}
              onFilterChange={setFilters}
              closeMobile={() => setShowMobileFilters(false)}
            />
          </div>
        </aside>

        {/* Listing surface lives inside the app shell's single main landmark. */}
        <section className="flex-1 min-w-0">
          {/* Header / Sort Bar */}
          <RevealOnScroll
            anchorId="listing-sort-bar"
            anchorLabel="Sort & View"
            className="listing-results-toolbar mb-6"
            delay={30}
          >
            <div className="listing-results-toolbar__accent" />
            <div className="listing-results-count">
              {t('listing.displaying', {}, 'Displaying')} <span className="font-bold text-white tracking-wide">{products.length}</span> {t('listing.of', {}, 'of')} <span className="font-bold text-white tracking-wide">{totalProducts}</span> {t('listing.itemsLower', {}, 'items')}
            </div>

            <div className="listing-results-controls">
              <div className="relative w-full sm:w-48">
                <PremiumSelect
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="listing-sort-select w-full appearance-none cursor-pointer outline-none"
                >
                  <option value="relevance">{getSortLabel('relevance', t)}</option>
                  <option value="price-asc">{getSortLabel('price-asc', t)}</option>
                  <option value="price-desc">{getSortLabel('price-desc', t)}</option>
                  <option value="newest">{getSortLabel('newest', t)}</option>
                  <option value="rating">{getSortLabel('rating', t)}</option>
                  <option value="discount">{getSortLabel('discount', t)}</option>
                </PremiumSelect>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neo-cyan">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>

              <div className="listing-view-toggle">
                <button
                  type="button"
                  aria-label={t('listing.gridView', {}, 'Grid view')}
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'listing-view-toggle__button',
                    viewMode === 'grid' ? 'listing-view-toggle__button--active text-neo-cyan' : 'text-slate-500'
                  )}
                >
                  <Grid className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  aria-label={t('listing.listView', {}, 'List view')}
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'listing-view-toggle__button',
                    viewMode === 'list' ? 'listing-view-toggle__button--active text-neo-emerald' : 'text-slate-500'
                  )}
                >
                  <List className="w-5 h-5" />
                </button>
              </div>
            </div>
          </RevealOnScroll>

          {activeScanSignals.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {activeScanSignals.map((signal) => (
                <span
                  key={signal}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-300"
                >
                  {signal}
                </span>
              ))}
              <button
                type="button"
                onClick={resetScanParameters}
                className="rounded-full border border-neo-cyan/25 bg-neo-cyan/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-neo-cyan transition-colors hover:bg-neo-cyan/15"
              >
                {t('filters.reset', {}, 'Reset filters')}
              </button>
            </div>
          )}

          {/* Product Grid */}
          {laneFallback && (
            <div className="mb-6 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-200">
                {t('listing.laneExpanded', {}, 'Lane Expanded')}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-amber-50/90">
                {t(
                  'listing.laneExpandedBody',
                  {
                    requested: laneFallback.requestedLabel,
                    fallback: laneFallback.fallbackLabel,
                  },
                  `${laneFallback.requestedLabel} has no direct inventory in the current provider snapshot. Showing ${laneFallback.fallbackLabel} instead so this lane does not dead-end.`
                )}
              </p>
            </div>
          )}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-white/5 rounded-2xl h-[400px] animate-pulse border border-white/5" />
              ))}
            </div>
          ) : fetchError ? (
            <div className="text-center py-20 bg-white/[0.045] rounded-3xl shadow-glass border border-neo-rose/20 relative overflow-hidden">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-zinc-950/50 border border-neo-rose/25 flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                <svg className="w-10 h-10 text-neo-rose" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M5.4 19h13.2c1.2 0 1.9-1.3 1.3-2.3L13.3 5.3c-.6-1-2-1-2.6 0L4.1 16.7C3.5 17.7 4.2 19 5.4 19z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-white mb-2 tracking-tight">{fetchError.title}</h3>
              <p className="text-slate-300 mb-6 max-w-md mx-auto">{fetchError.message}</p>
              {fetchError.detail ? (
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {fetchError.detail}
                </p>
              ) : null}
              {fetchErrorReference ? (
                <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Debug Ref {fetchErrorReference}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button className="btn-secondary" onClick={retryFetch}>
                  {t('listing.retryLoading', {}, 'Retry Loading')}
                </button>
                <button className="btn-secondary" onClick={resetScanParameters}>
                  {t('filters.reset', {}, 'Reset filters')}
                </button>
              </div>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-24 bg-white/[0.045] rounded-3xl shadow-glass border border-white/10 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-neo-rose/5 pointer-events-none" />
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-zinc-950/50 border border-white/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                <svg className="w-10 h-10 text-neo-rose drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-white mb-2 tracking-tight">
                {t('listing.emptyTitle', {}, 'No matching products')}
              </h3>
              <p className="text-slate-400 mb-4 max-w-md mx-auto">
                {t('listing.emptyBody', {}, 'The current scan parameters eliminate every item in this lane. Clear filters or broaden the search to reopen the catalog.')}
              </p>
              {activeScanSignals.length > 0 && (
                <div className="mb-8 flex flex-wrap justify-center gap-2 px-6">
                  {activeScanSignals.slice(0, 4).map((signal) => (
                    <span
                      key={signal}
                      className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-300"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button className="btn-secondary" onClick={resetScanParameters}>
                  {t('filters.reset', {}, 'Reset filters')}
                </button>
                <button className="btn-secondary" onClick={() => navigate('/search')}>
                  {t('listing.openBroaderSearch', {}, 'Open broader search')}
                </button>
              </div>
            </div>
          ) : (
            <div
              id="listing-results"
              data-scroll-anchor="true"
              data-scroll-anchor-label="Product Results"
              className={cn(
                'listing-results-grid grid',
                viewMode === 'grid'
                  ? 'listing-results-grid--cards grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                  : 'grid-cols-1'
              )}
            >
              {products.map((product, index) => (
                <RevealOnScroll
                  key={product.id || product._id}
                  delay={Math.min((index % 8) * 45, 280)}
                  distance={14}
                  className="h-full"
                >
                  <ProductCard 
                    product={product} 
                    variant={viewMode === 'list' ? 'list' : 'default'} 
                    gridLayout={product.gridLayout}
                    harmonyIndex={product.harmonyIndex}
                  />
                </RevealOnScroll>
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          {!loading && totalPages > 1 && (
            <div className="listing-pagination">
              <div className="listing-pagination__wash" />
              <button
                disabled={page === 1}
                onClick={() => handlePageChange(page - 1)}
                className="listing-pagination__button"
              >
                <ChevronLeft className="w-5 h-5 text-neo-cyan" /> {t('listing.prev', {}, 'Prev')}
              </button>

              <div className="listing-pagination__status">
                <span>
                  {t('listing.page', {}, 'Page')} <strong>{page}</strong>
                  <em>/</em> {totalPages}
                </span>
              </div>

              <button
                disabled={page === totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="listing-pagination__button"
              >
                {t('listing.next', {}, 'Next')} <ChevronRight className="w-5 h-5 text-neo-emerald" />
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ProductListing;
