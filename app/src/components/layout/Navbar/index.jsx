import { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  Film,
  Gauge,
  Heart,
  Menu,
  Minus,
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
import LoginModal from '@/components/features/auth/LoginModal';
import VoiceSearch from '@/components/shared/VoiceSearch';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [showVoiceSearch, setShowVoiceSearch] = useState(false);
  const lastScrollYRef = useRef(0);
  const { currentUser, dbUser, logout } = useContext(AuthContext);
  const { cartItems } = useContext(CartContext);
  const { colorMode, setColorMode, colorModeOptions } = useColorMode();
  const { motionMode, setMotionMode, motionModeOptions, autoDowngraded, effectiveMotionMode } = useMotionMode();

  const activeUser = currentUser;

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
              'min-w-0 flex items-center justify-between gap-1.5 sm:gap-2.5 lg:gap-3 rounded-2xl border px-2 sm:px-3 lg:px-3.5',
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
              className="hidden lg:flex flex-1 min-w-[18rem] xl:min-w-[22rem] max-w-[44rem] 2xl:max-w-[50rem]"
              placeholder="Search the latest collections..."
              onVoiceSearch={() => setShowVoiceSearch(true)}
            />

            {/* Marketplace + Sell - Desktop */}
            <div className="hidden 2xl:flex items-center gap-2">
              <Link
                to="/marketplace"
                className="flex items-center gap-1.5 px-2.5 py-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/8 border border-white/10 hover:border-white/20 transition-all text-sm font-semibold"
              >
                <Store className="w-4 h-4" />
                Marketplace
              </Link>
              <Link
                to={isSeller ? '/sell' : '/become-seller'}
                className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-neo-cyan to-neo-emerald text-white font-bold rounded-xl text-sm shadow-lg shadow-emerald-500/25 hover:from-sky-500 hover:to-emerald-500 hover:-translate-y-0.5 transition-all duration-200"
              >
                <Plus className="w-4 h-4" />
                SELL
              </Link>
              {dbUser?.isAdmin && (
                <Link
                  to="/admin/dashboard"
                  className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-amber-500/90 to-orange-500/90 text-white font-black rounded-xl text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-orange-400 hover:-translate-y-0.5 transition-all duration-200"
                  title="Open Admin Portal"
                >
                  <Shield className="w-4 h-4" />
                  ADMIN
                </Link>
              )}
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 flex-shrink-0">
              {activeUser && (
                <Link
                  to="/profile"
                  className="hidden 2xl:inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-400/15 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-amber-100 transition hover:bg-amber-400/25"
                  title="Aura Points"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                  {loyaltyPoints.toLocaleString('en-IN')} AP
                </Link>
              )}

              {dbUser?.isAdmin && (
                <Link
                  to="/admin/dashboard"
                  className="hidden lg:inline-flex items-center gap-1.5 rounded-xl border border-amber-300/45 bg-amber-400/15 px-2.5 py-2 text-xs font-black uppercase tracking-wide text-amber-100 transition hover:bg-amber-300/25"
                  title="Open Admin Portal"
                >
                  <Shield className="w-4 h-4" />
                  Admin
                </Link>
              )}

              {/* User Menu */}
              <div className="relative">
                {activeUser ? (
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-2 px-2 sm:px-2.5 py-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/8 transition-all border border-white/10 hover:border-white/20 max-w-[7.5rem] 2xl:max-w-[10rem]"
                  >
                    <User className="w-5 h-5 text-neo-cyan" />
                    <span className="hidden 2xl:inline text-sm font-semibold tracking-wide truncate">
                      {activeUser.displayName || activeUser.email?.split('@')[0] || 'User'}
                    </span>
                    <ChevronDown className="w-4 h-4 hidden 2xl:block opacity-50" />
                  </button>
                ) : (
                  <button
                    onClick={() => setIsLoginModalOpen(true)}
                    className="flex items-center gap-2 px-3 sm:px-4 lg:px-5 py-2 bg-white/5 backdrop-blur-md text-white text-sm font-semibold rounded-xl border border-white/10 shadow-glass hover:bg-white/10 hover:border-neo-cyan hover:shadow-neon-cyan transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
                  >
                    Login
                  </button>
                )}

                {/* User Dropdown */}
                {isUserMenuOpen && activeUser && (
                  <div className="absolute right-0 mt-3 w-44 sm:w-48 bg-zinc-900/90 backdrop-blur-xl rounded-xl border border-white/10 shadow-glass py-2 animate-fade-in z-50">
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
                className="hidden xl:flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-1.5 py-1.5 text-slate-300 backdrop-blur-md transition-all hover:border-white/25 hover:text-white"
                aria-label={`Color mode selector. Current mode ${currentColorLabel}`}
                title={`Color mode: ${currentColorLabel}`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border border-white/30 shadow-[0_0_14px_rgba(255,255,255,0.25)]"
                  style={{
                    background: `linear-gradient(135deg, ${currentColorMode?.primary || '#06b6d4'}, ${currentColorMode?.secondary || '#10b981'})`,
                  }}
                />
                <Palette className="w-3.5 h-3.5 text-neo-cyan" />
                <select
                  value={colorMode}
                  onChange={(e) => setColorMode(e.target.value)}
                  className="bg-transparent text-[10px] font-semibold uppercase tracking-wide outline-none w-[5.8rem] 2xl:w-[7.2rem] truncate"
                >
                  {colorModeOptions.map((mode) => (
                    <option key={mode.value} value={mode.value} className="bg-zinc-900 text-slate-100 normal-case">
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Motion selector */}
              <div
                className="hidden xl:flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-1.5 py-1.5 text-slate-300 backdrop-blur-md transition-all hover:border-white/25 hover:text-white"
                aria-label={`Motion mode selector. Current mode ${motionMode}`}
                title={autoDowngraded ? `Auto optimized: ${effectiveMotionMode}` : `Motion mode: ${motionMode}`}
              >
                {motionMode === 'cinematic' ? (
                  <Film className="w-3.5 h-3.5 text-violet-300" />
                ) : motionMode === 'minimal' ? (
                  <Minus className="w-3.5 h-3.5 text-amber-300" />
                ) : (
                  <Gauge className="w-3.5 h-3.5 text-cyan-300" />
                )}
                <select
                  value={motionMode}
                  onChange={(e) => setMotionMode(e.target.value)}
                  className="bg-transparent text-[10px] font-semibold uppercase tracking-wide outline-none w-[5.8rem] 2xl:w-[7.2rem] truncate"
                >
                  {motionModeOptions.map((mode) => (
                    <option key={mode.value} value={mode.value} className="bg-zinc-900 text-slate-100 normal-case">
                      {mode.label}
                    </option>
                  ))}
                </select>
                {autoDowngraded && (
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.85)]" />
                )}
              </div>

              {/* Wishlist */}
              <Link
                to="/wishlist"
                className="flex items-center gap-2 p-2 text-slate-300 hover:text-neo-emerald rounded-lg hover:bg-neo-emerald/10 transition-all"
                aria-label="Wishlist"
              >
                <Heart className="w-5 h-5" />
              </Link>

              {/* Cart */}
              <Link
                to="/cart"
                className="flex items-center gap-2 p-2 text-slate-300 hover:text-neo-cyan rounded-lg hover:bg-neo-cyan/10 transition-all group"
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

        {/* Mobile Nav Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-zinc-950/95 backdrop-blur-xl border-t border-white/10 animate-fade-in absolute w-full left-0 top-full">
            <nav className="py-2 px-4 max-h-[70vh] overflow-y-auto">
              {categories.map((category) => (
                <Link
                  key={category.path}
                  to={category.path}
                  className="block px-4 py-3 text-slate-300 hover:text-white hover:bg-white/5 border-b border-white/5 rounded-lg transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {category.name}
                </Link>
              ))}
              {/* Marketplace links in mobile */}
              <div className="border-t border-white/10 my-2" />
              <Link
                to="/marketplace"
                className="flex items-center gap-3 px-4 py-3 text-neo-cyan font-bold hover:bg-white/5 rounded-lg transition-colors"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Store className="w-5 h-5" /> Marketplace
              </Link>
              <Link
                to={isSeller ? '/sell' : '/become-seller'}
                className="flex items-center gap-3 px-4 py-3 text-green-400 font-bold hover:bg-white/5 rounded-lg transition-colors"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Plus className="w-5 h-5" /> {isSeller ? 'Sell Your Item' : 'Become Seller'}
              </Link>
              {activeUser && isSeller && (
                <Link
                  to="/my-listings"
                  className="flex items-center gap-3 px-4 py-3 text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  My Listings
                </Link>
              )}
              {dbUser?.isAdmin && (
                <>
                  <Link
                    to="/admin/dashboard"
                    className="flex items-center gap-3 px-4 py-3 text-violet-200 font-black hover:bg-violet-500/10 rounded-lg transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <Shield className="w-5 h-5" /> Admin Portal
                  </Link>
                  <Link
                    to="/admin/products"
                    className="flex items-center gap-3 px-4 py-3 text-violet-300 font-bold hover:bg-violet-500/10 rounded-lg transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Product Control
                  </Link>
                  <Link
                    to="/admin/users"
                    className="flex items-center gap-3 px-4 py-3 text-violet-300 font-bold hover:bg-violet-500/10 rounded-lg transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    User Governance
                  </Link>
                </>
              )}
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Palette className="w-4 h-4 text-neo-cyan" />
                  Color Mode
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {colorModeOptions.map((mode) => (
                    <button
                      key={mode.value}
                      onClick={() => {
                        setColorMode(mode.value);
                        setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs font-bold transition-colors inline-flex items-center gap-2',
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
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Gauge className="w-4 h-4 text-cyan-300" />
                  Motion Mode
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {motionModeOptions.map((mode) => (
                    <button
                      key={mode.value}
                      onClick={() => setMotionMode(mode.value)}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-[11px] font-black uppercase tracking-wider transition-colors',
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
              {!activeUser && (
                <button
                  onClick={() => {
                    setIsLoginModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="block w-full text-left px-4 py-4 text-neo-cyan font-bold hover:bg-white/5 rounded-lg mt-2 transition-colors"
                >
                  Login / Sign Up
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Spacer to prevent content from hiding behind fixed navbar */}
      <div className="aura-nav-spacer" />

      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />

      {showVoiceSearch && <VoiceSearch onClose={() => setShowVoiceSearch(false)} />}
    </>
  );
};

export default Navbar;
