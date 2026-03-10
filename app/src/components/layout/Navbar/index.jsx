import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  Gauge,
  Heart,
  LayoutGrid,
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
  const [isQuickPanelOpen, setIsQuickPanelOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isAdminToolsOpen, setIsAdminToolsOpen] = useState(false);
  const [showVoiceSearch, setShowVoiceSearch] = useState(false);
  const lastScrollYRef = useRef(0);
  const userMenuRef = useRef(null);
  const quickPanelRef = useRef(null);
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
    setIsQuickPanelOpen(false);
    setIsPreferencesOpen(false);
    setIsAdminToolsOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const target = event.target;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
      if (quickPanelRef.current && !quickPanelRef.current.contains(target)) {
        setIsQuickPanelOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
        setIsQuickPanelOpen(false);
        setIsPreferencesOpen(false);
        setIsAdminToolsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const hasOverlayOpen = isQuickPanelOpen || isUserMenuOpen;
    document.body.classList.toggle('aura-nav-overlay-open', hasOverlayOpen);

    return () => {
      document.body.classList.remove('aura-nav-overlay-open');
    };
  }, [isQuickPanelOpen, isUserMenuOpen]);

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
  const currentMotionMode = motionModeOptions.find((mode) => mode.value === motionMode) || motionModeOptions[0];
  const effectiveMotionLabel = motionModeOptions.find((mode) => mode.value === effectiveMotionMode)?.label || effectiveMotionMode;
  const motionOptionDescriptions = {
    cinematic: 'Full transitions and richer movement.',
    balanced: 'Default motion with lighter overhead.',
    minimal: 'Reduced motion for clarity and speed.',
  };
  const loyaltyPoints = Number(dbUser?.loyalty?.pointsBalance || 0);
  const isSeller = Boolean(dbUser?.isSeller);
  const sellerCtaTarget = isSeller ? '/sell' : '/become-seller';
  const sellerCtaLabel = isSeller ? 'Sell' : 'Become Seller';
  const navActionClasses =
    'hidden xl:inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-slate-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08] hover:text-white';
  const quickActionLinks = [
    {
      label: 'AI Compare',
      path: '/compare',
      icon: Gauge,
      tone: 'border-cyan-300/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15',
    },
    {
      label: 'Visual Search',
      path: '/visual-search',
      icon: Sparkles,
      tone: 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15',
    },
    {
      label: 'Smart Bundles',
      path: '/bundles',
      icon: Plus,
      tone: 'border-violet-300/20 bg-violet-500/10 text-violet-100 hover:bg-violet-500/15',
    },
    {
      label: 'Wishlist',
      path: '/wishlist',
      icon: Heart,
      tone: 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]',
    },
  ];
  const workspaceLinks = [
    {
      label: isSeller ? 'Seller Desk' : 'Become Seller',
      path: isSeller ? '/my-listings' : '/become-seller',
      icon: Store,
      tone: 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]',
    },
    {
      label: 'Price Alerts',
      path: '/price-alerts',
      icon: Sparkles,
      tone: 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]',
    },
    ...(dbUser?.isAdmin ? [{
      label: 'Admin Portal',
      path: '/admin/dashboard',
      icon: Shield,
      tone: 'border-amber-300/25 bg-amber-400/12 text-amber-100 hover:bg-amber-400/18',
    }] : []),
  ];
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
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neo-cyan/60 to-transparent animate-gradient-x" style={{ backgroundSize: '200% auto' }} />
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
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neo-cyan via-sky-400 to-neo-emerald p-[1px] shadow-neon-cyan animate-pulse-glow group-hover:animate-none group-hover:shadow-[0_0_16px_rgba(16,185,129,0.45)] transition-all duration-500">
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
                to="/mission-control"
                className={navActionClasses}
              >
                <Sparkles className="w-4 h-4" />
                Mission OS
              </Link>
              <Link
                to="/marketplace"
                className={navActionClasses}
              >
                <Store className="w-4 h-4" />
                Marketplace
              </Link>
              <Link
                to={sellerCtaTarget}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-neo-cyan to-neo-emerald px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition-all duration-200 hover:-translate-y-0.5 hover:from-sky-500 hover:to-emerald-500"
              >
                <Plus className="w-4 h-4" />
                {sellerCtaLabel}
              </Link>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 flex-shrink-0">
              <div className="relative hidden lg:block" ref={quickPanelRef}>
                <button
                  type="button"
                  onClick={() => setIsQuickPanelOpen((open) => !open)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-all duration-200',
                    isQuickPanelOpen
                      ? 'border-cyan-300/35 bg-cyan-400/12 text-white shadow-[0_0_18px_rgba(34,211,238,0.18)]'
                      : 'border-white/12 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-white'
                  )}
                  aria-label="Open quick access panel"
                  aria-expanded={isQuickPanelOpen}
                >
                  <LayoutGrid className="h-4 w-4 text-neo-cyan" />
                  <span className="hidden xl:inline">Explore</span>
                  <ChevronDown className={cn('h-4 w-4 opacity-60 transition-transform', isQuickPanelOpen && 'rotate-180')} />
                </button>

                {isQuickPanelOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close explore panel backdrop"
                      className="fixed inset-0 z-40 bg-zinc-950/34 backdrop-blur-[1.5px]"
                      onClick={() => setIsQuickPanelOpen(false)}
                    />
                    <div className="absolute right-0 z-[60] mt-3 w-[23rem] max-w-[calc(100vw-2rem)] rounded-[1.5rem] border border-white/10 bg-[#07131a] p-3.5 shadow-[0_26px_80px_rgba(2,8,23,0.7)] ring-1 ring-cyan-400/10">
                      <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300/80">Explore</div>
                        <div className="mt-1 text-base font-black text-white">Smart routes, not more chrome.</div>
                        <p className="mt-1 text-sm text-slate-400">
                          High-signal tools stay here so the navbar stays readable.
                        </p>
                      </div>

                      <div className="mt-3">
                        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Tools</div>
                        <div className="grid grid-cols-2 gap-2">
                          {quickActionLinks.map((item) => {
                            const ItemIcon = item.icon;
                            return (
                              <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setIsQuickPanelOpen(false)}
                                className={cn(
                                  'flex min-h-[3.35rem] items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition-colors',
                                  item.tone
                                )}
                              >
                                <ItemIcon className="h-4 w-4 shrink-0" />
                                <span className="leading-tight">{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Workspace</div>
                        <div className="space-y-2">
                          {workspaceLinks.map((item) => {
                            const ItemIcon = item.icon;
                            return (
                              <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setIsQuickPanelOpen(false)}
                                className={cn(
                                  'flex items-center justify-between rounded-2xl border px-3 py-3 text-sm font-semibold transition-colors',
                                  item.tone
                                )}
                              >
                                <span className="flex items-center gap-2">
                                  <ItemIcon className="h-4 w-4 shrink-0" />
                                  {item.label}
                                </span>
                                <ChevronDown className="-rotate-90 h-4 w-4 opacity-50" />
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* User Menu */}
              <div className="relative" ref={userMenuRef}>
                {activeUser ? (
                  <button
                    onClick={() => {
                      setIsQuickPanelOpen(false);
                      setIsUserMenuOpen((open) => {
                        const nextOpen = !open;
                        if (!nextOpen) {
                          setIsPreferencesOpen(false);
                          setIsAdminToolsOpen(false);
                        }
                        return nextOpen;
                      });
                    }}
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
                  <>
                    <button
                      type="button"
                      aria-label="Close profile menu backdrop"
                      className="fixed inset-0 z-40 bg-zinc-950/34 backdrop-blur-[1.5px]"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setIsPreferencesOpen(false);
                        setIsAdminToolsOpen(false);
                      }}
                    />
                    <div className="absolute right-0 z-[60] mt-3 w-[16.5rem] max-w-[calc(100vw-1.5rem)] max-h-[min(31rem,calc(100vh-6.5rem))] overflow-x-hidden overflow-y-auto rounded-2xl border border-white/12 bg-[#061018] py-2 shadow-[0_28px_90px_rgba(2,8,23,0.8)] ring-1 ring-white/8 backdrop-blur-2xl animate-fade-in">
                      <div className="px-4 pb-2">
                        <div className="text-sm font-bold text-white truncate">{displayName}</div>
                        <div className="text-xs text-slate-400 truncate">{activeUser.email}</div>
                        <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100">
                          <Sparkles className="h-3 w-3" />
                          {loyaltyPoints.toLocaleString('en-IN')} AP
                        </div>
                      </div>
                      <div className="my-1 border-t border-white/10" />
                      <Link
                        to="/profile"
                        className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        My Profile
                      </Link>
                      {isSeller ? (
                        <Link
                          to="/my-listings"
                          className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          My Listings
                        </Link>
                      ) : (
                        <Link
                          to="/become-seller"
                          className="block px-4 py-2.5 text-sm text-neo-cyan transition-colors hover:bg-cyan-500/10 hover:text-cyan-200"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          Become Seller
                        </Link>
                      )}
                      <Link
                        to="/wishlist"
                        className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        Wishlist
                      </Link>
                      <Link
                        to="/orders"
                        className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        Orders
                      </Link>
                      {dbUser?.isAdmin && (
                        <>
                          <div className="my-1 border-t border-white/10" />
                          <button
                            type="button"
                            onClick={() => setIsAdminToolsOpen((open) => !open)}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                          >
                            <span className="flex items-center gap-2">
                              <Shield className="h-4 w-4 text-amber-200" />
                              Admin Tools
                            </span>
                            <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', isAdminToolsOpen && 'rotate-180')} />
                          </button>
                          {isAdminToolsOpen && (
                            <div className="px-3 pb-2">
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                                <Link
                                  to="/admin/dashboard"
                                  className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                                  onClick={() => setIsUserMenuOpen(false)}
                                >
                                  Admin Dashboard
                                </Link>
                                <Link
                                  to="/admin/payments"
                                  className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                                  onClick={() => setIsUserMenuOpen(false)}
                                >
                                  Payment Ops
                                </Link>
                                <Link
                                  to="/admin/users"
                                  className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                                  onClick={() => setIsUserMenuOpen(false)}
                                >
                                  User Governance
                                </Link>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      <div className="my-1 border-t border-white/10" />
                      <button
                        type="button"
                        onClick={() => setIsPreferencesOpen((open) => !open)}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <span className="flex items-center gap-2">
                          <Palette className="h-4 w-4 text-neo-cyan" />
                          Preferences
                        </span>
                        <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', isPreferencesOpen && 'rotate-180')} />
                      </button>
                      {isPreferencesOpen && (
                        <div className="px-3 pb-3">
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Color mode</div>
                            <select
                              value={colorMode}
                              onChange={(e) => setColorMode(e.target.value)}
                              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors hover:border-white/20"
                            >
                              {colorModeOptions.map((mode) => (
                                <option key={mode.value} value={mode.value} className="bg-zinc-950 text-slate-100">
                                  {mode.label}
                                </option>
                              ))}
                            </select>
                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                              <span
                                className="h-3 w-3 rounded-full border border-white/20"
                                style={{
                                  background: `linear-gradient(135deg, ${currentColorMode?.primary || '#06b6d4'}, ${currentColorMode?.secondary || '#10b981'})`,
                                }}
                              />
                              {currentColorLabel}
                            </div>

                            <div className="mt-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Motion</div>
                            <div className="mt-2 grid grid-cols-1 gap-2">
                              {motionModeOptions.map((mode) => (
                                <button
                                  key={mode.value}
                                  type="button"
                                  onClick={() => setMotionMode(mode.value)}
                                  className={cn(
                                    'rounded-xl border px-3 py-2.5 text-left transition-colors',
                                    motionMode === mode.value
                                      ? 'border-cyan-300/60 bg-cyan-400/18 text-cyan-100'
                                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-[11px] font-black uppercase tracking-[0.16em]">{mode.label}</span>
                                    {motionMode === mode.value && (
                                      <span className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-100">
                                        Selected
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-[11px] font-medium normal-case tracking-normal text-slate-400">
                                    {motionOptionDescriptions[mode.value] || 'Motion profile'}
                                  </div>
                                </button>
                              ))}
                            </div>
                            <div className="mt-3 text-[11px] text-slate-400">
                              Selected: <span className="font-semibold text-slate-200">{currentMotionMode?.label || 'Balanced'}</span>
                              {' | '}
                              Effective: <span className="font-semibold text-slate-200">{effectiveMotionLabel}</span>
                            </div>
                            {autoDowngraded && (
                              <p className="mt-2 text-[11px] leading-5 text-amber-200">
                                Auto performance mode is overriding the selected motion profile to keep interactions stable.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="my-1 border-t border-white/10" />
                      <button
                        onClick={() => {
                          logout();
                          setIsUserMenuOpen(false);
                          setIsPreferencesOpen(false);
                          setIsAdminToolsOpen(false);
                        }}
                        className="block w-full px-4 py-2.5 text-left text-sm text-neo-rose transition-colors hover:bg-neo-rose/10"
                      >
                        Logout
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Cart */}
              <Link
                to="/cart"
                className="flex items-center gap-2 rounded-full border border-transparent p-2 text-slate-300 transition-all group hover:border-white/10 hover:bg-white/[0.05] hover:text-neo-cyan"
                aria-label="Cart"
              >
                <div className="relative">
                  <ShoppingCart className="w-5 h-5 group-hover:-translate-y-1 group-hover:text-neo-emerald transition-all duration-300" />
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
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Quick access</div>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/mission-control"
                    className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-3 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/15"
                  >
                    <Sparkles className="h-4 w-4" />
                    Mission OS
                  </Link>
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

              <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
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
                <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
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

              <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
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
                  <div className="grid grid-cols-1 gap-2">
                    {motionModeOptions.map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => setMotionMode(mode.value)}
                        className={cn(
                          'rounded-xl border px-3 py-2.5 text-left transition-colors',
                          motionMode === mode.value
                            ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-100'
                            : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-black uppercase tracking-wider">{mode.label}</span>
                          {motionMode === mode.value && (
                            <span className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-100">
                              Selected
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] font-medium normal-case tracking-normal text-slate-400">
                          {motionOptionDescriptions[mode.value] || 'Motion profile'}
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-slate-400">
                    Selected: <span className="font-semibold text-slate-200">{currentMotionMode?.label || 'Balanced'}</span>
                    {' | '}
                    Effective: <span className="font-semibold text-slate-200">{effectiveMotionLabel}</span>
                  </p>
                  {autoDowngraded && (
                    <p className="mt-2 text-[11px] leading-5 text-amber-200">
                      Auto performance mode is overriding the selected motion profile to keep interactions stable.
                    </p>
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
