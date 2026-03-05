import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Smartphone, Laptop, Headphones, Shirt, Home as HomeIcon, Gamepad2, BookOpen, Watch } from 'lucide-react';
import Carousel from '@/components/features/home/Carousel';
import ProductCard from '@/components/features/product/ProductCard';
import SkeletonLoader from '@/components/shared/SkeletonLoader';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { productApi } from '@/services/api';

const Home = () => {
  // Independent State (Decoupled from Global Context)
  const [dealsOfTheDay, setDealsOfTheDay] = useState([]);
  const [trendingProducts, setTrendingProducts] = useState([]);
  const [newArrivals, setNewArrivals] = useState([]);
  const [loading, setLoading] = useState(true);

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
      description: 'Laptops, headphones, and more starting at ₹999.',
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

  const ProductSection = ({ title, link, products, isLoading }) => (
    <section className="bg-white/[0.045] backdrop-blur-xl rounded-2xl border border-white/10 shadow-glass mb-8 overflow-hidden relative group">
      {/* Decorative gradient blur */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-neo-cyan/8 rounded-full blur-[80px] -z-10 group-hover:bg-neo-cyan/15 transition-colors duration-700" />
      <div className="absolute -bottom-20 -left-10 w-64 h-64 bg-neo-emerald/8 rounded-full blur-[90px] -z-10 group-hover:bg-neo-emerald/15 transition-colors duration-700" />

      <div className="flex items-center justify-between p-6 border-b border-white/5">
        <h2 className="text-xl md:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 tracking-tight">{title}</h2>
        <Link
          to={link}
          className="flex items-center gap-2 text-neo-cyan hover:text-neo-emerald transition-all text-sm font-bold tracking-widest uppercase group/link"
        >
          Explore
          <div className="w-6 h-6 rounded-full bg-neo-cyan/10 flex items-center justify-center group-hover/link:bg-neo-fuchsia/20 group-hover/link:translate-x-1 transition-all">
            <ChevronRight className="w-4 h-4" />
          </div>
        </Link>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
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
      {/* Category Navigation - Floating Glass Bar */}
      <RevealOnScroll anchorId="home-categories" anchorLabel="Categories" className="mb-10 px-4">
        <nav className="max-w-7xl mx-auto bg-white/[0.045] backdrop-blur-xl border border-white/10 rounded-2xl shadow-glass overflow-x-auto scrollbar-hide animate-fade-in relative">
          <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan/8 via-transparent to-neo-emerald/8 pointer-events-none" />
          <div className="flex items-center justify-between md:justify-center gap-4 md:gap-8 py-4 px-6 min-w-max relative z-10">
            {categories.map((category) => (
              <Link
                key={category.path}
                to={category.path}
                className="flex flex-col items-center gap-3 group min-w-[90px] p-2 hover:bg-white/5 rounded-xl transition-colors duration-300"
              >
                <div className={`w-14 h-14 bg-gradient-to-br ${category.color} rounded-xl border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]`}>
                  <category.icon className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold tracking-wide text-slate-300 group-hover:text-white text-center transition-colors">
                  {category.name}
                </span>
              </Link>
            ))}
          </div>
        </nav>
      </RevealOnScroll>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
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

        {/* Deals of the Day */}
        <RevealOnScroll anchorId="home-flash-sales" anchorLabel="Flash Sales" delay={60}>
          <ProductSection
            title="Flash Sales"
            link="/deals"
            products={dealsOfTheDay}
            isLoading={loading}
          />
        </RevealOnScroll>

        {/* Trending Products */}
        <RevealOnScroll anchorId="home-trending" anchorLabel="Trending Items" delay={110}>
          <ProductSection
            title="Trending Items"
            link="/trending"
            products={trendingProducts}
            isLoading={loading}
          />
        </RevealOnScroll>

        {/* New Arrivals */}
        <RevealOnScroll anchorId="home-new-arrivals" anchorLabel="New Arrivals" delay={140}>
          <ProductSection
            title="New Arrivals"
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
                  List your pre-owned items or find amazing deals from real people in your city. It's free to list!
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
