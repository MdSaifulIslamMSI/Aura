import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { Grid, List, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import ProductCard from '@/components/features/product/ProductCard';
import Filters from '@/components/features/product/Filters';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { productApi } from '@/services/api';
import { cn } from '@/lib/utils';

const SORT_OPTIONS = new Set(['relevance', 'price-asc', 'price-desc', 'newest', 'rating']);
const DEFAULT_MIN_PRICE = 0;
const DEFAULT_MAX_PRICE = 200000;
const DEFAULT_BRANDS = ['Apple', 'Samsung', 'Nike', 'Adidas', 'Puma', 'Sony', 'Dell', 'HP'];
const DEFAULT_CATEGORIES = [
  'Mobiles',
  'Laptops',
  'Electronics',
  "Men's Fashion",
  "Women's Fashion",
  'Home & Kitchen',
  'Gaming & Accessories',
  'Books',
  'Footwear',
];

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

const ProductListing = () => {
  const { category } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('q') || '';
  const queryCategory = searchParams.get('category') || '';
  const effectiveCategory = queryCategory || (!searchQuery ? category : '') || '';

  // Server Data State
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
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

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const query = {
        page,
        limit: 12,
        sort: sortBy,
        keyword: searchQuery,
        category: effectiveCategory || (filters.categories.length > 0 ? filters.categories.join(',') : undefined),
        minPrice: filters.priceRange[0],
        maxPrice: filters.priceRange[1],
        rating: filters.minRating > 0 ? filters.minRating : undefined,
        brand: filters.brands.length > 0 ? filters.brands.join(',') : undefined,
        discount: filters.minDiscount > 0 ? filters.minDiscount : undefined,
        inStock: filters.inStockOnly ? 'true' : undefined,
        hasWarranty: filters.warrantyOnly ? 'true' : undefined,
        minReviews: filters.minReviews > 0 ? filters.minReviews : undefined,
        deliveryTime: filters.deliveryWindows.length > 0 ? filters.deliveryWindows.join(',') : undefined,
      };

      const data = await productApi.getProducts(query);
      setProducts(data.products || []);
      setPage(data.page || 1);
      setTotalPages(data.pages || 1);
      setTotalProducts(data.total || 0);
    } catch (error) {
      console.error("Failed to fetch products:", error);
      setProducts([]);
      setTotalProducts(0);
      setFetchError('Unable to load products right now. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, searchQuery, effectiveCategory, filters]);

  useEffect(() => {
    fetchProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
  }, [effectiveCategory, location.pathname, location.search]);

  useEffect(() => {
    setPage(1);
  }, [sortBy, searchQuery, effectiveCategory, filters]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  };

  return (
    <div className="container-custom max-w-7xl mx-auto px-4 py-8 min-h-screen relative">
      {/* Background decorations */}
      <div className="absolute top-20 left-10 w-96 h-96 bg-neo-cyan/10 rounded-full blur-[110px] pointer-events-none -z-10" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-neo-emerald/10 rounded-full blur-[110px] pointer-events-none -z-10" />

      {/* Header Area */}
      {effectiveCategory && (
        <RevealOnScroll anchorId="listing-header" anchorLabel="Listing Header" className="mb-8">
          <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-neo-cyan capitalize tracking-tight mb-2">
            {effectiveCategory.replace(/-/g, ' ')}
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

      {/* Mobile Filter Toggle */}
      <div className="lg:hidden mb-6 flex justify-between items-center bg-white/[0.045] backdrop-blur-xl p-4 rounded-xl border border-white/10">
        <button
          onClick={() => setShowMobileFilters(!showMobileFilters)}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors font-medium text-white border border-white/10"
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
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
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
            'fixed inset-y-0 left-0 w-80 lg:relative lg:transform-none lg:translate-x-0',
            showMobileFilters ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <div className="bg-white/5 backdrop-blur-xl p-6 rounded-2xl shadow-glass border border-white/10 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-neo-cyan/5 to-transparent pointer-events-none" />
            <Filters
              filters={filters}
              onFilterChange={setFilters}
              closeMobile={() => setShowMobileFilters(false)}
            />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {/* Header / Sort Bar */}
          <RevealOnScroll
            anchorId="listing-sort-bar"
            anchorLabel="Sort & View"
            className="bg-white/[0.045] backdrop-blur-xl p-4 rounded-2xl shadow-glass border border-white/10 mb-8 flex flex-col sm:flex-row justify-between items-center gap-4 relative overflow-hidden"
            delay={30}
          >
            <div className="absolute left-0 top-0 w-1 h-full bg-gradient-to-b from-neo-cyan to-neo-emerald" />
            <div className="text-sm text-slate-400 font-medium pl-2">
              Displaying <span className="font-bold text-white tracking-wide">{products.length}</span> of <span className="font-bold text-white tracking-wide">{totalProducts}</span> items
            </div>

            <div className="flex items-center gap-4 lg:gap-6 w-full sm:w-auto">
              <div className="relative w-full sm:w-48">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full appearance-none bg-zinc-950/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-neo-cyan focus:border-neo-cyan cursor-pointer hover:bg-white/5 transition-colors outline-none font-medium"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="newest">Newest First</option>
                  <option value="rating">Top Rated</option>
                </select>
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

          {/* Product Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-white/5 rounded-2xl h-[400px] animate-pulse border border-white/5" />
              ))}
            </div>
          ) : fetchError ? (
            <div className="text-center py-20 bg-white/[0.045] backdrop-blur-xl rounded-3xl shadow-glass border border-neo-rose/20 relative overflow-hidden">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-zinc-950/50 border border-neo-rose/25 flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                <svg className="w-10 h-10 text-neo-rose" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M5.4 19h13.2c1.2 0 1.9-1.3 1.3-2.3L13.3 5.3c-.6-1-2-1-2.6 0L4.1 16.7C3.5 17.7 4.2 19 5.4 19z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-white mb-2 tracking-tight">Catalog fetch failed</h3>
              <p className="text-slate-300 mb-8 max-w-md mx-auto">{fetchError}</p>
              <button className="btn-secondary" onClick={fetchProducts}>
                Retry Loading
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-24 bg-white/[0.045] backdrop-blur-xl rounded-3xl shadow-glass border border-white/10 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-neo-rose/5 pointer-events-none" />
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-zinc-950/50 border border-white/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                <svg className="w-10 h-10 text-neo-rose drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-white mb-2 tracking-tight">No matching products</h3>
              <p className="text-slate-400 mb-8 max-w-md mx-auto">No items match your selected filters. Try adjusting your search criteria.</p>
              <button
                className="btn-secondary"
                onClick={() => {
                  setFilters(prev => ({
                    ...createDefaultFilters(),
                    availableBrands: prev.availableBrands,
                    availableCategories: prev.availableCategories,
                  }));
                  setSearchParams({});
                }}
              >
                Clear All Filters
              </button>
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
                  <ProductCard product={product} variant={viewMode === 'list' ? 'list' : 'default'} />
                </RevealOnScroll>
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          {!loading && totalPages > 1 && (
            <div className="flex justify-center items-center gap-6 mt-16 bg-white/[0.045] backdrop-blur-xl p-4 rounded-2xl shadow-glass border border-white/10 w-fit mx-auto relative overflow-hidden">
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
        </main>
      </div>
    </div>
  );
};

export default ProductListing;
