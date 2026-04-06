import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  Gauge,
  Globe2,
  Heart,
  LayoutGrid,
  Menu,
  Palette,
  Plus,
  Search,
  Shield,
  ShoppingCart,
  Sparkles,
  Store,
  User,
  X,
} from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { useColorMode } from '@/context/ColorModeContext';
import { useMarket } from '@/context/MarketContext';
import { createTranslator } from '@/config/marketConfig';
import { useMotionMode } from '@/context/MotionModeContext';
import { cn } from '@/lib/utils';
import AppErrorBoundary from '@/components/shared/AppErrorBoundary';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { useDismissableLayer } from '@/hooks/useDismissableLayer';
import { getLocalizedCategoryLabel } from '@/config/catalogTaxonomy';
import NotificationDropdown from './NotificationDropdown';

const NavbarSearchFallback = ({
  mobile = false,
  className,
  label = 'Search products, brands, and live deals',
  openLabel = 'Open search',
  onNavigate,
}) => (
  <Link
    to="/search"
    onClick={onNavigate}
    aria-label={openLabel}
    className={cn(
      mobile
        ? 'flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-white/18 hover:bg-white/[0.08] hover:text-white'
        : 'hidden lg:flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.045] px-4 py-3 text-sm font-semibold text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-white/18 hover:bg-white/[0.08] hover:text-white',
      className
    )}
  >
    <Search className="h-4 w-4 shrink-0 text-neo-cyan" />
    <span className="truncate">{label}</span>
  </Link>
);

const NavbarNotificationsFallback = ({
  label = 'Notifications temporarily unavailable',
  title = 'Notifications are temporarily unavailable',
}) => (
  <button
    type="button"
    aria-label={label}
    title={title}
    className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-slate-200 opacity-80"
  >
    <Bell className="h-[1.125rem] w-[1.125rem]" />
  </button>
);

const MarketPreferenceCard = ({
  t,
  countryCode,
  language,
  currency,
  regionLabel,
  countryOptions,
  currencyOptions,
  languageOptions,
  setCountryCode,
  setLanguage,
  setCurrency,
  resetToDetected,
  detectedCountryLabel,
  detectedRegionLabel,
  browseCurrencyNote,
  isEstimatedPricing,
  compact = false,
}) => {
  const currentLanguage = languageOptions.find((option) => option.value === language) || languageOptions[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300/80">
            <Globe2 className="h-3.5 w-3.5" />
            {t('market.title', {}, 'Market Studio')}
          </div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
            {t('market.subtitle', {}, 'Tune country, language, and browse currency without losing your place.')}
          </p>
        </div>
        <button
          type="button"
          onClick={resetToDetected}
          className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-200 transition-colors hover:bg-white/[0.09] hover:text-white"
        >
          {t('market.reset', {}, 'Reset to detected market')}
        </button>
      </div>

      <div className={cn('mt-3 grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-3')}>
        <label className="text-xs font-semibold text-slate-300">
          {t('market.country', {}, 'Country')}
          <PremiumSelect
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors hover:border-white/20"
          >
            {countryOptions.map((option) => (
              <option key={option.value} value={option.value} className="bg-zinc-950 text-slate-100">
                {option.label}
              </option>
            ))}
          </PremiumSelect>
        </label>

        <label className="text-xs font-semibold text-slate-300">
          {t('market.language', {}, 'Language')}
          <PremiumSelect
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors hover:border-white/20"
          >
            {languageOptions.map((option) => (
              <option key={option.value} value={option.value} className="bg-zinc-950 text-slate-100">
                {option.nativeLabel}
              </option>
            ))}
          </PremiumSelect>
        </label>

        <label className="text-xs font-semibold text-slate-300">
          {t('market.currency', {}, 'Currency')}
          <PremiumSelect
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors hover:border-white/20"
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value} className="bg-zinc-950 text-slate-100">
                {option.label}
              </option>
            ))}
          </PremiumSelect>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-300">
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
          {t('market.detected', {}, 'Detected')}: {detectedCountryLabel}
        </span>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
          {t('market.region', {}, 'Region')}: {regionLabel || detectedRegionLabel}
        </span>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
          {t('market.localPrices', {}, 'Local prices')}: {browseCurrencyNote}
        </span>
        {currentLanguage ? (
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
            {currentLanguage.nativeLabel}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        {t('market.priceHint', {}, 'Catalog prices convert from INR for browsing. Final payment quotes lock at checkout.')}
      </p>
      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        {t('market.voiceHint', {}, 'Voice commands, dates, and UI copy follow the selected language and locale where translated.')}
        {isEstimatedPricing ? '' : ` ${t('market.exact', {}, 'Native catalog FX')}.`}
      </p>
    </div>
  );
};

const MarketSnapshotCard = ({
  t,
  countryLabel,
  currency,
  languageLabel,
  regionLabel,
  browseCurrencyNote,
  onOpenStudio,
}) => (
  <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] px-4 py-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300/80">
          {t('market.title', {}, 'Market Studio')}
        </div>
        <div className="mt-1 text-sm font-bold text-white">
          {t('nav.marketSnapshotTitle', {}, 'Browse tuned to your market.')}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenStudio}
        className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-200 transition-colors hover:bg-white/[0.09] hover:text-white"
      >
        {t('nav.tuneMarket', {}, 'Tune market')}
      </button>
    </div>

    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-300">
      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">{countryLabel}</span>
      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">{languageLabel}</span>
      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">{currency}</span>
    </div>

    <p className="mt-3 text-[11px] leading-5 text-slate-400">
      {t(
        'nav.marketSnapshotBody',
        { region: regionLabel || t('market.regionFallback', {}, 'your region'), browseCurrencyNote },
        `Region: ${regionLabel || t('market.regionFallback', {}, 'your region')}. ${browseCurrencyNote}`
      )}
    </p>
  </div>
);

export const NavbarFailureFallback = () => {
  const t = createTranslator('en');

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 overflow-x-clip aura-nav-shell bg-[linear-gradient(180deg,rgba(2,6,23,0.92),rgba(2,6,23,0.58))]">
      <div className="container-custom max-w-[90rem] mx-auto px-3 sm:px-5 lg:px-6">
        <div className="relative min-w-0 rounded-[1.85rem] border border-white/12 bg-[linear-gradient(180deg,rgba(7,12,24,0.96),rgba(5,10,20,0.88))] px-2.5 py-2.5 shadow-[0_20px_58px_rgba(2,8,23,0.38)] sm:px-3.5 lg:px-4">
          <div className="pointer-events-none absolute inset-[1px] rounded-[calc(1.85rem-1px)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01)_30%,transparent)]" />
          <div className="relative min-w-0 flex items-center justify-between gap-3">
            <Link to="/" className="flex items-center gap-2 flex-shrink-0 group">
              <div className="w-11 h-11 rounded-[1rem] bg-gradient-to-br from-neo-cyan via-sky-400 to-neo-emerald p-[1px] shadow-[0_14px_28px_rgba(6,182,212,0.22)]">
                <div className="w-full h-full bg-zinc-950 rounded-[15px] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-neo-cyan" />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-white text-lg sm:text-xl lg:text-2xl font-black tracking-[-0.06em] bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">
                  AURA
                </span>
                <span className="hidden sm:inline text-slate-500 text-[10px] font-bold tracking-[0.24em] uppercase -mt-1">
                  {t('nav.network', {}, 'Network')}
                </span>
              </div>
            </Link>

            <NavbarSearchFallback
              className="flex-[1.1] min-w-[18rem] xl:min-w-[24rem] max-w-[34rem] xl:max-w-[40rem]"
              openLabel={t('nav.searchFallbackOpen', {}, 'Open search')}
              label={t('nav.searchDesktop', {}, 'Search products, brands, and live deals')}
            />

            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                to="/marketplace"
                className="hidden xl:inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-white/18 hover:bg-white/[0.075] hover:text-white"
              >
                <Store className="w-4 h-4" />
                {t('nav.marketplace', {}, 'Marketplace')}
              </Link>
              <Link
                to="/login"
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(2,8,23,0.18),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300 hover:-translate-y-0.5 hover:border-neo-cyan hover:bg-white/[0.08] active:translate-y-0 sm:px-4 lg:px-5"
              >
                {t('nav.login', {}, 'Login')}
              </Link>
              <Link
                to="/cart"
                className="group flex items-center gap-2 rounded-full border border-transparent p-2 text-slate-300 transition-all hover:border-white/10 hover:bg-white/[0.05] hover:text-neo-cyan"
                aria-label={t('nav.cart', {}, 'Cart')}
              >
                <ShoppingCart className="w-5 h-5 transition-all duration-300" />
              </Link>
            </div>
          </div>
        </div>
      </div>
      </header>
      <div className="aura-nav-spacer" />
    </>
  );
};

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isQuickPanelOpen, setIsQuickPanelOpen] = useState(false);
  const [isMarketPanelOpen, setIsMarketPanelOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isAdminToolsOpen, setIsAdminToolsOpen] = useState(false);
  const lastScrollYRef = useRef(0);
  const userMenuRef = useRef(null);
  const quickPanelRef = useRef(null);
  const marketPanelRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, dbUser, logout } = useContext(AuthContext);
  const { cartItems } = useContext(CartContext);
  const { colorMode, setColorMode, colorModeOptions } = useColorMode();
  const { motionMode, setMotionMode, motionModeOptions, autoDowngraded, effectiveMotionMode } = useMotionMode();
  const {
    countryCode,
    currency,
    language,
    regionLabel,
    countryLabel,
    countryOptions,
    currencyOptions,
    languageOptions,
    setCountryCode,
    setCurrency,
    setLanguage,
    resetToDetected,
    detectedCountryLabel,
    detectedRegionLabel,
    browseCurrencyNote,
    formatNumber,
    t,
  } = useMarket();
  const currentLanguage = languageOptions.find((option) => option.value === language) || languageOptions[0];
  const goToLoginPage = () => {
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  };

  const activeUser = currentUser;
  const displayName = activeUser?.displayName || dbUser?.name || activeUser?.email?.split('@')[0] || t('nav.profile', {}, 'Profile');

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
    if (typeof window === 'undefined') return undefined;

    const syncViewport = () => {
      setIsCompactViewport(window.innerWidth < 768);
    };

    syncViewport();
    window.addEventListener('resize', syncViewport, { passive: true });
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsUserMenuOpen(false);
    setIsNotificationsOpen(false);
    setIsQuickPanelOpen(false);
    setIsMarketPanelOpen(false);
    setIsPreferencesOpen(false);
    setIsAdminToolsOpen(false);
  }, [location.pathname, location.search]);

  const handleNavigationShellDismiss = useCallback(() => {
    setIsUserMenuOpen(false);
    setIsQuickPanelOpen(false);
    setIsMarketPanelOpen(false);
    setIsPreferencesOpen(false);
    setIsAdminToolsOpen(false);
  }, []);

  const handleNavigationShellEscape = useCallback(() => {
    setIsMobileMenuOpen(false);
    setIsUserMenuOpen(false);
    setIsNotificationsOpen(false);
    setIsQuickPanelOpen(false);
    setIsMarketPanelOpen(false);
    setIsPreferencesOpen(false);
    setIsAdminToolsOpen(false);
  }, []);

  useDismissableLayer({
    refs: [userMenuRef, quickPanelRef, marketPanelRef],
    onDismiss: handleNavigationShellDismiss,
    onEscape: handleNavigationShellEscape,
    ignoreSelectors: ['.premium-select-menu'],
  });

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const hasOverlayOpen = isQuickPanelOpen || isMarketPanelOpen || isUserMenuOpen || isNotificationsOpen;
    document.body.classList.toggle('aura-nav-overlay-open', hasOverlayOpen);

    return () => {
      document.body.classList.remove('aura-nav-overlay-open');
    };
  }, [isMarketPanelOpen, isNotificationsOpen, isQuickPanelOpen, isUserMenuOpen]);

  const categories = useMemo(
    () => [
      { slug: 'mobiles', path: '/category/mobiles' },
      { slug: 'laptops', path: '/category/laptops' },
      { slug: 'electronics', path: '/category/electronics' },
      { slug: "men's-fashion", path: "/category/men's-fashion" },
      { slug: "women's-fashion", path: "/category/women's-fashion" },
      { slug: 'footwear', path: '/category/footwear' },
      { slug: 'home-kitchen', path: '/category/home-kitchen' },
      { slug: 'books', path: '/category/books' },
      { slug: 'gaming', path: '/category/gaming' },
    ].map((category) => ({
      ...category,
      name: getLocalizedCategoryLabel(category.slug, t),
    })),
    [t]
  );

  const cartItemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const currentColorMode = colorModeOptions.find((mode) => mode.value === colorMode) || colorModeOptions[0];
  const currentColorLabel = currentColorMode?.label || 'Neo Cyan';
  const currentMotionMode = motionModeOptions.find((mode) => mode.value === motionMode) || motionModeOptions[0];
  const effectiveMotionLabel = motionModeOptions.find((mode) => mode.value === effectiveMotionMode)?.label || effectiveMotionMode;
  const motionOptionDescriptions = {
    cinematic: t('nav.motionCinematic', {}, 'Full transitions and richer movement.'),
    balanced: t('nav.motionBalanced', {}, 'Default motion with lighter overhead.'),
    minimal: t('nav.motionMinimal', {}, 'Reduced motion for clarity and speed.'),
  };
  const loyaltyPoints = Number(dbUser?.loyalty?.pointsBalance || 0);
  const isSeller = Boolean(dbUser?.isSeller);
  const sellerCtaTarget = isSeller ? '/sell' : '/become-seller';
  const sellerCtaLabel = isSeller
    ? t('nav.sell', {}, 'Sell')
    : t('nav.becomeSeller', {}, 'Become seller');
  const navActionClasses =
    'hidden xl:inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.075] hover:text-white';
  const quickActionLinks = [
    {
      label: t('nav.marketplace', {}, 'Marketplace'),
      path: '/marketplace',
      icon: Store,
      tone: 'border-sky-300/20 bg-sky-500/10 text-sky-100 hover:bg-sky-500/15',
    },
    {
      label: t('nav.missionOs', {}, 'Mission OS'),
      path: '/mission-control',
      icon: Sparkles,
      tone: 'border-cyan-300/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15',
    },
    {
      label: t('nav.aiCompare', {}, 'AI Compare'),
      path: '/compare',
      icon: Gauge,
      tone: 'border-cyan-300/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15',
    },
    {
      label: t('nav.visualSearch', {}, 'Visual Search'),
      path: '/visual-search',
      icon: Sparkles,
      tone: 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15',
    },
    {
      label: t('nav.smartBundles', {}, 'Smart Bundles'),
      path: '/bundles',
      icon: Plus,
      tone: 'border-violet-300/20 bg-violet-500/10 text-violet-100 hover:bg-violet-500/15',
    },
    {
      label: t('nav.wishlist', {}, 'Wishlist'),
      path: '/wishlist',
      icon: Heart,
      tone: 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]',
    },
  ];
  const workspaceLinks = [
    {
      label: isSeller ? t('nav.sellerDesk', {}, 'Seller Desk') : t('nav.becomeSeller', {}, 'Become seller'),
      path: isSeller ? '/my-listings' : '/become-seller',
      icon: Store,
      tone: 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]',
    },
    {
      label: t('nav.priceAlerts', {}, 'Price Alerts'),
      path: '/price-alerts',
      icon: Sparkles,
      tone: 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]',
    },
    ...(dbUser?.isAdmin ? [{
      label: t('nav.adminPortal', {}, 'Admin portal'),
      path: '/admin/dashboard',
      icon: Shield,
      tone: 'border-amber-300/25 bg-amber-400/12 text-amber-100 hover:bg-amber-400/18',
    }] : []),
  ];
  const closeUserPanel = () => {
    setIsUserMenuOpen(false);
    setIsPreferencesOpen(false);
    setIsAdminToolsOpen(false);
  };
  const closeQuickPanel = () => setIsQuickPanelOpen(false);
  const closeMarketPanel = () => setIsMarketPanelOpen(false);
  const closeNotifications = () => setIsNotificationsOpen(false);
  const closeAllNavigationPanels = () => {
    setIsMobileMenuOpen(false);
    closeQuickPanel();
    closeMarketPanel();
    closeNotifications();
    closeUserPanel();
  };
  const handlePanelNavigate = (path) => (event) => {
    event?.preventDefault();
    closeAllNavigationPanels();
    requestAnimationFrame(() => {
      navigate(path);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    });
  };
  const handleProfileMenuToggle = () => {
    closeQuickPanel();
    closeMarketPanel();
    closeNotifications();
    setIsMobileMenuOpen(false);
    setIsUserMenuOpen((open) => {
      const nextOpen = !open;
      if (!nextOpen) {
        setIsPreferencesOpen(false);
        setIsAdminToolsOpen(false);
      }
      return nextOpen;
    });
  };
  const handleNotificationsOpenChange = (nextOpen) => {
    if (nextOpen) {
      closeQuickPanel();
      closeMarketPanel();
      closeUserPanel();
      setIsMobileMenuOpen(false);
    }
    setIsNotificationsOpen(nextOpen);
  };
  const handleCloseUserMenu = () => {
    closeUserPanel();
  };
  const handleQuickPanelToggle = () => {
    closeNotifications();
    closeMarketPanel();
    closeUserPanel();
    setIsMobileMenuOpen(false);
    setIsQuickPanelOpen((open) => !open);
  };
  const handleMarketPanelToggle = () => {
    closeNotifications();
    closeQuickPanel();
    closeUserPanel();
    setIsMobileMenuOpen(false);
    setIsMarketPanelOpen((open) => !open);
  };
  const handleOpenMarketStudio = () => {
    closeQuickPanel();
    closeNotifications();
    setIsMobileMenuOpen(false);
    setIsMarketPanelOpen(true);
  };
  const userMenuPanelClasses = cn(
    'z-[60] overflow-x-hidden overflow-y-auto border border-white/12 bg-[#061018] shadow-[0_28px_90px_rgba(2,8,23,0.8)] ring-1 ring-white/8 animate-fade-in',
    isCompactViewport
      ? 'fixed inset-x-3 top-[5.5rem] max-h-[min(32rem,calc(100vh-6rem))] rounded-[1.7rem] py-3'
      : 'absolute right-0 mt-3 w-[16.5rem] max-w-[calc(100vw-1.5rem)] max-h-[min(31rem,calc(100vh-6.5rem))] rounded-2xl py-2'
  );

  return (
    <>
      <header
        className={cn(
          'fixed top-0 left-0 right-0 z-50 overflow-x-clip transition-all duration-300 aura-nav-shell',
          isCompact && 'aura-nav-compact',
          isScrolled
            ? 'aura-nav-scrolled bg-[linear-gradient(180deg,rgba(2,6,23,0.84),rgba(2,6,23,0.38))] border-transparent'
            : 'bg-[linear-gradient(180deg,rgba(2,6,23,0.74),rgba(2,6,23,0.18))] border-transparent'
        )}
        style={isCompactViewport ? { width: '100dvw', maxWidth: '100dvw' } : undefined}
      >
        <div className="pointer-events-none absolute inset-x-[14%] top-0 h-px bg-gradient-to-r from-transparent via-neo-cyan/60 to-transparent animate-gradient-x" style={{ backgroundSize: '200% auto' }} />
        <div className="pointer-events-none absolute inset-x-[20%] top-2 h-20 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.12),transparent_68%)] blur-3xl" />
        <div className="container-custom max-w-[90rem] mx-auto px-3 sm:px-5 lg:px-6">
          <div
            className={cn(
              'relative min-w-0 rounded-[1.85rem] border px-2.5 py-2.5 sm:px-3.5 lg:px-4',
              'bg-[linear-gradient(180deg,rgba(7,12,24,0.92),rgba(5,10,20,0.78))] shadow-[0_20px_58px_rgba(2,8,23,0.38)]',
              isScrolled ? 'border-white/15' : 'border-white/[0.08]'
            )}
          >
            <div className="pointer-events-none absolute inset-[1px] rounded-[calc(1.85rem-1px)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01)_30%,transparent)]" />
            <div className="relative min-w-0 flex items-center justify-between gap-2 sm:gap-3 lg:gap-4">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 flex-shrink-0 group">
              <div className="w-11 h-11 rounded-[1rem] bg-gradient-to-br from-neo-cyan via-sky-400 to-neo-emerald p-[1px] shadow-[0_14px_28px_rgba(6,182,212,0.22)] transition-all duration-500 group-hover:shadow-[0_18px_38px_rgba(16,185,129,0.3)]">
                <div className="w-full h-full bg-zinc-950 rounded-[15px] flex items-center justify-center relative overflow-hidden">
                  <Sparkles className="w-5 h-5 text-neo-cyan group-hover:text-neo-emerald transition-colors duration-500 relative z-10" />
                  <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-white text-lg sm:text-xl lg:text-2xl font-black tracking-[-0.06em] bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400 group-hover:from-neo-cyan group-hover:to-neo-emerald transition-all duration-500">
                  AURA
                </span>
                <span className="hidden sm:inline text-slate-500 text-[10px] font-bold tracking-[0.24em] uppercase -mt-1 group-hover:text-neo-cyan transition-colors">
                  {t('nav.network', {}, 'Network')}
                </span>
              </div>
            </Link>

            {/* Search Bar - Desktop */}
            <AppErrorBoundary
              fallback={(
                <NavbarSearchFallback
                  className="flex-[1.2] min-w-[18rem] xl:min-w-[24rem] max-w-[32rem] xl:max-w-[40rem] 2xl:max-w-[46rem]"
                  openLabel={t('nav.searchFallbackOpen', {}, 'Open search')}
                />
              )}
            >
              <GlobalSearchBar
                className="hidden lg:flex flex-[1.2] min-w-[18rem] xl:min-w-[24rem] max-w-[32rem] xl:max-w-[40rem] 2xl:max-w-[46rem]"
                placeholder={t('nav.searchDesktop', {}, 'Search products, brands, and live deals')}
              />
            </AppErrorBoundary>

            {/* Primary commerce actions */}
            <div className="hidden xl:flex items-center gap-2 flex-shrink-0">
              <Link
                to={sellerCtaTarget}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-neo-cyan to-neo-emerald px-4 py-2.5 text-sm font-black text-white shadow-[0_16px_32px_rgba(6,182,212,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:from-sky-500 hover:to-emerald-500"
              >
                <Plus className="w-4 h-4" />
                {sellerCtaLabel}
              </Link>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 flex-shrink-0">
              <div className="relative hidden lg:block" ref={marketPanelRef}>
                <button
                  type="button"
                  onClick={handleMarketPanelToggle}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-200 transition-all duration-200',
                    isMarketPanelOpen
                      ? 'border-cyan-300/35 bg-cyan-400/12 text-white shadow-[0_0_18px_rgba(34,211,238,0.18)]'
                      : 'border-white/10 bg-white/[0.045] hover:border-white/18 hover:bg-white/[0.08] hover:text-white'
                  )}
                  aria-label={t(
                    'nav.openMarketPanel',
                    { country: countryLabel, currency, language: currentLanguage?.nativeLabel || language.toUpperCase() },
                    `Open market settings for ${countryLabel}, ${currency}, ${currentLanguage?.nativeLabel || language.toUpperCase()}`
                  )}
                  aria-expanded={isMarketPanelOpen}
                >
                  <Globe2 className="h-4 w-4 text-neo-cyan" />
                  <span>{countryCode}</span>
                  <span className="hidden xl:inline">{currency}</span>
                </button>

                {isMarketPanelOpen && (
                  <>
                    <button
                      type="button"
                      aria-label={t('nav.closeMarketBackdrop', {}, 'Close market panel backdrop')}
                      className="fixed inset-0 z-40 bg-zinc-950/34"
                      onClick={closeMarketPanel}
                    />
                    <div className="absolute right-0 z-[60] mt-3 w-[22rem] max-w-[calc(100vw-2rem)] rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(7,12,24,0.98),rgba(5,9,20,0.98))] p-3.5 shadow-[0_26px_80px_rgba(2,8,23,0.7)] ring-1 ring-cyan-400/10">
                      <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300/80">
                          {t('market.title', {}, 'Market Studio')}
                        </div>
                        <div className="mt-1 text-base font-black text-white">
                          {t('nav.marketPanelTitle', {}, 'Country, language, and currency controls.')}
                        </div>
                        <p className="mt-1 text-sm text-slate-400">
                          {t(
                            'nav.marketPanelBody',
                            {},
                            'Tune browsing without disturbing the main navigation rail.'
                          )}
                        </p>
                      </div>

                      <div className="mt-3">
                        <MarketPreferenceCard
                          t={t}
                          countryCode={countryCode}
                          language={language}
                          currency={currency}
                          regionLabel={regionLabel}
                          countryOptions={countryOptions}
                          currencyOptions={currencyOptions}
                          languageOptions={languageOptions}
                          setCountryCode={setCountryCode}
                          setLanguage={setLanguage}
                          setCurrency={setCurrency}
                          resetToDetected={resetToDetected}
                          detectedCountryLabel={detectedCountryLabel}
                          detectedRegionLabel={detectedRegionLabel}
                          browseCurrencyNote={browseCurrencyNote}
                          isEstimatedPricing={currency !== 'INR'}
                          compact
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="relative hidden lg:block" ref={quickPanelRef}>
                <button
                  type="button"
                  onClick={handleQuickPanelToggle}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
                    isQuickPanelOpen
                      ? 'border-cyan-300/35 bg-cyan-400/12 text-white shadow-[0_0_18px_rgba(34,211,238,0.18)]'
                      : 'border-white/10 bg-white/[0.045] text-slate-200 hover:border-white/18 hover:bg-white/[0.08] hover:text-white'
                  )}
                  aria-label={t('nav.openQuickPanel', {}, 'Open quick access panel')}
                  aria-expanded={isQuickPanelOpen}
                >
                  <LayoutGrid className="h-4 w-4 text-neo-cyan" />
                      <span className="hidden 2xl:inline">{t('nav.explore', {}, 'Explore')}</span>
                  <ChevronDown className={cn('h-4 w-4 opacity-60 transition-transform', isQuickPanelOpen && 'rotate-180')} />
                </button>

                {isQuickPanelOpen && (
                  <>
                    <button
                      type="button"
                      aria-label={t('nav.closeExploreBackdrop', {}, 'Close explore panel backdrop')}
                      className="fixed inset-0 z-40 bg-zinc-950/34"
                      onClick={closeQuickPanel}
                    />
                    <div className="absolute right-0 z-[60] mt-3 w-[23rem] max-w-[calc(100vw-2rem)] rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(7,12,24,0.98),rgba(5,9,20,0.98))] p-3.5 shadow-[0_26px_80px_rgba(2,8,23,0.7)] ring-1 ring-cyan-400/10">
                      <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300/80">{t('nav.explore', {}, 'Explore')}</div>
                        <div className="mt-1 text-base font-black text-white">{t('nav.exploreTitle', {}, 'Curated routes for higher-intent shopping.')}</div>
                        <p className="mt-1 text-sm text-slate-400">
                          {t('nav.exploreBody', {}, 'Jump into discovery, comparison, and workspace routes without opening a full control surface.')}
                        </p>
                      </div>

                      <div className="mt-3">
                        <MarketSnapshotCard
                          t={t}
                          countryLabel={countryLabel}
                          currency={currency}
                          languageLabel={currentLanguage?.nativeLabel || language.toUpperCase()}
                          regionLabel={regionLabel}
                          browseCurrencyNote={browseCurrencyNote}
                          onOpenStudio={handleOpenMarketStudio}
                        />
                      </div>

                      <div className="mt-3">
                        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t('nav.tools', {}, 'Tools')}</div>
                        <div className="grid grid-cols-2 gap-2">
                          {quickActionLinks.map((item) => {
                            const ItemIcon = item.icon;
                            return (
                              <Link
                                key={item.path}
                                to={item.path}
                                onClick={handlePanelNavigate(item.path)}
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
                        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t('nav.workspace', {}, 'Workspace')}</div>
                        <div className="space-y-2">
                          {workspaceLinks.map((item) => {
                            const ItemIcon = item.icon;
                            return (
                              <Link
                                key={item.path}
                                to={item.path}
                                onClick={handlePanelNavigate(item.path)}
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

              {activeUser ? (
                <div className="flex items-center gap-2 sm:gap-2.5">
                  <div className="relative" ref={userMenuRef}>
                    <button
                      onClick={handleProfileMenuToggle}
                      className="flex max-w-[8.2rem] items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-2 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:border-white/18 hover:bg-white/[0.08] hover:text-white xl:max-w-[9.5rem] 2xl:max-w-[11rem]"
                      aria-label={t('nav.openProfileMenu', {}, 'Open profile menu')}
                      aria-expanded={isUserMenuOpen}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-neo-cyan/25 to-neo-emerald/25 border border-white/10">
                        <User className="w-4 h-4 text-neo-cyan" />
                      </span>
                      <span className="hidden xl:inline text-sm font-semibold tracking-wide truncate">
                        {displayName}
                      </span>
                      <ChevronDown className="hidden h-4 w-4 opacity-50 2xl:block" />
                    </button>

                    {isUserMenuOpen && (
                      <>
                        <button
                          type="button"
                          aria-label={t('nav.closeProfileBackdrop', {}, 'Close profile menu backdrop')}
                          className={cn('fixed inset-0 z-40', isCompactViewport ? 'bg-zinc-950/45' : 'bg-zinc-950/34')}
                          onClick={() => {
                            handleCloseUserMenu();
                          }}
                        />
                        <div className={userMenuPanelClasses}>
                          <div className="px-4 pb-2">
                              {isCompactViewport && (
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300/80">
                                      {t('nav.account', {}, 'Account')}
                                    </div>
                                    <div className="mt-1 text-sm text-slate-400">
                                      {t('nav.accountSummary', {}, 'Profile, preferences, and control links.')}
                                    </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleCloseUserMenu}
                                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
                                >
                                  {t('nav.close', {}, 'Close')}
                                </button>
                              </div>
                            )}
                            <div className="text-sm font-bold text-white truncate">{displayName}</div>
                            <div className="text-xs text-slate-400 truncate">{activeUser.email}</div>
                            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100">
                              <Sparkles className="h-3 w-3" />
                              {t('nav.auraPoints', { count: formatNumber(loyaltyPoints) }, `${formatNumber(loyaltyPoints)} AP`)}
                            </div>
                          </div>
                          <div className="my-1 border-t border-white/10" />
                          <Link
                            to="/profile"
                            className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                            onClick={handlePanelNavigate('/profile')}
                          >
                            {t('nav.profile', {}, 'My profile')}
                          </Link>
                          {isSeller ? (
                            <Link
                              to="/my-listings"
                              className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                              onClick={handlePanelNavigate('/my-listings')}
                            >
                              {t('nav.myListings', {}, 'My listings')}
                            </Link>
                          ) : (
                            <Link
                              to="/become-seller"
                              className="block px-4 py-2.5 text-sm text-neo-cyan transition-colors hover:bg-cyan-500/10 hover:text-cyan-200"
                              onClick={handlePanelNavigate('/become-seller')}
                            >
                              {t('nav.becomeSeller', {}, 'Become seller')}
                            </Link>
                          )}
                          <Link
                            to="/wishlist"
                            className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                            onClick={handlePanelNavigate('/wishlist')}
                          >
                            {t('nav.wishlist', {}, 'Wishlist')}
                          </Link>
                          <Link
                            to="/orders"
                            className="block px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                            onClick={handlePanelNavigate('/orders')}
                          >
                            {t('nav.orders', {}, 'Orders')}
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
                                  {t('nav.adminTools', {}, 'Admin Tools')}
                                </span>
                                <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', isAdminToolsOpen && 'rotate-180')} />
                              </button>
                              {isAdminToolsOpen && (
                                <div className="px-3 pb-2">
                                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                                    <Link
                                      to="/admin/dashboard"
                                      className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                                      onClick={handlePanelNavigate('/admin/dashboard')}
                                    >
                                      {t('nav.adminDashboard', {}, 'Admin Dashboard')}
                                    </Link>
                                    <Link
                                      to="/admin/payments"
                                      className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                                      onClick={handlePanelNavigate('/admin/payments')}
                                    >
                                      {t('nav.paymentOps', {}, 'Payment Ops')}
                                    </Link>
                                    <Link
                                      to="/admin/users"
                                      className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                                      onClick={handlePanelNavigate('/admin/users')}
                                    >
                                      {t('nav.userGovernance', {}, 'User governance')}
                                    </Link>
                                    <Link
                                      to="/admin/support"
                                      className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                                      onClick={handlePanelNavigate('/admin/support')}
                                    >
                                      {t('nav.customerSupport', {}, 'Customer support')}
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
                              {t('nav.preferences', {}, 'Preferences')}
                            </span>
                            <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', isPreferencesOpen && 'rotate-180')} />
                          </button>
                          {isPreferencesOpen && (
                            <div className="px-3 pb-3">
                              <MarketPreferenceCard
                                t={t}
                                countryCode={countryCode}
                                language={language}
                                currency={currency}
                                regionLabel={regionLabel}
                                countryOptions={countryOptions}
                                currencyOptions={currencyOptions}
                                languageOptions={languageOptions}
                                setCountryCode={setCountryCode}
                                setLanguage={setLanguage}
                                setCurrency={setCurrency}
                                resetToDetected={resetToDetected}
                                detectedCountryLabel={detectedCountryLabel}
                                detectedRegionLabel={detectedRegionLabel}
                                browseCurrencyNote={browseCurrencyNote}
                                isEstimatedPricing={currency !== 'INR'}
                                compact
                              />
                              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t('nav.colorMode', {}, 'Color mode')}</div>
                                <PremiumSelect
                                  value={colorMode}
                                  onChange={(e) => setColorMode(e.target.value)}
                                  className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors hover:border-white/20"
                                >
                                  {colorModeOptions.map((mode) => (
                                    <option key={mode.value} value={mode.value} className="bg-zinc-950 text-slate-100">
                                      {mode.label}
                                    </option>
                                  ))}
                                </PremiumSelect>
                                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                                  <span
                                    className="h-3 w-3 rounded-full border border-white/20"
                                    style={{
                                      background: `linear-gradient(135deg, ${currentColorMode?.primary || '#06b6d4'}, ${currentColorMode?.secondary || '#10b981'})`,
                                    }}
                                  />
                                  {currentColorLabel}
                                </div>

                                <div className="mt-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t('nav.motion', {}, 'Motion')}</div>
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
                                            {t('nav.selected', {}, 'Selected')}
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1 text-[11px] font-medium normal-case tracking-normal text-slate-400">
                                        {motionOptionDescriptions[mode.value] || t('nav.motionProfile', {}, 'Motion profile')}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                                <div className="mt-3 text-[11px] text-slate-400">
                                  {t('nav.selected', {}, 'Selected')}: <span className="font-semibold text-slate-200">{currentMotionMode?.label || 'Balanced'}</span>
                                  {' | '}
                                  {t('nav.effective', {}, 'Effective')}: <span className="font-semibold text-slate-200">{effectiveMotionLabel}</span>
                                </div>
                                {autoDowngraded && (
                                  <p className="mt-2 text-[11px] leading-5 text-amber-200">
                                    {t('nav.autoMotionNotice', {}, 'Auto performance mode is overriding the selected motion profile to keep interactions stable.')}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="my-1 border-t border-white/10" />
                          <button
                            onClick={() => {
                              logout();
                              handleCloseUserMenu();
                            }}
                            className="block w-full px-4 py-2.5 text-left text-sm text-neo-rose transition-colors hover:bg-neo-rose/10"
                          >
                            {t('nav.logout', {}, 'Logout')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <AppErrorBoundary
                    fallback={(
                      <NavbarNotificationsFallback
                        label={t('nav.notificationsUnavailable', {}, 'Notifications temporarily unavailable')}
                        title={t('nav.notificationsUnavailableTitle', {}, 'Notifications are temporarily unavailable')}
                      />
                    )}
                  >
                    <NotificationDropdown
                      isCompact={isCompactViewport}
                      isOpen={isNotificationsOpen}
                      onOpenChange={handleNotificationsOpenChange}
                    />
                  </AppErrorBoundary>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={goToLoginPage}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(2,8,23,0.18),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300 hover:-translate-y-0.5 hover:border-neo-cyan hover:bg-white/[0.08] active:translate-y-0 sm:px-4 lg:px-5"
                >
                  {t('nav.login', {}, 'Login')}
                </button>
              )}

              {/* Cart */}
              <Link
                to="/cart"
                className="group flex items-center gap-2 rounded-full border border-transparent p-2 text-slate-300 transition-all hover:border-white/10 hover:bg-white/[0.05] hover:text-neo-cyan"
                aria-label={t('nav.cart', {}, 'Cart')}
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
                className="rounded-full p-2 text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none md:hidden"
                aria-label={t('nav.toggleMenu', {}, 'Toggle menu')}
              >
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
            </div>
          </div>

          {/* Mobile Search - Slide down animation */}
          <div
            className={cn(
              'md:hidden overflow-hidden transition-all duration-300 ease-in-out',
              isMobileMenuOpen ? 'max-h-[30rem] mt-4 pb-2' : 'max-h-0'
            )}
          >
            {isMobileMenuOpen ? (
              <AppErrorBoundary
                fallback={(
                  <NavbarSearchFallback
                    mobile
                    label={t('nav.searchMobile', {}, 'Search products, categories, and actions...')}
                    openLabel={t('nav.searchFallbackOpen', {}, 'Open search')}
                    onNavigate={() => setIsMobileMenuOpen(false)}
                  />
                )}
              >
                <GlobalSearchBar
                  mobile
                  placeholder={t('nav.searchMobile', {}, 'Search products, categories, and actions...')}
                  onNavigate={() => setIsMobileMenuOpen(false)}
                  enableGlobalShortcuts={false}
                />
              </AppErrorBoundary>
            ) : null}
          </div>
        </div>

        {isMobileMenuOpen && (
          <button
            type="button"
            aria-label={t('nav.closeMobileMenuBackdrop', {}, 'Close mobile menu backdrop')}
            className="fixed inset-0 z-40 bg-zinc-950/70 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Mobile Nav Menu */}
        {isMobileMenuOpen && (
          <div className="absolute left-0 top-full z-50 w-full border-t border-white/10 bg-zinc-950/95 animate-fade-in md:hidden">
            <nav className="max-h-[calc(100vh-5.5rem)] overflow-y-auto px-4 py-4">
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{t('nav.quickAccess', {}, 'Quick access')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/mission-control"
                    onClick={handlePanelNavigate('/mission-control')}
                    className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-3 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/15"
                  >
                    <Sparkles className="h-4 w-4" />
                    {t('nav.missionOs', {}, 'Mission OS')}
                  </Link>
                  <Link
                    to="/marketplace"
                    onClick={handlePanelNavigate('/marketplace')}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
                  >
                    <Store className="h-4 w-4 text-neo-cyan" />
                    {t('nav.marketplace', {}, 'Marketplace')}
                  </Link>
                  <Link
                    to={isSeller ? '/sell' : '/become-seller'}
                    onClick={handlePanelNavigate(isSeller ? '/sell' : '/become-seller')}
                    className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/15"
                  >
                    <Plus className="h-4 w-4" />
                    {isSeller ? t('nav.sell', {}, 'Sell') : t('nav.becomeSeller', {}, 'Become seller')}
                  </Link>
                  <Link
                    to="/wishlist"
                    onClick={handlePanelNavigate('/wishlist')}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
                  >
                    <Heart className="h-4 w-4 text-neo-emerald" />
                    {t('nav.wishlist', {}, 'Wishlist')}
                  </Link>
                  <Link
                    to="/cart"
                    onClick={handlePanelNavigate('/cart')}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
                  >
                    <ShoppingCart className="h-4 w-4 text-neo-cyan" />
                    {t('nav.cart', {}, 'Cart')} {cartItemCount > 0 ? `(${cartItemCount > 9 ? '9+' : cartItemCount})` : ''}
                  </Link>
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{t('nav.browseByCategory', {}, 'Browse by category')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map((category) => (
                    <Link
                      key={category.path}
                      to={category.path}
                      onClick={handlePanelNavigate(category.path)}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      {category.name}
                    </Link>
                  ))}
                </div>
              </section>

              {(activeUser || dbUser?.isAdmin) && (
                <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
                  <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{t('nav.accountControl', {}, 'Account control')}</div>
                  <div className="space-y-2">
                    {activeUser && (
                      <>
                        <Link to="/profile" onClick={handlePanelNavigate('/profile')} className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          {t('nav.profile', {}, 'My profile')}
                        </Link>
                        <Link to="/orders" onClick={handlePanelNavigate('/orders')} className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          {t('nav.orders', {}, 'Orders')}
                        </Link>
                        {isSeller && (
                          <Link to="/my-listings" onClick={handlePanelNavigate('/my-listings')} className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                            {t('nav.myListings', {}, 'My listings')}
                          </Link>
                        )}
                      </>
                    )}
                    {dbUser?.isAdmin && (
                      <>
                        <Link to="/admin/dashboard" onClick={handlePanelNavigate('/admin/dashboard')} className="flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-3 text-sm font-semibold text-violet-100 transition-colors hover:bg-violet-500/15">
                          <Shield className="h-4 w-4" />
                          {t('nav.adminPortal', {}, 'Admin portal')}
                        </Link>
                        <Link to="/admin/products" onClick={handlePanelNavigate('/admin/products')} className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          {t('nav.productControl', {}, 'Product control')}
                        </Link>
                        <Link to="/admin/users" onClick={handlePanelNavigate('/admin/users')} className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          {t('nav.userGovernance', {}, 'User governance')}
                        </Link>
                        <Link to="/admin/support" onClick={handlePanelNavigate('/admin/support')} className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]">
                          {t('nav.customerSupport', {}, 'Customer support')}
                        </Link>
                      </>
                    )}
                  </div>
                </section>
              )}

              <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '175ms', animationFillMode: 'both' }}>
                <MarketPreferenceCard
                  t={t}
                  countryCode={countryCode}
                  language={language}
                  currency={currency}
                  regionLabel={regionLabel}
                  countryOptions={countryOptions}
                  currencyOptions={currencyOptions}
                  languageOptions={languageOptions}
                  setCountryCode={setCountryCode}
                  setLanguage={setLanguage}
                  setCurrency={setCurrency}
                  resetToDetected={resetToDetected}
                  detectedCountryLabel={detectedCountryLabel}
                  detectedRegionLabel={detectedRegionLabel}
                  browseCurrencyNote={browseCurrencyNote}
                  isEstimatedPricing={currency !== 'INR'}
                  compact
                />
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-fade-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{t('nav.experience', {}, 'Experience')}</div>
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <Palette className="h-4 w-4 text-neo-cyan" />
                    {t('nav.colorMode', {}, 'Color mode')}
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
                    {t('nav.motion', {}, 'Motion')}
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
                              {t('nav.selected', {}, 'Selected')}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] font-medium normal-case tracking-normal text-slate-400">
                          {motionOptionDescriptions[mode.value] || t('nav.motionProfile', {}, 'Motion profile')}
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-slate-400">
                    {t('nav.selected', {}, 'Selected')}: <span className="font-semibold text-slate-200">{currentMotionMode?.label || 'Balanced'}</span>
                    {' | '}
                    {t('nav.effective', {}, 'Effective')}: <span className="font-semibold text-slate-200">{effectiveMotionLabel}</span>
                  </p>
                  {autoDowngraded && (
                    <p className="mt-2 text-[11px] leading-5 text-amber-200">
                      {t('nav.autoMotionNotice', {}, 'Auto performance mode is overriding the selected motion profile to keep interactions stable.')}
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
                  {t('nav.loginSignup', {}, 'Login / Sign up')}
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Spacer to prevent content from hiding behind fixed navbar */}
      <div className="aura-nav-spacer" />
    </>
  );
};

export default Navbar;
