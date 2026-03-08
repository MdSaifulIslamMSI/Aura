import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  Gauge,
  Heart,
  Menu,
  Palette,
  Plus,
  Shield,
  ShoppingCart,
  Sparkles,
  Store,
  User,
  X,
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { useColorMode } from '@/context/ColorModeContext';
import { useMotionMode } from '@/context/MotionModeContext';
import { cn } from '@/lib/utils';
import AppErrorBoundary from '@/components/shared/AppErrorBoundary';
import VoiceSearch from '@/components/shared/VoiceSearch';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [showVoiceSearch, setShowVoiceSearch] = useState(false);
  const lastScrollYRef = useRef(0);
  const location = useLocation();
  const { currentUser, dbUser, logout } = useContext(AuthContext);
  const { cartItems } = useContext(CartContext);
  const { colorMode, setColorMode, colorModeOptions } = useColorMode();
  const { motionMode, setMotionMode, motionModeOptions, autoDowngraded, effectiveMotionMode } = useMotionMode();
  const goToLoginPage = () => {
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  };

  const activeUser = currentUser;
  const displayName = activeUser?.displayName || dbUser?.name || activeUser?.email?.split('@')[0] || 'Profile';

  useEffect(() => {
    const handleScroll = () => {
      const currentY = Math.max(0, window.scrollY || 0);
      const delta = currentY - lastScrollYRef.current;
      setIsScrolled(currentY > 20);

      if (currentY < 32) {
        setIsCompact(false);
      } else if (delta > 7 && currentY > 120) {
        setIsCompact(true);
      } else if (delta < -5) {
        setIsCompact(false);
      }

      lastScrollYRef.current = currentY;
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsUserMenuOpen(false);
  }, [location.pathname, location.search]);

  const categories = [
    { name: 'Mobiles', path: '/category/mobiles' },
    { name: 'Laptops', path: '/category/laptops' },
    { name: 'Electronics', path: '/category/electronics' },
    { name: "Men's Fashion", path: "/category/men's-fashion" },
    { name: "Women's Fashion", path: "/category/women's-fashion" },
    { name: 'Footwear', path: '/category/footwear' },
    { name: 'Home & Kitchen', path: '/category/home-kitchen' },
    { name: 'Books', path: '/category/books' },
    { name: 'Gaming', path: '/category/gaming' },
  ];

  const cartItemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const currentColorMode = colorModeOptions.find((mode) => mode.value === colorMode) || colorModeOptions[0];
  const currentColorLabel = currentColorMode?.label || 'Neo Cyan';
  const loyaltyPoints = Number(dbUser?.loyalty?.pointsBalance || 0);
  const isSeller = Boolean(dbUser?.isSeller);
  const navActionClasses =
    'hidden xl:inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-slate-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08] hover:text-white';
  const voiceSearchFallback = (
    <div className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-sm rounded-2xl border border-amber-400/25 bg-zinc-950/95 p-4 shadow-glass">
      <div className="text-sm font-black uppercase tracking-[0.18em] text-amber-200">Voice search unavailable</div>
      <p className="mt-2 text-sm text-slate-300">
        The voice assistant failed in this tab. Use typed search now and reopen voice search after a refresh.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setShowVoiceSearch(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="inline-flex items-center rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-300/16"
        >
          Use typed search
        </button>
        <button
          type="button"
          onClick={() => setShowVoiceSearch(false)}
          className="inline-flex items-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          Close
        </button>
      </div>
    </div>
  );

  return (
    <>
      <header
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-all duration-300 overflow-x-clip aura-nav-shell',
          isCompact && 'aura-nav-compact',
          isScrolled
            ? 'aura-nav-scrolled bg-zinc-950/70 backdrop-blur-2xl border-transparent'
            : 'bg-gradient-to-b from-zinc-950/72 to-zinc-950/46 backdrop-blur-xl border-transparent'
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neo-cyan/60 to-transparent" />
        <div className="container-custom max-w-[90rem] mx-auto px-3 sm:px-5 lg:px-6">
          <div
            className={cn(
              'min-w-0 flex items-center justify-between gap-2 sm:gap-3 lg:gap-4 rounded-[1.65rem] border px-2.5 sm:px-3.5 lg:px-4 py-2',
              'bg-zinc-950/60 backdrop-blur-2xl shadow-[0_14px_40px_rgba(2,8,23,0.42)]',
              isScrolled ? 'border-white/15' : 'border-white/10'
            )}
          >
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 flex-shrink-0 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neo-cyan via-sky-400 to-neo-emerald p-[1px] shadow-neon-cyan group-hover:shadow-[0_0_16px_rgba(16,185,129,0.45)] transition-all duration-500">
                <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center relative overflow-hidden">
                  <Sparkles className="w-5 h-5 text-neo-cyan group-hover:text-neo-emerald transition-colors duration-500 relative z-10" />
                  <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-white text-lg sm:text-xl lg:text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400 group-hover:from-neo-cyan group-hover:to-neo-emerald transition-all duration-500">
                  AURA
                </span>
                <span className="hidden sm:inline text-slate-500 text-[10px] font-bold tracking-[0.2em] uppercase -mt-1 group-hover:text-neo-cyan transition-colors">
                  Network
                </span>
              </div>
            </Link>

            {/* Search Bar - Desktop */}
            <GlobalSearchBar
              className="hidden lg:flex flex-[1.2] min-w-[18rem] xl:min-w-[24rem] max-w-[32rem] xl:max-w-[40rem] 2xl:max-w-[46rem]"
              placeholder="Search products, brands, and live deals"
              onVoiceSearch={() => setShowVoiceSearch(true)}
            />

            {/* Primary commerce actions */}
            <div className="hidden xl:flex items-center gap-2 flex-shrink-0">
              <Link
                to="/marketplace"
                className={navActionClasses}
              >
                <Store className="w-4 h-4" />
                Marketplace
              </Link>
              <Link
                to={isSeller ? '/sell' : '/become-seller'}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-neo-cyan to-neo-emerald px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition-all duration-200 hover:-translate-y-0.5 hover:from-sky-500 hover:to-emerald-500"
              >
                <Plus className="w-4 h-4" />
                {isSeller ? 'Sell' : 'Become Seller'}
              </Link>
              {activeUser && (
                <div className="hidden 2xl:inline-flex items-center gap-2 rounded-full border border-amber-300/35 bg-amber-400/12 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-amber-100">
                  <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                  {loyaltyPoints.toLocaleString('en-IN')} AP
                </div>
              )}
              {dbUser?.isAdmin && (
                <Link
                  to="/admin/dashboard"
                  className="inline-flex items-center gap-2 rounded-full border border-amber-300/35 bg-amber-400/12 px-3.5 py-2 text-sm font-black text-amber-100 transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-300/18"
                  title="Open Admin Portal"
                >
                  <Shield className="w-4 h-4" />
                  ADMIN
                </Link>
              )}
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 flex-shrink-0">
              {/* User Menu */}
              <div className="relative">
                {activeUser ? (
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-2 text-slate-200 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white max-w-[8rem] xl:max-w-[10rem]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-neo-cyan/25 to-neo-emerald/25 border border-white/10">
                      <User className="w-4 h-4 text-neo-cyan" />
                    </span>
                    <span className="hidden xl:inline text-sm font-semibold tracking-wide truncate">
                      {displayName}
                    </span>
                    <ChevronDown className="w-4 h-4 hidden xl:block opacity-50" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goToLoginPage}
                    className="flex items-center gap-2 px-3 sm:px-4 lg:px-5 py-2 bg-white/5 backdrop-blur-md text-white text-sm font-semibold rounded-xl border border-white/10 shadow-glass hover:bg-white/10 hover:border-neo-cyan hover:shadow-neon-cyan transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
                  >
                    Login
                  </button>
                )}

                {/* User Dropdown */}
                {isUserMenuOpen && activeUser && (
                  <div className="absolute right-0 mt-3 w-52 bg-zinc-900/92 backdrop-blur-2xl rounded-2xl border border-white/12 shadow-glass py-2 animate-fade-in z-50">
                    <div className="px-4 pb-2">
                      <div className="text-sm font-bold text-white truncate">{displayName}</div>
                      <div className="text-xs text-slate-400 truncate">{activeUser.email}</div>
                    </div>
                    <div className="border-t border-white/10 my-1" />
                    <Link
                      to="/profile"
                      className="block px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      My Profile
                    </Link>
                    {isSeller ? (
                      <Link
                        to="/my-listings"
                        className="block px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        My Listings
                      </Link>
                    ) : (
                      <Link
                        to="/become-seller"
                        className="block px-4 py-2.5 text-sm text-neo-cyan hover:text-cyan-200 hover:bg-cyan-500/10 transition-colors"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        Become Seller
                      </Link>
                    )}
                    <Link
                      to="/orders"
                      className="block px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      Orders
                    </Link>
                    {dbUser?.isAdmin && (
                      <>
                        <Link
                          to="/admin/dashboard"
                          className="block px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          Admin Dashboard
                        </Link>
                        <Link
                          to="/admin/payments"
                          className="block px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          Payment Ops
                        </Link>
                        <Link
                          to="/admin/users"
                          className="block px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          User Governance
                        </Link>
                      </>
                    )}
                    <div className="border-t border-white/10 my-1" />
                    <button
                      onClick={() => {
                        logout();
                        setIsUserMenuOpen(false);
                      }}
                      className="block w-full text-left px-4 py-2.5 text-sm text-neo-rose hover:bg-neo-rose/10 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>

              {/* Color selector */}
              <div
                className="hidden lg:flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-2 py-2 text-slate-300 backdrop-blur-md transition-all hover:border-white/20 hover:text-white"
                aria-label={`Color mode selector. Current mode ${currentColorLabel}`}
                title={`Color mode: ${currentColorLabel}`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border border-white/30 shadow-[0_0_14px_rgba(255,255,255,0.25)]"
                  style={{
                    background: `linear-gradient(135deg, ${currentColorMode?.primary || '#06b6d4'}, ${currentColorMode?.secondary || '#10b981'})`,
                  }}
                />
                <Palette className="w-3.5 h-3.5 text-neo-cyan hidden 2xl:block" />
                <select
                  value={colorMode}
                  onChange={(e) => setColorMode(e.target.value)}
                  className="bg-transparent text-[10px] font-semibold uppercase tracking-[0.18em] outline-none w-[5.9rem] 2xl:w-[7.4rem] truncate"
                >
                  {colorModeOptions.map((mode) => (
                    <option key={mode.value} value={mode.value} className="bg-zinc-900 text-slate-100 normal-case">
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Wishlist */}
              <Link
                to="/wishlist"
                className="flex items-center gap-2 rounded-full border border-transparent p-2 text-slate-300 transition-all hover:border-white/10 hover:bg-white/[0.05] hover:text-neo-emerald"
                aria-label="Wishlist"
              >
                <Heart className="w-5 h-5" />
              </Link>

              {/* Cart */}
              <Link
                to="/cart"
                className="flex items-center gap-2 rounded-full border border-transparent p-2 text-slate-300 transition-all group hover:border-white/10 hover:bg-white/[0.05] hover:text-neo-cyan"
                aria-label="Cart"
              >
                <div className="relative">
                  <ShoppingCart className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
                  {cartItemCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-gradient-to-r from-neo-cyan to-neo-emerald text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]">
                      {cartItemCount > 9 ? '9+' : cartItemCount}
                    </span>
                  )}
                </div>
              </Link>

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden p-2 text-slate-300 hover:text-white focus:outline-none"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Mobile Search - Slide down animation */}
          <div
            className={cn(
              'md:hidden overflow-hidden transition-all duration-300 ease-in-out',
              isMobileMenuOpen ? 'max-h-[30rem] mt-4 pb-2' : 'max-h-0'
            )}
          >
            <GlobalSearchBar
              mobile
              placeholder="Search products, categories, and actions..."
              onVoiceSearch={() => setShowVoiceSearch(true)}
              onNavigate={() => setIsMobileMenuOpen(false)}
              enableGlobalShortcuts={false}
            />
          </div>
        </div>

        {isMobileMenuOpen && (
          <button
            type="button"
            aria-label="Close mobile menu backdrop"
            className="fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Mobile Nav Menu */}
        {isMobileMenuOpen && (
          <div className="absolute left-0 top-full z-50 w-full border-t border-white/10 bg-zinc-950/95 backdrop-blur-xl animate-fade-in md:hidden">
            <nav className="max-h-[calc(100vh-5.5rem)] overflow-y-auto px-4 py-4">
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Quick access</div>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/marketplace"
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
                  >
                    <Store className="h-4 w-4 text-neo-cyan" />
                    Marketplace
                  </Link>
                  <Link
                    to={isSeller ? '/sell' : '/become-seller'}
                    className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/15"
                  >
                    <Plus className="h-4 w-4" />
                    {isSeller ? 'Sell' : 'Become seller'}
                  </Link>
                  <Link
                    to="/wishlist"
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
                  >
                    <Heart className="h-4 w-4 text-neo-emerald" />
                    Wishlist
                  </Link>
                  <Link
                    to="/cart"
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
                  >
                    <ShoppingCart className="h-4 w-4 text-neo-cyan" />
                    Cart {cartItemCount > 0 ? `(${cartItemCount > 9 ? '9+' : cartItemCount})` : ''}
                  </Link>
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Browse by category</div>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map((category) => (
                    <Link
                      key={category.path}
                      to={category.path}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      {category.name}
                    </Link>
                  ))}
                </div>
              </section>

              {(activeUser || dbUser?.isAdmin) && (
                <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Account control</div>
                  <div className="space-y-2">
                    {activeUser && (
                      <>
                        <Link to="/profile" className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          My profile
                        </Link>
                        <Link to="/orders" className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          Orders
                        </Link>
                        {isSeller && (
                          <Link to="/my-listings" className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                            My listings
                          </Link>
                        )}
                      </>
                    )}
                    {dbUser?.isAdmin && (
                      <>
                        <Link to="/admin/dashboard" className="flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-3 text-sm font-semibold text-violet-100 transition-colors hover:bg-violet-500/15">
                          <Shield className="h-4 w-4" />
                          Admin portal
                        </Link>
                        <Link to="/admin/products" className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          Product control
                        </Link>
                        <Link to="/admin/users" className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          User governance
                        </Link>
                      </>
                    )}
                  </div>
                </section>
              )}

              <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Experience</div>
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <Palette className="h-4 w-4 text-neo-cyan" />
                    Color mode
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {colorModeOptions.map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => {
                          setColorMode(mode.value);
                          setIsMobileMenuOpen(false);
                        }}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors',
                          colorMode === mode.value
                            ? 'border-neo-cyan bg-neo-cyan/20 text-neo-cyan'
                            : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                        )}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-white/30"
                          style={{
                            background: `linear-gradient(135deg, ${mode.primary || '#06b6d4'}, ${mode.secondary || '#10b981'})`,
                          }}
                        />
                        <span className="truncate">{mode.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <Gauge className="h-4 w-4 text-cyan-300" />
                    Motion mode
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {motionModeOptions.map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => setMotionMode(mode.value)}
                        className={cn(
                          'rounded-xl border px-2 py-2 text-[11px] font-black uppercase tracking-wider transition-colors',
                          motionMode === mode.value
                            ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-100'
                            : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                        )}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  {autoDowngraded && (
                    <p className="mt-2 text-[11px] text-amber-200">Auto performance mode active ({effectiveMotionMode}).</p>
                  )}
                </div>
              </section>

              {!activeUser && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    goToLoginPage();
                  }}
                  className="mt-4 block w-full rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-4 text-left font-bold text-neo-cyan transition-colors hover:bg-cyan-500/15"
                >
                  Login / Sign up
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Spacer to prevent content from hiding behind fixed navbar */}
      <div className="aura-nav-spacer" />

      <AppErrorBoundary
        key={`voice-search-${showVoiceSearch ? 'open' : 'closed'}`}
        fallback={voiceSearchFallback}
      >
        {showVoiceSearch && <VoiceSearch onClose={() => setShowVoiceSearch(false)} />}
      </AppErrorBoundary>
    </>
  );
};

export default Navbar;
