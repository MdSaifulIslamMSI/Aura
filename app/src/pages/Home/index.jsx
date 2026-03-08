import { useState, useEffect, useMemo, useContext } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, Smartphone, Laptop, Headphones, Shirt, Home as HomeIcon, Gamepad2, BookOpen, Watch, Search, ShieldCheck, Wallet, Store } from 'lucide-react';
import Carousel from '@/components/features/home/Carousel';
import ProductCard from '@/components/features/product/ProductCard';
import SkeletonLoader from '@/components/shared/SkeletonLoader';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { productApi } from '@/services/api';
import { clearRecentlyViewed, readRecentlyViewed } from '@/utils/recentlyViewed';
import { buildRecommendationSignals } from '@/utils/recommendationSignals';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';

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
  const { cartItems = [] } = useContext(CartContext) || {};
  const { wishlistItems = [] } = useContext(WishlistContext) || {};

  // Parallel Data Fetching (High Performance)
  useEffect(() => {
    const fetchHomeData = async () => {
      setLoading(true);
      try {
        const [dealsData, trendingData, arrivalsData] = await Promise.all([
          productApi.getProducts({ sort: 'discount', limit: 8 }),
          productApi.getProducts({ sort: 'rating', limit: 8 }), // Popularity/Rating
          productApi.getProducts({ sort: 'newest', limit: 8 })
        ]);

        setDealsOfTheDay(dealsData.products || []);
        setTrendingProducts(trendingData.products || []);
        setNewArrivals(arrivalsData.products || []);
      } catch (error) {
        console.error("Home Data Fetch Failed:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchHomeData();
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
        requests.push(productApi.getProducts({ category: rankedCategories[0], sort: 'rating', limit: 8 }));
      }
      if (rankedCategories[1]) {
        requests.push(productApi.getProducts({ category: rankedCategories[1], sort: 'discount', limit: 8 }));
      }
      if (recentQueries[0]) {
        requests.push(productApi.getProducts({ keyword: recentQueries[0], sort: 'relevance', limit: 8 }));
      }
      if (isColdStart) {
        requests.push(productApi.getProducts({ sort: 'rating', limit: 8 }));
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
  }, [currentUser?.uid, recommendationSignals]);

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

  const discoveryShortcuts = useMemo(() => ([
    {
      title: 'Search with intent',
      description: 'Jump straight into live catalog search with price and relevance already centered.',
      link: '/search?q=iphone',
      cta: 'Open Search',
      icon: Search,
      tone: 'from-neo-cyan/18 to-sky-500/10 text-neo-cyan',
    },
    {
      title: 'Move on trusted deals',
      description: 'Open the fastest price-drop lane when the goal is decision speed, not browsing.',
      link: '/deals',
      cta: 'Open Deals',
      icon: Wallet,
      tone: 'from-amber-400/18 to-orange-500/10 text-amber-200',
    },
    {
      title: 'Open local marketplace',
      description: 'Switch to seller-aware nearby commerce without losing the main retail shell.',
      link: '/marketplace',
      cta: 'Open Market',
      icon: Store,
      tone: 'from-neo-emerald/18 to-teal-500/10 text-neo-emerald',
    },
  ]), []);

  const trustMarkers = useMemo(() => ([
    'Catalog lanes are routed directly into real category surfaces.',
    'Recent views and recommendations persist so high-intent sessions do not reset.',
    'Discount, rating, and freshness lanes stay separated to reduce decision noise.',
  ]), []);

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
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            <SkeletonLoader type="card" count={6} />
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="text-sm text-slate-300">
              No products are available in this section right now. Please check back shortly.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen pb-16 pt-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <RevealOnScroll anchorId="home-command-deck" anchorLabel="Command Deck" className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-glass lg:p-8">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-neo-cyan/20 bg-neo-cyan/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-neo-cyan">
              Retail Command Deck
            </div>
            <h1 className="max-w-3xl text-4xl font-black leading-[0.95] text-white md:text-5xl xl:text-6xl">
              A sharper storefront for discovery, trust, and conversion.
            </h1>
            <p className="mt-4 max-w-2xl text-sm text-slate-300 md:text-base">
              The visual system now prioritizes product discovery and high-confidence actions first, instead of making every control compete equally.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
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
                  className="group rounded-[1.35rem] border border-white/8 bg-white/[0.03] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-white/18 hover:bg-white/[0.07]"
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

        <RevealOnScroll anchorId="home-decision-shortcuts" anchorLabel="Decision Shortcuts" delay={25}>
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-glass lg:p-6">
              <div className="mb-4 text-[11px] font-black uppercase tracking-[0.28em] text-neo-cyan">Decision Shortcuts</div>
              <div className="grid gap-4 md:grid-cols-3">
                {discoveryShortcuts.map((shortcut) => (
                  <Link
                    key={shortcut.title}
                    to={shortcut.link}
                    className="group rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-white/18 hover:bg-white/[0.06]"
                  >
                    <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br ${shortcut.tone}`}>
                      <shortcut.icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-black text-white">{shortcut.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{shortcut.description}</p>
                    <div className="mt-4 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-neo-cyan transition-all group-hover:gap-3">
                      {shortcut.cta}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-glass lg:p-6">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-neo-cyan">
                <ShieldCheck className="h-4 w-4" />
                Trust Layer
              </div>
              <h2 className="mt-3 text-2xl font-black text-white md:text-3xl">The homepage should reduce uncertainty before it asks for action.</h2>
              <div className="mt-5 space-y-3">
                {trustMarkers.map((marker) => (
                  <div
                    key={marker}
                    className="rounded-2xl border border-white/8 bg-zinc-950/35 px-4 py-3 text-sm leading-6 text-slate-300"
                  >
                    <span className="mr-2 text-neo-emerald">•</span>
                    {marker}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </RevealOnScroll>

        <RevealOnScroll anchorId="home-resume" anchorLabel="Resume Shopping" delay={40}>
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
        </RevealOnScroll>

        <RevealOnScroll anchorId="home-recommendations" anchorLabel="Recommendations" delay={50}>
          <ProductSection
            eyebrow={recommendationCopy?.eyebrow || recommendationSignals.eyebrow}
            title={recommendationCopy?.title || recommendationSignals.title}
            description={recommendationCopy?.description || recommendationSignals.description}
            link={(recommendationCopy?.primaryCategory || recommendationSignals.primaryCategory) ? `/category/${recommendationCopy?.primaryCategory || recommendationSignals.primaryCategory}` : '/search'}
            actionLabel={(recommendationCopy?.primaryCategory || recommendationSignals.primaryCategory) ? 'Open lane' : 'Explore'}
            products={recommendedProducts}
            isLoading={recommendationsLoading}
          />
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

        {/* New Arrivals */}
        <RevealOnScroll anchorId="home-new-arrivals" anchorLabel="New Arrivals" delay={140}>
          <ProductSection
            eyebrow="Fresh Catalog"
            title="New Arrivals"
            description="Recently indexed products brought forward without drowning the page in redundant merchandising."
            link="/new-arrivals"
            products={newArrivals}
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

        {/* Featured Banner - Modernized */}
        <RevealOnScroll
          anchorId="home-featured-banners"
          anchorLabel="Featured Banners"
          delay={220}
          className="grid md:grid-cols-2 gap-6"
        >
          <Link to="/category/electronics" className="block relative overflow-hidden rounded-3xl shadow-glass border border-white/10 group aspect-[2/1] md:aspect-auto md:h-80">
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent z-10" />
            <img
              src="/assets/banner_feature_electronics.png"
              alt="Premium Electronics"
              className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
            />
            <div className="absolute bottom-0 left-0 p-8 z-20">
              <span className="inline-block px-3 py-1 bg-neo-cyan/20 text-neo-cyan text-xs font-black tracking-widest uppercase rounded-full border border-neo-cyan/30 mb-3 backdrop-blur-md">Hardware</span>
              <h3 className="text-3xl font-black text-white mb-2 group-hover:text-neo-cyan transition-colors duration-300">Premium Tech Add-ons</h3>
              <p className="text-slate-300 font-medium max-w-sm">Upgrade your setup with the latest tech.</p>
            </div>
          </Link>

          <Link to="/category/fashion" className="block relative overflow-hidden rounded-3xl shadow-glass border border-white/10 group aspect-[2/1] md:aspect-auto md:h-80">
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent z-10" />
            <img
              src="/assets/banner_feature_fashion.png"
              alt="Neon Fashion"
              className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
            />
            <div className="absolute bottom-0 left-0 p-8 z-20">
              <span className="inline-block px-3 py-1 bg-neo-emerald/20 text-neo-emerald text-xs font-black tracking-widest uppercase rounded-full border border-neo-emerald/30 mb-3 backdrop-blur-md">Apparel</span>
              <h3 className="text-3xl font-black text-white mb-2 group-hover:text-neo-emerald transition-colors duration-300">Neon Streetwear</h3>
              <p className="text-slate-300 font-medium max-w-sm">Look sharp with the latest fashion lines.</p>
            </div>
          </Link>
        </RevealOnScroll>
      </div>
    </div>
  );
};

export default Home;
