import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { Grid, List, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import ProductCard from '@/components/features/product/ProductCard';
import Filters from '@/components/features/product/Filters';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { productApi } from '@/services/api';
import {
  DEFAULT_CATALOG_CATEGORY_LABELS,
  getCategoryApiValue,
  getCategoryLabel,
  normalizeCategorySlug,
} from '@/config/catalogTaxonomy';
import { getErrorReference } from '@/services/clientObservability';
import { resolveProductListingFetchCopy } from '@/utils/backendFailurePresentation';
import { cn } from '@/lib/utils';
import PremiumSelect from '@/components/ui/premium-select';
import { solveAuraGrid, solveChromaticHarmony } from '@/utils/frontendOptimizers';
import { usePrefetchOracle } from '@/hooks/usePrefetchOracle';

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

    if (searchQuery) signals.push(`Query: ${searchQuery}`);
    if (effectiveCategorySlug) signals.push(`Lane: ${getCategoryLabel(effectiveCategorySlug)}`);
    if (filters.brands.length > 0) signals.push(`Brands: ${filters.brands.join(', ')}`);
    if (filters.minRating > 0) signals.push(`Rating ${filters.minRating}+`);
    if (filters.inStockOnly) signals.push('In stock only');
    if (filters.warrantyOnly) signals.push('Warranty only');
    if (filters.minDiscount > 0) signals.push(`${filters.minDiscount}%+ off`);
    if (filters.deliveryWindows.length > 0) signals.push(`Delivery: ${filters.deliveryWindows.join(', ')}`);
    if (
      filters.priceRange[0] !== DEFAULT_MIN_PRICE ||
      filters.priceRange[1] !== DEFAULT_MAX_PRICE
    ) {
      signals.push(`Price Rs ${filters.priceRange[0].toLocaleString('en-IN')} - Rs ${filters.priceRange[1].toLocaleString('en-IN')}`);
    }

    return signals;
  }, [effectiveCategorySlug, filters, searchQuery]);

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
          setLaneFallback({
            requestedLabel: getCategoryLabel(effectiveCategorySlug),
            fallbackLabel: fallbackCategories.length > 0 ? fallbackCategories.join(' + ') : 'Live Catalog',
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
  }, [page, sortBy, searchQuery, effectiveCategorySlug, filters, viewMode]);

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
    <div className="container-custom max-w-7xl mx-auto px-4 py-5 sm:py-6 lg:py-8 min-h-screen relative">
      <div className="absolute top-20 left-6 h-72 w-72 bg-neo-cyan/8 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-12 right-6 h-72 w-72 bg-neo-emerald/8 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Header Area */}
      {effectiveCategorySlug && (
        <RevealOnScroll anchorId="listing-header" anchorLabel="Listing Header" className="mb-8">
          <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-neo-cyan capitalize tracking-tight mb-2">
            {getCategoryLabel(effectiveCategorySlug)}
          </h1>
          <p className="text-neo-cyan font-bold tracking-widest text-sm uppercase">Curated Collection</p>
        </RevealOnScroll>
      )}
      {searchQuery && (
        <RevealOnScroll anchorId="listing-search" anchorLabel="Search Results" className="mb-8">
          <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-2">
            Results for <span className="text-transparent bg-clip-text bg-gradient-to-r from-neo-cyan to-neo-emerald">"{searchQuery}"</span>
          </h1>
          <p className="text-slate-400 font-medium">Filtered from live catalog inventory</p>
        </RevealOnScroll>
      )}
      {!effectiveCategorySlug && !searchQuery && (
        <RevealOnScroll anchorId="listing-default" anchorLabel="Aura Catalog" className="mb-8">
          <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-2">
            Aura <span className="text-transparent bg-clip-text bg-gradient-to-r from-neo-cyan to-neo-emerald">Catalog</span>
          </h1>
          <p className="text-slate-400 font-medium">Explore our full selection of premium products</p>
        </RevealOnScroll>
      )}

      {/* Mobile Filter Toggle */}
      <div className="lg:hidden mb-4 flex justify-between items-center bg-white/[0.045] px-4 py-3 rounded-2xl border border-white/10">
        <button
          onClick={() => setShowMobileFilters(!showMobileFilters)}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors font-medium text-white border border-white/10"
        >
          <SlidersHorizontal className="w-4 h-4 text-neo-cyan" />
          Filters
        </button>
        <span className="text-sm text-slate-400 font-bold tracking-wider">
          <span className="text-white">{totalProducts}</span> Items
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
            'lg:w-72 flex-shrink-0 h-fit sticky top-24 transition-transform duration-300 z-40',
            'fixed inset-y-0 left-0 w-[18rem] lg:relative lg:transform-none lg:translate-x-0',
            showMobileFilters ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <div className="bg-white/5 p-6 rounded-2xl shadow-glass border border-white/10 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-neo-cyan/5 to-transparent pointer-events-none" />
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
            className="bg-white/[0.045] p-4 rounded-2xl shadow-glass border border-white/10 mb-6 flex flex-col sm:flex-row justify-between items-center gap-4 relative overflow-hidden"
            delay={30}
          >
            <div className="absolute left-0 top-0 w-1 h-full bg-gradient-to-b from-neo-cyan to-neo-emerald" />
            <div className="text-sm text-slate-400 font-medium pl-2">
              Displaying <span className="font-bold text-white tracking-wide">{products.length}</span> of <span className="font-bold text-white tracking-wide">{totalProducts}</span> items
            </div>

            <div className="flex items-center gap-4 lg:gap-6 w-full sm:w-auto">
              <div className="relative w-full sm:w-48">
                <PremiumSelect
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full appearance-none bg-zinc-950/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-neo-cyan focus:border-neo-cyan cursor-pointer hover:bg-white/5 transition-colors outline-none font-medium"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="newest">Newest First</option>
                  <option value="rating">Top Rated</option>
                  <option value="discount">Best Discount</option>
                </PremiumSelect>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neo-cyan">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>

              <div className="flex bg-zinc-950/50 rounded-lg p-1 border border-white/5">
                <button
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'p-2 rounded-md transition-all duration-300',
                    viewMode === 'grid' ? 'bg-white/10 text-neo-cyan shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-slate-500 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Grid className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'p-2 rounded-md transition-all duration-300',
                    viewMode === 'list' ? 'bg-white/10 text-neo-emerald shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'text-slate-500 hover:text-white hover:bg-white/5'
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
                Reset filters
              </button>
            </div>
          )}

          {/* Product Grid */}
          {laneFallback && (
            <div className="mb-6 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-200">Lane Expanded</p>
              <p className="mt-2 text-sm leading-relaxed text-amber-50/90">
                {laneFallback.requestedLabel} has no direct inventory in the current provider snapshot. Showing {laneFallback.fallbackLabel} instead so this lane does not dead-end.
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
                Retry Loading
                </button>
                <button className="btn-secondary" onClick={resetScanParameters}>
                  Reset filters
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
              <h3 className="text-2xl font-black text-white mb-2 tracking-tight">No matching products</h3>
              <p className="text-slate-400 mb-4 max-w-md mx-auto">
                The current scan parameters eliminate every item in this lane. Clear filters or broaden the search to reopen the catalog.
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
                  Reset filters
                </button>
                <button className="btn-secondary" onClick={() => navigate('/search')}>
                  Open broader search
                </button>
              </div>
            </div>
          ) : (
            <div
              id="listing-results"
              data-scroll-anchor="true"
              data-scroll-anchor-label="Product Results"
              className={cn(
                'grid gap-6',
                viewMode === 'grid'
                  ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
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
            <div className="flex justify-center items-center gap-6 mt-16 bg-white/[0.045] p-4 rounded-2xl shadow-glass border border-white/10 w-fit mx-auto relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan/8 to-neo-emerald/8 pointer-events-none" />
              <button
                disabled={page === 1}
                onClick={() => handlePageChange(page - 1)}
                className="flex items-center gap-2 text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:text-slate-300 font-bold tracking-wider uppercase text-xs transition-colors p-2"
              >
                <ChevronLeft className="w-5 h-5 text-neo-cyan" /> Prev
              </button>

              <div className="flex items-center bg-zinc-950/50 rounded-lg px-4 py-2 border border-white/5">
                <span className="text-sm font-bold text-slate-400 tracking-widest">
                  PAGE <span className="text-white mx-1 text-base">{page}</span>
                  <span className="text-slate-600 mx-2">/</span> {totalPages}
                </span>
              </div>

              <button
                disabled={page === totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="flex items-center gap-2 text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:text-slate-300 font-bold tracking-wider uppercase text-xs transition-colors p-2"
              >
                Next <ChevronRight className="w-5 h-5 text-neo-emerald" />
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ProductListing;
