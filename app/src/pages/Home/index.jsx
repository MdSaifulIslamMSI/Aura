import { useState, useEffect, useMemo, useContext } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, Smartphone, Laptop, Headphones, Shirt, Home as HomeIcon, Gamepad2, BookOpen, Watch, Sparkles } from 'lucide-react';
import Carousel from '@/components/features/home/Carousel';
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

const HOME_SECTION_REQUEST = {
  limit: 8,
  includeMeta: false,
  includeTelemetry: false,
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
      const localCopy = {
        eyebrow: recommendationSignals.eyebrow,
        title: recommendationSignals.title,
        description: recommendationSignals.description,
        primaryCategory: recommendationSignals.primaryCategory,
      };

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
            eyebrow: serverResponse?.eyebrow || localCopy.eyebrow,
            title: serverResponse?.title || localCopy.title,
            description: serverResponse?.description || localCopy.description,
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
  }, [currentUser?.uid, recommendationSignals, cartLoading, wishlistLoading]);

  // Hero carousel slides
  const heroSlides = useMemo(() => [
    {
      image: '/assets/nano_banana_hero.png',
      alt: 'Nano Banana Pro',
      link: '/category/mobiles',
      title: 'QUANTUM 9 X',
      subtitle: 'Next Generation',
      description: 'Experience the revolution with the all-new Quantum 9 X. Design that changes everything.',
      cta: 'Explore'
    },
    {
      image: '/assets/nano_banana_camera.png',
      alt: 'Pro Camera System',
      link: '/category/electronics',
      title: 'Pro Optics',
      subtitle: 'Capture Everything',
      description: 'Triple lens system with 200MP main sensor. Photography redefined.',
      cta: 'Explore'
    },
    {
      image: '/assets/banner_feature_electronics.png',
      alt: 'Electronics Sale',
      link: '/category/electronics',
      title: 'Premium Audio',
      subtitle: 'New Arrivals',
      description: 'Laptops, headphones, and more starting at Rs 999.',
      cta: 'Shop Now'
    },
    {
      image: '/assets/banner_fashion_men.png',
      alt: 'Fashion Sale',
      link: "/category/men's-fashion",
      title: 'Streetwear 2026',
      subtitle: 'Neon Threads',
      description: 'Upgrade your aesthetic with the latest collection.',
      cta: 'View Style'
    },
    {
      image: '/assets/banner_home_kitchen.png',
      alt: 'Home & Kitchen Sale',
      link: '/category/home-kitchen',
      title: 'Smart Home',
      subtitle: 'Automation',
      description: 'Everything you need for a modern residence.',
      cta: 'Upgrade Home'
    }
  ], []);

  // Category icons - updated with modern styling
  const categories = useMemo(() => [
    { name: 'Mobiles', icon: Smartphone, path: '/category/mobiles', color: 'from-cyan-500/20 to-blue-500/20 text-cyan-400' },
    { name: 'Laptops', icon: Laptop, path: '/category/laptops', color: 'from-purple-500/20 to-fuchsia-500/20 text-fuchsia-400' },
    { name: 'Electronics', icon: Headphones, path: '/category/electronics', color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400' },
    { name: "Men's Fashion", icon: Shirt, path: "/category/men's-fashion", color: 'from-orange-500/20 to-amber-500/20 text-orange-400' },
    { name: "Women's Fashion", icon: Watch, path: "/category/women's-fashion", color: 'from-pink-500/20 to-rose-500/20 text-pink-400' },
    { name: 'Home & Kitchen', icon: HomeIcon, path: '/category/home-kitchen', color: 'from-yellow-500/20 to-orange-500/20 text-yellow-400' },
    { name: 'Gaming', icon: Gamepad2, path: '/category/gaming', color: 'from-red-500/20 to-rose-500/20 text-red-500' },
    { name: 'Books', icon: BookOpen, path: '/category/books', color: 'from-indigo-500/20 to-blue-500/20 text-indigo-400' },
  ], []);

  const commandMetrics = useMemo(() => [
    {
      label: 'Live price-drop picks',
      value: `${dealsOfTheDay.length || 0}`,
      detail: 'Discount-ranked products refreshed from catalog inventory',
    },
    {
      label: 'High-conviction trends',
      value: `${trendingProducts.length || 0}`,
      detail: 'Rating-led picks that are easiest to trust quickly',
    },
    {
      label: 'Fresh arrivals',
      value: `${newArrivals.length || 0}`,
      detail: 'Newly indexed products surfaced without clutter',
    },
  ], [dealsOfTheDay.length, newArrivals.length, trendingProducts.length]);

  const ProductSection = ({ eyebrow, title, description, link, actionLabel = 'Explore', products, isLoading, onAction }) => (
    <section className="bg-white/[0.045] backdrop-blur-xl rounded-2xl border border-white/10 shadow-glass mb-8 overflow-hidden relative group">
      {/* Decorative gradient blur */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-neo-cyan/8 rounded-full blur-[80px] -z-10 group-hover:bg-neo-cyan/15 transition-colors duration-700" />
      <div className="absolute -bottom-20 -left-10 w-64 h-64 bg-neo-emerald/8 rounded-full blur-[90px] -z-10 group-hover:bg-neo-emerald/15 transition-colors duration-700" />

      <div className="flex flex-col gap-4 border-b border-white/5 p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          {eyebrow ? (
            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.26em] text-neo-cyan">{eyebrow}</div>
          ) : null}
          <h2 className="text-xl md:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-2 text-sm text-slate-400 md:text-base">{description}</p>
          ) : null}
        </div>
        {typeof onAction === 'function' ? (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold uppercase tracking-[0.22em] text-neo-cyan transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-neo-emerald group/link"
          >
            {actionLabel}
            <div className="w-6 h-6 rounded-full bg-neo-cyan/10 flex items-center justify-center group-hover/link:bg-neo-fuchsia/20 group-hover/link:translate-x-1 transition-all">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        ) : (
          <Link
            to={link}
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold uppercase tracking-[0.22em] text-neo-cyan transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-neo-emerald group/link"
          >
            {actionLabel}
            <div className="w-6 h-6 rounded-full bg-neo-cyan/10 flex items-center justify-center group-hover/link:bg-neo-fuchsia/20 group-hover/link:translate-x-1 transition-all">
              <ChevronRight className="w-4 h-4" />
            </div>
          </Link>
        )}
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
            <SkeletonLoader type="card" count={6} />
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="text-sm text-slate-300">
              No products are available in this section right now. Please check back shortly.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen pb-16 pt-3 sm:pt-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 md:space-y-10">
        <RevealOnScroll anchorId="home-command-deck" anchorLabel="Command Deck" className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-glass lg:p-8 group/hero">
            <div className="absolute top-10 right-10 animate-pulse-glow opacity-30 group-hover/hero:opacity-60 transition-opacity"><Sparkles className="w-8 h-8 text-neo-cyan" /></div>
            <div className="absolute bottom-10 left-1/4 animate-pulse-glow opacity-20 group-hover/hero:opacity-50 transition-opacity" style={{ animationDelay: '1s' }}><Sparkles className="w-5 h-5 text-neo-fuchsia" /></div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-neo-cyan/20 bg-neo-cyan/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-neo-cyan">
              Retail Command Deck
            </div>
            <h1 className="text-shimmer max-w-3xl text-4xl font-black leading-[0.95] md:text-5xl xl:text-6xl pb-2">
              Search first. Trust faster. Move to checkout without noise.
            </h1>
            <p className="mt-4 max-w-2xl text-sm text-slate-300 md:text-base">
              The homepage is now a tighter decision surface for live search, trusted deals, and the next best purchase action.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/mission-control?goal=gaming%20setup%20under%20Rs%2080000&category=gaming&budget=80000" className="btn-secondary inline-flex items-center gap-2">
                Open Mission OS
              </Link>
              <Link to="/search?q=iphone" className="btn-primary inline-flex items-center gap-2">
                Start with live search
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/marketplace" className="btn-secondary inline-flex items-center gap-2">
                Open marketplace
              </Link>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            {commandMetrics.map((metric) => (
              <article key={metric.label} className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5 shadow-glass">
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{metric.label}</div>
                <div className="mt-3 text-3xl font-black text-white">{metric.value}</div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{metric.detail}</p>
              </article>
            ))}
          </section>
        </RevealOnScroll>

        <RevealOnScroll anchorId="home-mission-os" anchorLabel="Mission OS" delay={20}>
          <section className="relative overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-gradient-to-r from-cyan-500/10 via-white/[0.03] to-emerald-500/10 p-6 shadow-glass lg:p-7 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)] transition-shadow duration-500">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-gradient-x opacity-60" style={{ backgroundSize: '200% auto' }} />
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl">
                <div className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-100">New Command Layer</div>
                <h2 className="mt-2 text-2xl font-black text-white md:text-3xl">Shopping Mission OS now links goal, trust, lifecycle, and local commerce in one run.</h2>
                <p className="mt-3 text-sm text-slate-300 md:text-base">
                  Start from a mission brief, screenshot hint, or trade-in intent instead of bouncing between separate pages.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link to="/mission-control" className="btn-primary inline-flex items-center gap-2">
                  Launch Mission OS
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/visual-search" className="btn-secondary inline-flex items-center gap-2">
                  Zero-query search
                </Link>
              </div>
            </div>
          </section>
        </RevealOnScroll>

        {/* Category Navigation - clearer hierarchy */}
        <RevealOnScroll anchorId="home-categories" anchorLabel="Categories" className="mb-2">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-glass lg:p-6">
            <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.28em] text-neo-cyan">Category Access</div>
                <h2 className="mt-2 text-2xl font-black text-white md:text-3xl">Move through the catalog without friction.</h2>
              </div>
              <p className="max-w-xl text-sm text-slate-400">
                Each lane routes directly into a focused catalog surface. No filler rows, no fake categories, no dead navigation.
              </p>
            </div>
            <nav className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              {categories.map((category) => (
                <Link
                  key={category.path}
                  to={category.path}
                  className="group rounded-[1.35rem] border border-white/8 bg-white/[0.03] p-4 transition-all duration-500 hover:-translate-y-2 hover:scale-[1.03] hover:border-white/20 hover:bg-white/[0.08] hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                >
                  <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${category.color} border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] transition-transform duration-300 group-hover:scale-105`}>
                    <category.icon className="h-6 w-6" />
                  </div>
                  <div className="text-sm font-bold text-white">{category.name}</div>
                  <div className="mt-1 text-xs text-slate-400">Open lane</div>
                </Link>
              ))}
            </nav>
          </section>
        </RevealOnScroll>

        {/* Hero Carousel Container */}
        <RevealOnScroll
          anchorId="home-hero"
          anchorLabel="Hero"
          className="rounded-3xl overflow-hidden shadow-glass border border-white/10 relative group"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neo-cyan/60 to-transparent z-20" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60 z-10 pointer-events-none" />
          <Carousel
            slides={heroSlides}
            autoPlay={true}
            autoPlayInterval={6000}
            showIndicators={true}
            showArrows={true}
            className="z-0"
          />
        </RevealOnScroll>

        <RevealOnScroll anchorId="home-resume" anchorLabel="Resume Shopping" delay={40}>
          <SectionErrorBoundary label="Resume Shopping">
            <ProductSection
              eyebrow="Personalized Continuity"
              title="Resume Shopping"
              description="Top-tier commerce does not forget what you just evaluated. This shelf persists your recent product views and lets you re-enter high-intent decisions immediately."
              link="/search"
              actionLabel={resumeProducts.length > 0 ? 'Reset history' : 'Explore'}
              onAction={resumeProducts.length > 0 ? () => {
                clearRecentlyViewed();
                setResumeProducts([]);
              } : undefined}
              products={resumeProducts}
              isLoading={resumeLoading}
            />
          </SectionErrorBoundary>
        </RevealOnScroll>

        <RevealOnScroll anchorId="home-recommendations" anchorLabel="Recommendations" delay={50}>
          <SectionErrorBoundary label="AI Recommendations">
            <ProductSection
              eyebrow={recommendationCopy?.eyebrow || recommendationSignals.eyebrow}
              title={recommendationCopy?.title || recommendationSignals.title}
              description={recommendationCopy?.description || recommendationSignals.description}
              link={(recommendationCopy?.primaryCategory || recommendationSignals.primaryCategory) ? `/category/${recommendationCopy?.primaryCategory || recommendationSignals.primaryCategory}` : '/search'}
              actionLabel={(recommendationCopy?.primaryCategory || recommendationSignals.primaryCategory) ? 'Open lane' : 'Explore'}
              products={recommendedProducts}
              isLoading={recommendationsLoading}
            />
          </SectionErrorBoundary>
        </RevealOnScroll>

        {/* Deals of the Day */}
        <RevealOnScroll anchorId="home-flash-sales" anchorLabel="Flash Sales" delay={60}>
          <ProductSection
            eyebrow="Fastest Conversion Lane"
            title="Flash Sales"
            description="Price-drop inventory ranked for speed. These are the most decisive purchase candidates on the surface."
            link="/deals"
            products={dealsOfTheDay}
            isLoading={loading}
          />
        </RevealOnScroll>

        {/* Trending Products */}
        <RevealOnScroll anchorId="home-trending" anchorLabel="Trending Items" delay={110}>
          <ProductSection
            eyebrow="Trust-Led Picks"
            title="Trending Items"
            description="High-rating products surfaced with less noise so strong signals stand out immediately."
            link="/trending"
            products={trendingProducts}
            isLoading={loading}
          />
        </RevealOnScroll>

        {/* Marketplace CTA Banner */}
        <RevealOnScroll anchorId="home-marketplace" anchorLabel="Marketplace" delay={180}>
          <section className="bg-gradient-to-r from-neo-cyan/10 via-neo-emerald/10 to-teal-500/10 backdrop-blur-xl rounded-3xl border border-neo-cyan/20 p-8 md:p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-green-500/10 rounded-full blur-[100px] -z-10" />
            <div className="absolute bottom-0 left-0 w-60 h-60 bg-emerald-500/10 rounded-full blur-[80px] -z-10" />
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <span className="inline-block px-3 py-1 bg-neo-cyan/20 text-neo-cyan text-xs font-black tracking-widest uppercase rounded-full border border-neo-cyan/30 mb-3 backdrop-blur-md">
                  Marketplace
                </span>
                <h2 className="text-3xl md:text-4xl font-black text-white mb-2">
                  Buy and Sell <span className="text-transparent bg-clip-text bg-gradient-to-r from-neo-cyan to-neo-emerald">Near You</span>
                </h2>
                <p className="text-slate-400 max-w-md">
                  List pre-owned items or browse local offers with a cleaner, seller-aware marketplace entry point.
                </p>
              </div>
              <div className="flex gap-3 flex-shrink-0">
                <Link to="/marketplace" className="px-6 py-3 bg-white/10 backdrop-blur text-white font-bold rounded-xl border border-white/20 hover:bg-white/20 transition-all">
                  Browse
                </Link>
                <Link to="/sell" className="px-6 py-3 bg-gradient-to-r from-neo-cyan to-neo-emerald text-white font-bold rounded-xl shadow-lg shadow-emerald-500/25 hover:from-sky-500 hover:to-emerald-500 transition-all hover:-translate-y-0.5">
                  + Start Selling
                </Link>
              </div>
            </div>
          </section>
        </RevealOnScroll>

      </div>
    </div>
  );
};

export default Home;
