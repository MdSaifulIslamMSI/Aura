import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BookmarkPlus,
  ChevronRight,
  Clock3,
  Command,
  Loader2,
  Mic,
  PackageSearch,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { productApi } from '@/services/api';
import {
  CATALOG_CATEGORY_OPTIONS,
  getCategoryApiValue,
  normalizeCategorySlug,
} from '@/config/catalogTaxonomy';
import { cn } from '@/lib/utils';
import VoiceSearch from '@/components/shared/VoiceSearch';

const SEARCH_HISTORY_KEY = 'aura_global_search_history';
const SEARCH_INTENTS_KEY = 'aura_global_search_intents';
const SEARCH_STATE_KEY = 'aura_global_search_state';
const MAX_HISTORY_ITEMS = 8;
const MAX_INTENT_ITEMS = 6;
const DEFAULT_MAX_PRICE = 200000;

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  ...CATALOG_CATEGORY_OPTIONS,
];

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'rating', label: 'Top Rated' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
];

const TRENDING_QUERIES = [
  'iPhone 15',
  'gaming laptop',
  'wireless earbuds',
  'smart watch',
  'air fryer',
  'home gym set',
];

const isEditableTarget = (target) => {
  if (typeof HTMLElement === 'undefined') return false;
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName?.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
};

const normalizeSort = (value) => {
  if (SORT_OPTIONS.some((option) => option.value === value)) {
    return value;
  }
  return 'relevance';
};

const parseCategoryFromPath = (pathname = '') => {
  const match = pathname.match(/^\/category\/([^/?#]+)/i);
  return normalizeCategorySlug(match?.[1] || '') || null;
};

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const extractProductId = (product) => product?.id || product?._id || null;

const attachSearchTelemetry = (products = [], telemetry = {}) => (
  (Array.isArray(products) ? products : []).map((product, index) => ({
    ...product,
    searchTelemetry: {
      searchEventId: telemetry.searchEventId || '',
      query: telemetry.query || '',
      filters: telemetry.filters || {},
      sourceContext: telemetry.sourceContext || 'global_search_suggestion',
      position: index + 1,
    },
  }))
);

const formatPrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `Rs ${amount.toLocaleString('en-IN')}`;
};

const parseSemanticIntent = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  let category = '';
  if (/\bmobile|iphone|android|phone\b/.test(lower)) category = 'mobiles';
  else if (/\blaptop|notebook|macbook\b/.test(lower)) category = 'laptops';
  else if (/\bgaming|console\b/.test(lower)) category = 'gaming';
  else if (/\belectronic|gadget\b/.test(lower)) category = 'electronics';

  const maxPriceMatch = lower.match(/\b(?:under|below|less than)\s+(\d{1,3})(k)?\b/);
  const maxPrice = maxPriceMatch
    ? Number(maxPriceMatch[1]) * (maxPriceMatch[2] ? 1000 : 1)
    : undefined;

  const ratingMatch = lower.match(/\brating\s*([1-5](?:\.\d)?)\+?\b/);
  const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;

  const fastDelivery = /\bfast delivery|quick delivery|same day|one day\b/.test(lower);
  const inStock = /\bin stock|available now|ready stock\b/.test(lower);

  const cleanedQuery = raw
    .replace(/\b(?:under|below|less than)\s+\d{1,3}k?\b/gi, ' ')
    .replace(/\brating\s*[1-5](?:\.\d)?\+?\b/gi, ' ')
    .replace(/\bfast delivery|quick delivery|same day|one day|in stock|available now|ready stock\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const hasSignals = Boolean(category || maxPrice || rating || fastDelivery || inStock);
  if (!hasSignals) return null;

  return {
    name: raw,
    query: cleanedQuery || raw,
    category: category || undefined,
    maxPrice: maxPrice ? Math.max(1000, Math.min(DEFAULT_MAX_PRICE, maxPrice)) : undefined,
    rating: rating || undefined,
    inStock: inStock ? 'true' : undefined,
    deliveryTime: fastDelivery ? '1-2 days' : undefined,
  };
};

const readPersistedSearchState = () => {
  try {
    const raw = localStorage.getItem(SEARCH_STATE_KEY);
    const parsed = JSON.parse(raw || '{}');
    const categoryScope = CATEGORY_OPTIONS.some((option) => option.value === parsed?.categoryScope)
      ? parsed.categoryScope
      : 'all';

    return {
      categoryScope,
      sortMode: normalizeSort(parsed?.sortMode),
      maxPrice: parsePositiveNumber(parsed?.maxPrice, DEFAULT_MAX_PRICE),
    };
  } catch {
    return {
      categoryScope: 'all',
      sortMode: 'relevance',
      maxPrice: DEFAULT_MAX_PRICE,
    };
  }
};

const GlobalSearchBar = ({
  className,
  mobile = false,
  placeholder = 'Search products, brands, categories...',
  onVoiceSearch,
  onNavigate,
  enableGlobalShortcuts = true,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState([]);
  const [savedIntents, setSavedIntents] = useState([]);
  const [categoryScope, setCategoryScope] = useState('all');
  const [sortMode, setSortMode] = useState('relevance');
  const [maxPrice, setMaxPrice] = useState(DEFAULT_MAX_PRICE);
  const [showInlineVoiceAssistant, setShowInlineVoiceAssistant] = useState(false);

  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const initialSearchStateRef = useRef({
    categoryScope: 'all',
    sortMode: 'relevance',
    maxPrice: DEFAULT_MAX_PRICE,
  });

  const navigate = useNavigate();
  const location = useLocation();

  const quickActions = useMemo(
    () => [
      { label: 'Marketplace', description: 'Browse peer-to-peer listings', to: '/marketplace' },
      { label: 'Deals', description: 'Open highest discount picks', to: '/deals' },
      { label: 'Trending', description: 'See top rated products', to: '/trending' },
      { label: 'New Arrivals', description: 'Fresh inventory drops', to: '/new-arrivals' },
      { label: 'Visual Search', description: 'Find products from image hints', to: '/visual-search' },
      { label: 'AI Compare', description: 'Compare up to four products instantly', to: '/compare' },
      { label: 'Smart Bundle', description: 'Generate AI bundles with budget slider', to: '/bundles' },
      { label: 'Sell Item', description: 'Create a marketplace listing', to: '/sell' },
      { label: 'Orders', description: 'Track placed orders', to: '/orders' },
    ],
    []
  );

  const hasSearchText = query.trim().length > 0;

  const persistRecentSearches = useCallback((items) => {
    setRecentSearches(items);
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items));
    } catch {
      // Ignore localStorage write failures silently.
    }
  }, []);

  const persistSavedIntents = useCallback((items) => {
    setSavedIntents(items);
    try {
      localStorage.setItem(SEARCH_INTENTS_KEY, JSON.stringify(items));
    } catch {
      // ignore localStorage failures
    }
  }, []);

  const pushRecentSearch = useCallback(
    (term) => {
      const cleaned = term.trim();
      if (!cleaned) return;
      const deduped = [cleaned, ...recentSearches.filter((item) => item.toLowerCase() !== cleaned.toLowerCase())];
      persistRecentSearches(deduped.slice(0, MAX_HISTORY_ITEMS));
    },
    [persistRecentSearches, recentSearches]
  );

  const clearRecentSearches = useCallback(() => {
    persistRecentSearches([]);
  }, [persistRecentSearches]);

  const saveCurrentIntent = useCallback(() => {
    const intent = parseSemanticIntent(query.trim());
    if (!intent) return;

    const payload = {
      id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: intent.name,
      query: intent.query,
      category: normalizeCategorySlug(intent.category || '') || 'all',
      maxPrice: intent.maxPrice || maxPrice,
      rating: intent.rating || 0,
      inStock: intent.inStock || '',
      deliveryTime: intent.deliveryTime || '',
      sort: sortMode,
      createdAt: Date.now(),
    };

    const deduped = [payload, ...savedIntents.filter((entry) => entry.name?.toLowerCase() !== payload.name.toLowerCase())];
    persistSavedIntents(deduped.slice(0, MAX_INTENT_ITEMS));
  }, [maxPrice, persistSavedIntents, query, savedIntents, sortMode]);

  const buildSearchUrl = useCallback(
    (searchText, options = {}) => {
    const params = new URLSearchParams();
    const cleaned = searchText.trim();
    const resolvedCategory = normalizeCategorySlug(options.category ?? categoryScope) || 'all';
    const resolvedSort = options.sort ?? sortMode;
    const resolvedMaxPrice = parsePositiveNumber(options.maxPrice, maxPrice);

      if (cleaned) params.set('q', cleaned);
      if (resolvedSort !== 'relevance') params.set('sort', resolvedSort);
      if (resolvedMaxPrice < DEFAULT_MAX_PRICE) params.set('maxPrice', `${Math.round(resolvedMaxPrice)}`);
      if (resolvedCategory !== 'all') params.set('category', resolvedCategory);
      if (options.rating) params.set('rating', String(options.rating));
      if (options.inStock) params.set('inStock', String(options.inStock));
      if (options.deliveryTime) params.set('deliveryTime', String(options.deliveryTime));

      let basePath = cleaned ? '/search' : '/products';
      if (!cleaned && resolvedCategory !== 'all') {
        basePath = `/category/${resolvedCategory}`;
      }

      const queryString = params.toString();
      return queryString ? `${basePath}?${queryString}` : basePath;
    },
    [categoryScope, maxPrice, sortMode]
  );

  const navigateTo = useCallback(
    (path) => {
      setIsOpen(false);
      setShowFilters(false);
      setActiveIndex(-1);
      navigate(path);
      if (typeof onNavigate === 'function') {
        onNavigate(path);
      }
    },
    [navigate, onNavigate]
  );

  const applySavedIntent = useCallback((intent) => {
    if (!intent) return;
    setQuery(intent.query || '');
    setCategoryScope(normalizeCategorySlug(intent.category || '') || 'all');
    setSortMode(normalizeSort(intent.sort));
    setMaxPrice(parsePositiveNumber(intent.maxPrice, DEFAULT_MAX_PRICE));
    navigateTo(buildSearchUrl(intent.query || '', {
      category: normalizeCategorySlug(intent.category || '') || 'all',
      sort: normalizeSort(intent.sort),
      maxPrice: parsePositiveNumber(intent.maxPrice, DEFAULT_MAX_PRICE),
      rating: intent.rating || undefined,
      inStock: intent.inStock || undefined,
      deliveryTime: intent.deliveryTime || undefined,
    }));
  }, [buildSearchUrl, navigateTo]);

  const executeSearch = useCallback(
    (value = query) => {
      const cleaned = value.trim();
      const intent = parseSemanticIntent(cleaned);
      if (cleaned) {
        pushRecentSearch(cleaned);
      }
      navigateTo(buildSearchUrl(intent?.query || cleaned, intent || {}));
    },
    [buildSearchUrl, navigateTo, pushRecentSearch, query]
  );

  const openVoiceAssistant = useCallback(() => {
    if (typeof onVoiceSearch === 'function') {
      onVoiceSearch();
      return;
    }
    setShowInlineVoiceAssistant(true);
  }, [onVoiceSearch]);

  const handleInlineVoiceResult = useCallback(
    (voiceQuery) => {
      const cleaned = String(voiceQuery || '').trim();
      if (!cleaned) return;
      setQuery(cleaned);
      executeSearch(cleaned);
      setShowInlineVoiceAssistant(false);
    },
    [executeSearch]
  );

  const selectSuggestion = useCallback(
    (product) => {
      const targetId = extractProductId(product);
      const telemetry = product?.searchTelemetry || null;
      if (telemetry?.searchEventId && targetId) {
        void productApi.trackSearchClick({
          searchEventId: telemetry.searchEventId,
          productId: targetId,
          position: telemetry.position || 0,
          sourceContext: telemetry.sourceContext || 'global_search_suggestion',
          query: telemetry.query || query.trim(),
          filters: telemetry.filters || {},
        });
      }
      if (!targetId) {
        executeSearch(product?.title || product?.name || '');
        return;
      }
      navigateTo(`/product/${targetId}`);
    },
    [executeSearch, navigateTo, query]
  );

  useEffect(() => {
    const persistedState = readPersistedSearchState();
    initialSearchStateRef.current = persistedState;

    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((item) => typeof item === 'string').slice(0, MAX_HISTORY_ITEMS));
      }
    } catch {
      setRecentSearches([]);
    }

    try {
      const rawIntents = localStorage.getItem(SEARCH_INTENTS_KEY);
      const parsedIntents = JSON.parse(rawIntents || '[]');
      if (Array.isArray(parsedIntents)) {
        setSavedIntents(parsedIntents.filter((item) => item && typeof item === 'object').slice(0, MAX_INTENT_ITEMS));
      }
    } catch {
      setSavedIntents([]);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SEARCH_STATE_KEY, JSON.stringify({
        categoryScope,
        sortMode,
        maxPrice,
      }));
    } catch {
      // ignore localStorage failures
    }
  }, [categoryScope, maxPrice, sortMode]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const persistedState = initialSearchStateRef.current;
    const locationQuery = params.get('q') || params.get('keyword') || '';
    const routeCategory = parseCategoryFromPath(location.pathname);
    const queryCategory = params.get('category');
    const hasQuery = Boolean(locationQuery.trim());
    const normalizedQueryCategory = normalizeCategorySlug(queryCategory || '');
    const isKnownRouteCategory = routeCategory && CATEGORY_OPTIONS.some((entry) => entry.value === routeCategory);

    setQuery(locationQuery);
    setSortMode(normalizeSort(params.get('sort') || persistedState.sortMode));
    setMaxPrice(parsePositiveNumber(params.get('maxPrice') ?? persistedState.maxPrice, DEFAULT_MAX_PRICE));

    if (normalizedQueryCategory && CATEGORY_OPTIONS.some((entry) => entry.value === normalizedQueryCategory)) {
      setCategoryScope(normalizedQueryCategory);
    } else if (!hasQuery && isKnownRouteCategory) {
      setCategoryScope(routeCategory);
    } else {
      setCategoryScope(persistedState.categoryScope || 'all');
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!enableGlobalShortcuts) return undefined;
    const handleShortcut = (event) => {
      const isPaletteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const isSlashShortcut = event.key === '/';
      const quickActionIndex = event.altKey && /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;

      if (isOpen && quickActionIndex >= 0 && quickActions[quickActionIndex]) {
        event.preventDefault();
        navigateTo(quickActions[quickActionIndex].to);
        return;
      }

      if (isOpen && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        saveCurrentIntent();
        return;
      }

      if ((!isPaletteShortcut && !isSlashShortcut) || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setIsOpen(true);
      inputRef.current?.focus();
    };

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [enableGlobalShortcuts, isOpen, navigateTo, quickActions, saveCurrentIntent]);

  useEffect(() => {
    if (!enableGlobalShortcuts) return undefined;
    const handleVoiceShortcut = (event) => {
      const isVoiceShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v';
      if (!isVoiceShortcut || isEditableTarget(event.target)) return;
      event.preventDefault();
      openVoiceAssistant();
    };

    document.addEventListener('keydown', handleVoiceShortcut);
    return () => document.removeEventListener('keydown', handleVoiceShortcut);
  }, [enableGlobalShortcuts, openVoiceAssistant]);

  useEffect(() => {
    if (!isOpen || query.trim().length < 2) {
      setSuggestions([]);
      setActiveIndex(-1);
      setError('');
      setIsLoading(false);
      return;
    }

    let isActive = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setIsLoading(true);
        setError('');

        const response = await productApi.getProducts({
          keyword: query.trim(),
          limit: mobile ? 5 : 7,
          page: 1,
          sort: sortMode,
          includeMeta: false,
          includeDealDna: 'false',
          telemetryContext: 'global_search_suggestion',
          category: categoryScope === 'all' ? undefined : getCategoryApiValue(categoryScope),
          maxPrice: maxPrice < DEFAULT_MAX_PRICE ? Math.round(maxPrice) : undefined,
        }, { signal: controller.signal });

        if (!isActive) return;
        setSuggestions(attachSearchTelemetry(
          (response?.products || []).slice(0, mobile ? 5 : 7),
          {
            searchEventId: response?.searchEventId || '',
            query: query.trim(),
            filters: {
              category: categoryScope === 'all' ? undefined : getCategoryApiValue(categoryScope),
              maxPrice: maxPrice < DEFAULT_MAX_PRICE ? Math.round(maxPrice) : undefined,
              sort: sortMode,
            },
            sourceContext: 'global_search_suggestion',
          }
        ));
      } catch (error) {
        if (error?.message === 'Request cancelled') {
          return;
        }
        if (!isActive) return;
        setSuggestions([]);
        setError('Unable to load live suggestions right now.');
      } finally {
        if (isActive) {
          setIsLoading(false);
          setActiveIndex(-1);
        }
      }
    }, 240);

    return () => {
      isActive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [categoryScope, isOpen, maxPrice, mobile, query, sortMode]);

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((previous) => (previous + 1) % suggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((previous) => (previous <= 0 ? suggestions.length - 1 : previous - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        selectSuggestion(suggestions[activeIndex]);
      } else {
        executeSearch();
      }
      return;
    }

    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      <div
        className={cn(
          'search-shell',
          mobile && 'search-shell-mobile'
        )}
      >
        <div className="search-shell-overlay" />

        <div className="relative flex items-stretch">
          <button
            type="button"
            onClick={() => executeSearch()}
            className="search-control-icon"
            aria-label="Search now"
          >
            <Search className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <input
            ref={inputRef}
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={cn(
              'search-control-input pr-2',
              'text-sm sm:text-base'
            )}
            aria-label="Global search"
          />

          {!mobile && enableGlobalShortcuts && (
            <div className="hidden xl:flex items-center gap-1 border-l border-white/10 px-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
              <Command className="h-3.5 w-3.5 text-slate-400" />
              <span>K</span>
            </div>
          )}

          <button
            type="button"
            onClick={openVoiceAssistant}
            className="search-control-icon text-slate-300 hover:text-neo-emerald border-l border-white/10"
            aria-label="Voice search"
            title="Voice search (Ctrl/Cmd + Shift + V)"
          >
            <Mic className="w-4 h-4" />
          </button>

          {hasSearchText && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSuggestions([]);
                inputRef.current?.focus();
              }}
              className="search-control-icon text-slate-400 hover:text-white border-l border-white/10"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="global-search-palette search-palette">
          <div className="mb-4 flex flex-col gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-neo-cyan">
                Search Intelligence
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Run live search first. Open advanced controls only when you need tighter filtering.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowFilters((value) => !value)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-[0.18em] transition-colors',
                  showFilters
                    ? 'border-neo-cyan/40 bg-neo-cyan/12 text-neo-cyan'
                    : 'border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-white'
                )}
                aria-label="Toggle advanced search controls"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Controls
              </button>
              <button
                type="button"
                onClick={() => executeSearch()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-neo-cyan to-neo-emerald px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:-translate-y-0.5"
              >
                <Search className="h-3.5 w-3.5" />
                Run Search
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-neo-cyan">
                  <Sparkles className="w-3.5 h-3.5" />
                  Search Controls
                </div>
                <button
                  type="button"
                  onClick={saveCurrentIntent}
                  disabled={!parseSemanticIntent(query)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-300 hover:text-white disabled:opacity-50"
                  title="Save semantic intent (Ctrl/Cmd+Enter)"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Save Intent
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-xs font-semibold text-slate-300">
                  Category
                  <select
                    value={categoryScope}
                    onChange={(event) => setCategoryScope(event.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-zinc-900/90 px-3 py-2 text-sm text-slate-100 outline-none focus:border-neo-cyan"
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-zinc-900 text-slate-100">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-semibold text-slate-300">
                  Sort
                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(normalizeSort(event.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-zinc-900/90 px-3 py-2 text-sm text-slate-100 outline-none focus:border-neo-cyan"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-zinc-900 text-slate-100">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-semibold text-slate-300">
                  Budget Cap ({formatPrice(maxPrice) || `Rs ${DEFAULT_MAX_PRICE}`})
                  <input
                    type="range"
                    min={1000}
                    max={DEFAULT_MAX_PRICE}
                    step={500}
                    value={maxPrice}
                    onChange={(event) => setMaxPrice(parsePositiveNumber(event.target.value, DEFAULT_MAX_PRICE))}
                    className="mt-3 w-full accent-cyan-400"
                  />
                </label>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-3 text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin text-neo-cyan" />
              Scanning live catalog...
            </div>
          ) : null}

          {!isLoading && suggestions.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 px-1 mb-2">Live Suggestions</div>
              <div className="space-y-2">
                {suggestions.map((product, index) => {
                  const productId = extractProductId(product);
                  const imageUrl = Array.isArray(product.image)
                    ? product.image[0]
                    : Array.isArray(product.images)
                      ? product.images[0]
                      : product.image || product.images;

                  return (
                    <button
                      key={productId || `${product.title || product.name || 'product'}-${index}`}
                      type="button"
                      onClick={() => selectSuggestion(product)}
                      className={cn(
                        'w-full text-left rounded-xl border px-3 py-2.5 transition-colors',
                        'flex items-center gap-3 border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-white/20',
                        activeIndex === index && 'border-neo-cyan/40 bg-neo-cyan/10'
                      )}
                    >
                      <div className="w-11 h-11 rounded-lg overflow-hidden bg-zinc-900/80 border border-white/10 flex-shrink-0">
                        {imageUrl ? (
                          <img src={imageUrl} alt={product.title || product.name || 'Product'} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <PackageSearch className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-100 truncate">{product.title || product.name || 'Untitled product'}</div>
                        <div className="text-xs text-slate-400 truncate">{product.category || product.brand || 'General'}</div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-black text-neo-cyan">{formatPrice(product.price) || 'View'}</div>
                        <div className="text-[11px] text-slate-500 flex items-center justify-end gap-1">
                          Open
                          <ChevronRight className="w-3 h-3" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!isLoading && hasSearchText && suggestions.length === 0 && (
            <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
              No direct matches yet. Press Enter to run a full catalog search.
            </div>
          )}

          {error && !isLoading && (
            <div className="mb-3 rounded-xl border border-neo-rose/25 bg-neo-rose/10 p-3 text-sm text-neo-rose">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-3">
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1.5">
                  <Clock3 className="w-3.5 h-3.5" />
                  Recent
                </h4>
                {recentSearches.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {recentSearches.length === 0 ? (
                <p className="text-xs text-slate-500">Your recent searches will appear here.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => {
                        setQuery(term);
                        executeSearch(term);
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-neo-cyan/50 hover:text-neo-cyan transition-colors"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-3.5 h-3.5" />
                Trending
              </h4>
              <div className="flex flex-wrap gap-2">
                {TRENDING_QUERIES.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      setQuery(term);
                      executeSearch(term);
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-neo-emerald/50 hover:text-neo-emerald transition-colors"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {savedIntents.length > 0 && (
            <section className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1.5">
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Saved Intents
                </h4>
                <button
                  type="button"
                  onClick={() => persistSavedIntents([])}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {savedIntents.map((intent) => (
                  <button
                    key={intent.id || intent.name}
                    type="button"
                    onClick={() => applySavedIntent(intent)}
                    className="rounded-full border border-cyan-300/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-100 hover:border-cyan-300/45 transition-colors"
                  >
                    {intent.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-2">Quick Actions</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.to}
                  type="button"
                  onClick={() => navigateTo(action.to)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:border-white/25 hover:bg-white/10 transition-colors"
                >
                  <div className="text-sm font-bold text-slate-100 flex items-center justify-between gap-2">
                    {action.label}
                    <ArrowUpRight className="w-3.5 h-3.5 text-neo-cyan" />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{action.description}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {showInlineVoiceAssistant && (
        <VoiceSearch
          onClose={() => setShowInlineVoiceAssistant(false)}
          onResult={handleInlineVoiceResult}
        />
      )}
    </div>
  );
};

export default GlobalSearchBar;
