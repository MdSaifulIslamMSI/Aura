import { useState, useEffect, useMemo, useContext } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgePercent,
  BookOpen,
  ChevronRight,
  Headphones,
  Home as HomeIcon,
  Laptop,
  PackageCheck,
  Search,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Truck,
  Watch,
  Gamepad2,
} from 'lucide-react';
import ProductCard from '@/components/features/product/ProductCard';
import SkeletonLoader from '@/components/shared/SkeletonLoader';
import SectionErrorBoundary from '@/components/shared/SectionErrorBoundary';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { productApi } from '@/services/api';
import { clearRecentlyViewed, readRecentlyViewed } from '@/utils/recentlyViewed';
import { buildRecommendationSignals } from '@/utils/recommendationSignals';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { useColorMode } from '@/context/ColorModeContext';
import { useMarket } from '@/context/MarketContext';
import { FIGMA_COLOR_MODE_OPTIONS } from '@/config/figmaTokens';
import { cn } from '@/lib/utils';
import { getBaseAmount, getBaseCurrency } from '@/utils/pricing';

const HOME_SECTION_REQUEST = {
  limit: 8,
  includeMeta: false,
  includeTelemetry: false,
};

const hexToRgb = (hex) => {
  const normalized = String(hex || '').trim().replace('#', '');
  if (!normalized) return { r: 6, g: 182, b: 212 };

  const safeHex = normalized.length === 3
    ? normalized.split('').map((value) => `${value}${value}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);

  const value = Number.parseInt(safeHex, 16);
  if (!Number.isFinite(value)) {
    return { r: 6, g: 182, b: 212 };
  }

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

const toRgba = (hex, alpha) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const HOME_CATEGORY_TRANSLATION_KEYS = {
  mobiles: 'category.mobiles',
  laptops: 'category.laptops',
  electronics: 'category.electronics',
  "men's-fashion": 'category.mensFashion',
  "women's-fashion": 'category.womensFashion',
  'home-kitchen': 'category.homeKitchen',
  gaming: 'category.gaming',
  books: 'category.books',
};

const Home = () => {
  // Independent State (Decoupled from Global Context)
  const [dealsOfTheDay, setDealsOfTheDay] = useState([]);
  const [trendingProducts, setTrendingProducts] = useState([]);
  const [newArrivals, setNewArrivals] = useState([]);
  const [resumeProducts, setResumeProducts] = useState([]);
  const [resumeLoading, setResumeLoading] = useState(true);
  const [recommendedProducts, setRecommendedProducts] = useState([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [recommendationCopy, setRecommendationCopy] = useState(null);
  const [loading, setLoading] = useState(true);
  const { currentUser = null } = useContext(AuthContext) || {};
  const { cartItems = [], isLoading: cartLoading = false } = useContext(CartContext) || {};
  const { wishlistItems = [], isLoading: wishlistLoading = false } = useContext(WishlistContext) || {};
  const { colorMode } = useColorMode();
  const { t, formatPrice } = useMarket();
  const isWhiteMode = colorMode === 'white';
  const modePalette = FIGMA_COLOR_MODE_OPTIONS.find((mode) => mode.value === colorMode) || FIGMA_COLOR_MODE_OPTIONS[0];
  const accentPrimary = modePalette.primary;
  const accentSecondary = modePalette.secondary;
  const accentTertiary = modePalette.tertiary || modePalette.primary;
  const mutedTextClass = isWhiteMode ? 'text-slate-600' : 'text-slate-300';
  const subtleTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
  const titleClass = isWhiteMode ? 'text-slate-950' : 'text-white';
  const pageShellClass = isWhiteMode ? 'bg-[#eff4ff] text-slate-900' : 'bg-transparent text-slate-100';
  const heroStyle = isWhiteMode
    ? {
        borderColor: toRgba(accentPrimary, 0.12),
      }
    : {
        borderColor: toRgba(accentPrimary, 0.12),
      };
  const accentFillStyle = {
    backgroundImage: `linear-gradient(120deg, ${accentPrimary}, ${accentSecondary})`,
    boxShadow: `0 18px 38px ${toRgba(accentPrimary, isWhiteMode ? 0.16 : 0.24)}`,
    color: '#ffffff',
  };
  const accentSoftStyle = {
    borderColor: toRgba(accentPrimary, isWhiteMode ? 0.14 : 0.22),
    background: isWhiteMode ? toRgba(accentPrimary, 0.08) : toRgba(accentPrimary, 0.12),
    color: isWhiteMode ? accentPrimary : '#f8fafc',
  };

  // Parallel Data Fetching (High Performance)
  useEffect(() => {
    let isMounted = true;
    let retryTimer = null;

    const fetchHomeData = async (attempt = 0) => {
      let keepLoading = false;
      setLoading(true);
      try {
        const [dealsResult, trendingResult, arrivalsResult] = await Promise.allSettled([
          productApi.getProducts({ ...HOME_SECTION_REQUEST, sort: 'discount' }),
          productApi.getProducts({ ...HOME_SECTION_REQUEST, sort: 'rating' }), // Popularity/Rating
          productApi.getProducts({ ...HOME_SECTION_REQUEST, sort: 'newest' })
        ]);

        if (!isMounted) return;

        const hasAnySuccess = [dealsResult, trendingResult, arrivalsResult]
          .some((result) => result.status === 'fulfilled');

        if (dealsResult.status === 'fulfilled') {
          setDealsOfTheDay(dealsResult.value?.products || []);
        }
        if (trendingResult.status === 'fulfilled') {
          setTrendingProducts(trendingResult.value?.products || []);
        }
        if (arrivalsResult.status === 'fulfilled') {
          setNewArrivals(arrivalsResult.value?.products || []);
        }

        if (!hasAnySuccess && attempt < 1) {
          keepLoading = true;
          retryTimer = window.setTimeout(() => {
            fetchHomeData(attempt + 1);
          }, 5000);
          return;
        }
      } catch (error) {
        console.error("Home Data Fetch Failed:", error);
      } finally {
        if (isMounted && !keepLoading) {
          setLoading(false);
        }
      }
    };

    fetchHomeData();
    return () => {
      isMounted = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadResumeProducts = async () => {
      setResumeLoading(true);
      const recentlyViewed = readRecentlyViewed().slice(0, 6);

      if (!active) return;
      if (recentlyViewed.length === 0) {
        setResumeProducts([]);
        setResumeLoading(false);
        return;
      }

      setResumeProducts(recentlyViewed);

      const hydrated = await Promise.allSettled(
        recentlyViewed.map((item) => productApi.getProductById(item.id))
      );

      if (!active) return;

      const resolved = hydrated
        .map((result, index) => (result.status === 'fulfilled' ? result.value : recentlyViewed[index]))
        .filter(Boolean);

      setResumeProducts(resolved);
      setResumeLoading(false);
    };

    loadResumeProducts();

    return () => {
      active = false;
    };
  }, []);

  const recommendationSignals = useMemo(
    () => buildRecommendationSignals({ cartItems, wishlistItems }),
    [cartItems, wishlistItems]
  );

  const localizedPrimaryCategory = useMemo(() => {
    const primaryCategory = recommendationSignals.primaryCategory;
    if (!primaryCategory) return '';
    return t(
      HOME_CATEGORY_TRANSLATION_KEYS[primaryCategory] || '',
      {},
      String(primaryCategory).replace(/-/g, ' ')
    );
  }, [recommendationSignals.primaryCategory, t]);

  const localizedRecommendationCopy = useMemo(() => {
    let eyebrow = t('home.recommendations.intentEyebrow', {}, 'Intent-Based Recommendations');
    let title = t('home.recommendations.intentTitle', {}, 'Curated for Your Next Move');
    let description = t('home.recommendations.intentBody', {}, 'This lane is ranked from what you added, saved, viewed, and searched.');

    if (cartItems.length > 0 && localizedPrimaryCategory) {
      eyebrow = t('home.recommendations.cartEyebrow', {}, 'Cart Momentum');
      title = t('home.recommendations.cartTitle', { category: localizedPrimaryCategory }, 'Keep building your {{category}} stack');
      description = t('home.recommendations.cartBody', {}, 'These picks reinforce what is already converting in your basket and shorten the next decision.');
    } else if (wishlistItems.length > 0 && localizedPrimaryCategory) {
      eyebrow = t('home.recommendations.wishlistEyebrow', {}, 'Wishlist Signal');
      title = t('home.recommendations.wishlistTitle', { category: localizedPrimaryCategory }, 'More from your {{category}} watchlist');
      description = t('home.recommendations.wishlistBody', {}, 'This lane expands the products you already marked as high intent.');
    } else if (recommendationSignals.recentItems.length > 0) {
      eyebrow = t('home.recommendations.resumeEyebrow', {}, 'Resume Discovery');
      title = t('home.recommendations.resumeTitle', {}, 'Continue where your product research left off');
      description = t('home.recommendations.resumeBody', {}, 'These picks follow your recent product-detail visits so the session does not reset to zero.');
    } else if (recommendationSignals.recentQueries.length > 0) {
      eyebrow = t('home.recommendations.searchEyebrow', {}, 'Search Intent');
      title = t('home.recommendations.searchTitle', { query: recommendationSignals.recentQueries[0] }, 'Results shaped around "{{query}}"');
      description = t('home.recommendations.searchBody', {}, 'Your recent search behavior is steering this lane, even before you add anything to cart.');
    } else if (recommendationSignals.isColdStart) {
      eyebrow = t('home.recommendations.coldEyebrow', {}, 'Cold Start Picks');
      title = t('home.recommendations.coldTitle', {}, 'Start with high-confidence catalog winners');
      description = t('home.recommendations.coldBody', {}, 'No personal signal yet, so this lane defaults to broad, high-trust discovery.');
    }

    return {
      eyebrow,
      title,
      description,
      primaryCategory: recommendationSignals.primaryCategory,
    };
  }, [
    cartItems.length,
    localizedPrimaryCategory,
    recommendationSignals.isColdStart,
    recommendationSignals.primaryCategory,
    recommendationSignals.recentItems.length,
    recommendationSignals.recentQueries,
    t,
    wishlistItems.length,
  ]);

  useEffect(() => {
    let active = true;

    const loadLocalRecommendations = async () => {
      const { rankedCategories, recentQueries, excludeIds, isColdStart } = recommendationSignals;
      const requests = [];

      if (rankedCategories[0]) {
        requests.push(productApi.getProducts({ ...HOME_SECTION_REQUEST, category: rankedCategories[0], sort: 'rating' }));
      }
      if (rankedCategories[1]) {
        requests.push(productApi.getProducts({ ...HOME_SECTION_REQUEST, category: rankedCategories[1], sort: 'discount' }));
      }
      if (recentQueries[0]) {
        requests.push(productApi.getProducts({ ...HOME_SECTION_REQUEST, keyword: recentQueries[0], sort: 'relevance' }));
      }
      if (isColdStart) {
        requests.push(productApi.getProducts({ ...HOME_SECTION_REQUEST, sort: 'rating' }));
      }

      const responses = requests.length > 0 ? await Promise.allSettled(requests) : [];
      const merged = responses
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value?.products || [])
        .filter(Boolean);

      const deduped = [];
      const seen = new Set();

      for (const item of merged) {
        const productId = String(item?.id || item?._id || '').trim();
        if (!productId || seen.has(productId) || excludeIds.has(productId)) continue;
        seen.add(productId);
        deduped.push(item);
        if (deduped.length >= 6) break;
      }

      return deduped;
    };

    const mergeUniqueProducts = (primary = [], secondary = []) => {
      const merged = [];
      const seen = new Set();

      [...primary, ...secondary].forEach((item) => {
        const productId = String(item?.id || item?._id || '').trim();
        if (!productId || seen.has(productId)) return;
        seen.add(productId);
        merged.push(item);
      });

      return merged.slice(0, 6);
    };

    const loadRecommendations = async () => {
      if (currentUser && (cartLoading || wishlistLoading)) {
        return;
      }

      setRecommendationsLoading(true);
      const localCopy = localizedRecommendationCopy;

      let nextProducts = [];
      let nextCopy = localCopy;

      try {
        if (currentUser) {
          const serverResponse = await productApi.getRecommendations({
            recentlyViewed: recommendationSignals.recentItems.slice(0, 6).map((item) => ({
              id: item?.id || item?._id || '',
              category: item?.category || '',
              brand: item?.brand || '',
            })),
            searchHistory: recommendationSignals.recentQueries.slice(0, 3),
            limit: 6,
          });

          nextProducts = Array.isArray(serverResponse?.products) ? serverResponse.products : [];
          nextCopy = {
            eyebrow: localCopy.eyebrow,
            title: localCopy.title,
            description: localCopy.description,
            primaryCategory: serverResponse?.primaryCategory || localCopy.primaryCategory,
          };
        }

        const localProducts = await loadLocalRecommendations();
        nextProducts = mergeUniqueProducts(nextProducts, localProducts);
      } catch (error) {
        console.error('Personalized recommendations failed:', error);
        nextProducts = await loadLocalRecommendations();
      }

      if (!active) return;

      if (nextProducts.length === 0) {
        nextCopy = localCopy;
      }

      setRecommendedProducts(nextProducts);
      setRecommendationCopy(nextCopy);
      setRecommendationsLoading(false);
    };

    loadRecommendations();

    return () => {
      active = false;
    };
  }, [currentUser?.uid, recommendationSignals, localizedRecommendationCopy, cartLoading, wishlistLoading]);

  // Category icons - updated with modern styling
  const categories = useMemo(() => [
    { name: t('category.mobiles', {}, 'Mobiles'), icon: Smartphone, path: '/category/mobiles', color: 'border-cyan-300/25 bg-cyan-400/10 text-cyan-100' },
    { name: t('category.laptops', {}, 'Laptops'), icon: Laptop, path: '/category/laptops', color: 'border-sky-300/25 bg-sky-400/10 text-sky-100' },
    { name: t('category.electronics', {}, 'Electronics'), icon: Headphones, path: '/category/electronics', color: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' },
    { name: t('category.mensFashion', {}, "Men's Fashion"), icon: Shirt, path: "/category/men's-fashion", color: 'border-orange-300/25 bg-orange-400/10 text-orange-100' },
    { name: t('category.womensFashion', {}, "Women's Fashion"), icon: Watch, path: "/category/women's-fashion", color: 'border-rose-300/25 bg-rose-400/10 text-rose-100' },
    { name: t('category.homeKitchen', {}, 'Home & Kitchen'), icon: HomeIcon, path: '/category/home-kitchen', color: 'border-amber-300/25 bg-amber-400/10 text-amber-100' },
    { name: t('category.gaming', {}, 'Gaming'), icon: Gamepad2, path: '/category/gaming', color: 'border-red-300/25 bg-red-400/10 text-red-100' },
    { name: t('category.books', {}, 'Books'), icon: BookOpen, path: '/category/books', color: 'border-indigo-300/25 bg-indigo-400/10 text-indigo-100' },
  ], [t]);

  const heroQuickActions = useMemo(() => [
    {
      title: t('home.hero.quickSearchTitle', {}, 'Start with search'),
      detail: t('home.hero.quickSearchBody', {}, 'Jump straight into products, brands, and categories without wading through filler blocks first.'),
      path: '/search',
      icon: Search,
    },
    {
      title: t('home.hero.quickDealsTitle', {}, 'Shop trusted deals'),
      detail: t('home.hero.quickDealsBody', {}, 'Go directly to high-signal discounts and top-rated picks when you already know what you want.'),
      path: '/deals',
      icon: ShieldCheck,
    },
    {
      title: t('home.hero.quickMarketplaceTitle', {}, 'Browse local marketplace'),
      detail: t('home.hero.quickMarketplaceBody', {}, 'Switch into nearby listings and resale inventory when you want seller-aware browsing.'),
      path: '/marketplace',
      icon: Store,
    },
  ], [t]);

  const heroProducts = useMemo(() => {
    const seen = new Set();
    const liveProducts = [
      ...recommendedProducts,
      ...dealsOfTheDay,
      ...trendingProducts,
      ...newArrivals,
    ].filter((product) => {
      const productId = String(product?.id || product?._id || product?.title || '').trim();
      if (!productId || seen.has(productId)) return false;
      seen.add(productId);
      return true;
    });

    return liveProducts.slice(0, 4);
  }, [dealsOfTheDay, newArrivals, recommendedProducts, trendingProducts]);

  const heroSpotlight = heroProducts[0] || null;
  const heroSpotlightPrice = heroSpotlight
    ? formatPrice(
        getBaseAmount(heroSpotlight),
        undefined,
        undefined,
        { baseCurrency: getBaseCurrency(heroSpotlight) }
      )
    : '';

  const heroSignals = useMemo(() => [
    {
      label: t('home.hero.signalDeals', {}, 'Deal desk'),
      value: loading ? t('home.hero.signalLive', {}, 'Live') : `${dealsOfTheDay.length}+`,
      detail: t('home.hero.signalDealsBody', {}, 'price-drop picks'),
      icon: BadgePercent,
    },
    {
      label: t('home.hero.signalTrust', {}, 'Trust layer'),
      value: t('home.hero.signalTrustValue', {}, 'Verified'),
      detail: t('home.hero.signalTrustBody', {}, 'ratings, stock, delivery'),
      icon: ShieldCheck,
    },
    {
      label: t('home.hero.signalCart', {}, 'Your intent'),
      value: `${cartItems.length + wishlistItems.length}`,
      detail: t('home.hero.signalCartBody', {}, 'cart and saved signals'),
      icon: ShoppingBag,
    },
  ], [cartItems.length, dealsOfTheDay.length, loading, t, wishlistItems.length]);

  const ProductSection = ({ eyebrow, title, description, link, actionLabel = t('home.action.explore', {}, 'Explore'), products, isLoading, onAction }) => (
    <section className="aura-product-shelf premium-grid-backdrop mb-8 overflow-hidden relative group" style={heroStyle}>
      <div className="aura-product-shelf__header flex flex-col gap-4 border-b border-white/5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          {eyebrow ? (
            <div className="premium-kicker mb-2">{eyebrow}</div>
          ) : null}
          <h2 className={cn('text-xl md:text-2xl font-black tracking-tight', titleClass)}>{title}</h2>
          {description ? (
            <p className={cn('mt-2 text-sm md:text-base', mutedTextClass)}>{description}</p>
          ) : null}
        </div>
        {typeof onAction === 'function' ? (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-bold uppercase tracking-[0.22em] transition-all group/link"
            style={accentSoftStyle}
          >
            {actionLabel}
            <div className="w-6 h-6 rounded-full flex items-center justify-center transition-all group-hover/link:translate-x-1" style={{ background: toRgba(accentPrimary, isWhiteMode ? 0.12 : 0.18) }}>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        ) : (
          <Link
            to={link}
            className="inline-flex items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-bold uppercase tracking-[0.22em] transition-all group/link"
            style={accentSoftStyle}
          >
            {actionLabel}
            <div className="w-6 h-6 rounded-full flex items-center justify-center transition-all group-hover/link:translate-x-1" style={{ background: toRgba(accentPrimary, isWhiteMode ? 0.12 : 0.18) }}>
              <ChevronRight className="w-4 h-4" />
            </div>
          </Link>
        )}
      </div>

      <div className="p-4 sm:p-6">
        {isLoading ? (
            <div className="aura-home-product-grid grid gap-4">
              <SkeletonLoader type="card" count={6} />
            </div>
        ) : products.length === 0 ? (
          <div className={cn(
            'rounded-2xl border p-6 text-center',
            isWhiteMode ? 'border-slate-200 bg-white/75' : 'border-white/10 bg-white/5'
          )}>
            <p className={cn('text-sm', mutedTextClass)}>
              {t('home.section.empty', {}, 'No products are available in this section right now. Please check back shortly.')}
            </p>
          </div>
        ) : (
            <div className="aura-home-product-grid grid gap-4">
              {products.map((product, index) => (
              <ProductCard
                key={product.id || product._id || product.title}
                product={product}
                harmonyIndex={index}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  const shouldShowResumeSection = resumeLoading || resumeProducts.length > 0;
  const shouldShowRecommendationSection = recommendationsLoading || recommendedProducts.length > 0;
  const shouldShowDealsSection = loading || dealsOfTheDay.length > 0;
  const shouldShowTrendingSection = loading || trendingProducts.length > 0;
  const shouldShowNewArrivalsSection = loading || newArrivals.length > 0;

  return (
    <div className={cn('premium-page-shell min-h-screen pb-16 pt-3 sm:pt-4', pageShellClass)}>
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: isWhiteMode
              ? `linear-gradient(135deg, ${toRgba(accentPrimary, 0.1)} 0%, transparent 30%), linear-gradient(245deg, ${toRgba(accentSecondary, 0.09)} 0%, transparent 34%), linear-gradient(25deg, ${toRgba(accentTertiary, 0.08)} 0%, transparent 38%), linear-gradient(180deg, var(--theme-bg-base) 0%, rgb(var(--theme-surface-strong-rgb) / 0.92) 52%, rgb(var(--theme-surface-rgb) / 0.98) 100%)`
              : `linear-gradient(135deg, ${toRgba(accentPrimary, 0.17)} 0%, transparent 32%), linear-gradient(245deg, ${toRgba(accentSecondary, 0.13)} 0%, transparent 34%), linear-gradient(25deg, ${toRgba(accentTertiary, 0.11)} 0%, transparent 40%), linear-gradient(180deg, var(--theme-bg-base) 0%, rgb(var(--theme-surface-strong-rgb) / 0.97) 52%, rgb(var(--theme-surface-rgb) / 0.94) 100%)`,
          }}
        />
        <div
          className="absolute inset-0 opacity-35 [background-size:72px_72px]"
          style={{
            backgroundImage: isWhiteMode
              ? 'linear-gradient(rgb(var(--theme-grid-rgb) / 0.075) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--theme-grid-rgb) / 0.06) 1px, transparent 1px)'
              : 'linear-gradient(rgb(var(--theme-grid-rgb) / 0.055) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--theme-grid-rgb) / 0.045) 1px, transparent 1px)',
          }}
        />
      </div>
      <div className="premium-page-frame space-y-8 md:space-y-10">
        <RevealOnScroll anchorId="home-command-deck" anchorLabel={t('home.anchor.commandDeck', {}, 'Command Deck')} className="aura-home-hero-shell">
          <div className="aura-home-hero-grid">
            <section className="aura-home-hero-copy">
              <div className="premium-eyebrow mb-4">
                <Sparkles className="h-3.5 w-3.5" />
                {t('home.hero.cleanEyebrow', {}, 'Aura Market Dispatch')}
              </div>
              <h1 className={cn('max-w-4xl pb-2 text-4xl font-black leading-[0.96] tracking-tight md:text-5xl xl:text-6xl', titleClass)}>
                {t('home.hero.cleanTitle', {}, 'A sharper storefront for product decisions that move.')}
              </h1>
              <p className={cn('mt-4 max-w-2xl text-sm leading-7 md:text-base', mutedTextClass)}>
                {t('home.hero.cleanBody', {}, 'Browse a calmer commerce desk where deals, trusted inventory, and local marketplace lanes stay close to the products themselves.')}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/search" className="btn-primary inline-flex items-center gap-2" style={accentFillStyle}>
                  {t('home.hero.cleanSearchAction', {}, 'Search products')}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/deals" className="btn-secondary inline-flex items-center gap-2">
                  {t('home.hero.cleanDealsAction', {}, 'Shop deal desk')}
                </Link>
                <Link to="/marketplace" className="btn-secondary inline-flex items-center gap-2">
                  {t('home.hero.cleanMarketplaceAction', {}, 'Local marketplace')}
                </Link>
              </div>
              <div className="aura-home-signal-grid mt-7">
                {heroSignals.map((signal) => {
                  const Icon = signal.icon;
                  return (
                    <div key={signal.label} className="aura-home-signal">
                      <Icon className="h-4 w-4" />
                      <div>
                        <div className={cn('text-lg font-black leading-none', titleClass)}>{signal.value}</div>
                        <div className={cn('mt-1 text-[10px] font-black uppercase tracking-[0.18em]', subtleTextClass)}>{signal.label}</div>
                        <p className={cn('mt-1 text-xs leading-5', mutedTextClass)}>{signal.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <aside className="aura-home-product-stage" aria-label={t('home.hero.stageLabel', {}, 'Featured products')}>
              <div className="aura-home-stage-header">
                <div>
                  <div className="premium-kicker">{t('home.hero.stageEyebrow', {}, 'Live pick')}</div>
                  <h2 className={cn('mt-2 text-2xl font-black tracking-tight', titleClass)}>
                    {heroSpotlight?.displayTitle || heroSpotlight?.title || t('home.hero.stageTitle', {}, 'Catalog signal board')}
                  </h2>
                </div>
                <span className="aura-home-stage-pill">
                  <Star className="h-3.5 w-3.5 fill-current" />
                  {heroSpotlight?.rating ? Number(heroSpotlight.rating).toFixed(1).replace(/\.0$/, '') : t('home.hero.stageRatingFallback', {}, 'Top')}
                </span>
              </div>

              <Link
                to={heroSpotlight?.id || heroSpotlight?._id ? `/product/${heroSpotlight.id || heroSpotlight._id}` : '/products'}
                className="aura-home-spotlight"
              >
                <div className="aura-home-spotlight-media">
                  {heroSpotlight?.image ? (
                    <img src={heroSpotlight.image} alt={heroSpotlight.displayTitle || heroSpotlight.title || t('home.hero.stageTitle', {}, 'Catalog signal board')} />
                  ) : (
                    <div className="aura-home-spotlight-placeholder">
                      <PackageCheck className="h-14 w-14" />
                    </div>
                  )}
                </div>
                <div className="aura-home-spotlight-copy">
                  <span>{heroSpotlight?.brand || t('home.hero.stageBrandFallback', {}, 'Aura Select')}</span>
                  <strong>{heroSpotlightPrice || t('home.hero.stagePriceFallback', {}, 'Fresh inventory')}</strong>
                </div>
              </Link>

              <div className="aura-home-stage-stack">
                {heroProducts.slice(1, 4).map((product) => {
                  const productId = product?.id || product?._id;
                  return (
                    <Link key={productId || product.title} to={productId ? `/product/${productId}` : '/products'} className="aura-home-stage-row">
                      <span className="aura-home-stage-row-thumb">
                        {product?.image ? <img src={product.image} alt={product.displayTitle || product.title || ''} /> : <Truck className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('block truncate text-sm font-black', titleClass)}>{product?.displayTitle || product?.title}</span>
                        <span className={cn('mt-1 block truncate text-xs', subtleTextClass)}>{product?.deliveryTime || t('product.fastDispatch', {}, 'Fast dispatch')}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </aside>
          </div>

          <section className="aura-home-action-ribbon" aria-label={t('home.hero.quickActionsLabel', {}, 'Quick shopping lanes')}>
            {heroQuickActions.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="aura-home-action"
                >
                  <div className="aura-home-action-icon">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className={cn('text-sm font-black tracking-tight', titleClass)}>{item.title}</div>
                    <p className={cn('mt-1 text-xs leading-5', mutedTextClass)}>{item.detail}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </Link>
              );
            })}
          </section>
        </RevealOnScroll>

        {/* Category Navigation - clearer hierarchy */}
        <RevealOnScroll anchorId="home-categories" anchorLabel={t('home.anchor.categories', {}, 'Categories')} className="mb-2">
          <section className="aura-category-shelf premium-grid-backdrop p-5 lg:p-6" style={heroStyle}>
            <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="premium-kicker">{t('home.categories.cleanEyebrow', {}, 'Shop by category')}</div>
                <h2 className={cn('mt-2 text-2xl font-black md:text-3xl', titleClass)}>{t('home.categories.title', {}, 'Move through the catalog without friction.')}</h2>
              </div>
              <p className={cn('max-w-xl text-sm', mutedTextClass)}>
                {t('home.categories.cleanBody', {}, 'Use categories as the fastest way into focused product lists when you already know the lane you want.')}
              </p>
            </div>
            <nav className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              {categories.map((category) => (
                <Link
                  key={category.path}
                  to={category.path}
                  className="aura-category-tile group"
                >
                  <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border ${category.color} shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] transition-transform duration-300 group-hover:scale-105`}>
                    <category.icon className="h-6 w-6" />
                  </div>
                  <div className={cn('text-sm font-bold', titleClass)}>{category.name}</div>
                  <div className={cn('mt-1 text-xs', subtleTextClass)}>{t('home.categories.openLane', {}, 'Open lane')}</div>
                </Link>
              ))}
            </nav>
          </section>
        </RevealOnScroll>

        {shouldShowResumeSection ? (
          <RevealOnScroll anchorId="home-resume" anchorLabel={t('home.anchor.resume', {}, 'Resume Shopping')} delay={40}>
            <SectionErrorBoundary label={t('home.resume.title', {}, 'Resume Shopping')}>
              <ProductSection
                eyebrow={t('home.resume.cleanEyebrow', {}, 'Continue shopping')}
                title={t('home.resume.title', {}, 'Resume Shopping')}
                description={t('home.resume.cleanBody', {}, 'Pick up recent product research without restarting the session from scratch.')}
                link="/search"
                actionLabel={resumeProducts.length > 0 ? t('home.resume.reset', {}, 'Reset history') : t('home.action.explore', {}, 'Explore')}
                onAction={resumeProducts.length > 0 ? () => {
                  clearRecentlyViewed();
                  setResumeProducts([]);
                } : undefined}
                products={resumeProducts}
                isLoading={resumeLoading}
              />
            </SectionErrorBoundary>
          </RevealOnScroll>
        ) : null}

        {shouldShowRecommendationSection ? (
          <RevealOnScroll anchorId="home-recommendations" anchorLabel={t('home.anchor.recommendations', {}, 'Recommendations')} delay={50}>
            <SectionErrorBoundary label={t('home.recommendations.label', {}, 'AI Recommendations')}>
              <ProductSection
                eyebrow={recommendationCopy?.eyebrow || localizedRecommendationCopy.eyebrow}
                title={recommendationCopy?.title || localizedRecommendationCopy.title}
                description={recommendationCopy?.description || localizedRecommendationCopy.description}
                link={(recommendationCopy?.primaryCategory || localizedRecommendationCopy.primaryCategory) ? `/category/${recommendationCopy?.primaryCategory || localizedRecommendationCopy.primaryCategory}` : '/search'}
                actionLabel={(recommendationCopy?.primaryCategory || localizedRecommendationCopy.primaryCategory) ? t('home.categories.openLane', {}, 'Open lane') : t('home.action.explore', {}, 'Explore')}
                products={recommendedProducts}
                isLoading={recommendationsLoading}
              />
            </SectionErrorBoundary>
          </RevealOnScroll>
        ) : null}

        {/* Deals of the Day */}
        {shouldShowDealsSection ? (
          <RevealOnScroll anchorId="home-flash-sales" anchorLabel={t('home.anchor.flashSales', {}, 'Flash Sales')} delay={60}>
            <ProductSection
              eyebrow={t('home.flashSales.cleanEyebrow', {}, 'Deals worth opening')}
              title={t('home.flashSales.title', {}, 'Flash Sales')}
              description={t('home.flashSales.cleanBody', {}, 'Current price-drop picks with less surrounding noise and faster paths into the product list.')}
              link="/deals"
              products={dealsOfTheDay}
              isLoading={loading}
            />
          </RevealOnScroll>
        ) : null}

        {/* Trending Products */}
        {shouldShowTrendingSection ? (
          <RevealOnScroll anchorId="home-trending" anchorLabel={t('home.anchor.trending', {}, 'Trending Items')} delay={110}>
            <ProductSection
              eyebrow={t('home.trending.cleanEyebrow', {}, 'Popular right now')}
              title={t('home.trending.title', {}, 'Trending Items')}
              description={t('home.trending.cleanBody', {}, 'High-rating products surfaced in a cleaner shelf so the strongest signals stand out immediately.')}
              link="/trending"
              products={trendingProducts}
              isLoading={loading}
            />
          </RevealOnScroll>
        ) : null}

        {shouldShowNewArrivalsSection ? (
          <RevealOnScroll anchorId="home-new-arrivals" anchorLabel={t('home.anchor.newArrivals', {}, 'New Arrivals')} delay={150}>
            <ProductSection
              eyebrow={t('home.arrivals.cleanEyebrow', {}, 'Just added')}
              title={t('home.arrivals.cleanTitle', {}, 'New Arrivals')}
              description={t('home.arrivals.cleanBody', {}, 'Freshly indexed products gathered into one shelf instead of being buried under another marketing panel.')}
              link="/new-arrivals"
              products={newArrivals}
              isLoading={loading}
            />
          </RevealOnScroll>
        ) : null}

      </div>
    </div>
  );
};

export default Home;
