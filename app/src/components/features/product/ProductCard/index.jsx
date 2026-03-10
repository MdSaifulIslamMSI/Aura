import { useContext, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  Camera,
  Clock3,
  Heart,
  Megaphone,
  ShoppingCart,
  Star,
} from 'lucide-react';
import { WishlistContext } from '@/context/WishlistContext';
import { CartContext } from '@/context/CartContext';
import { useColorMode } from '@/context/ColorModeContext';
import { FIGMA_COLOR_MODE_OPTIONS } from '@/config/figmaTokens';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';
import { productApi } from '@/services/api';

const FALLBACK_IMAGE = 'https://placehold.co/400x400/18181b/4ade80?text=Aura+Select';

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

const resolveDealTheme = (dealDna) => {
  if (dealDna?.verdict === 'good_deal') {
    return {
      label: 'Good Deal',
      surface: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100',
    };
  }

  if (dealDna?.verdict === 'avoid') {
    return {
      label: 'Skip For Now',
      surface: 'border-rose-400/35 bg-rose-500/12 text-rose-100',
    };
  }

  return {
    label: dealDna?.verdict === 'wait' ? 'Watch Price' : 'Review Signal',
    surface: 'border-amber-400/35 bg-amber-500/12 text-amber-100',
  };
};

const formatRating = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return numeric.toFixed(1).replace(/\.0$/, '');
};

const StatusBadge = ({ icon: Icon, label, toneClass }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
      toneClass
    )}
  >
    <Icon className="h-3 w-3" />
    {label}
  </span>
);

const IconToolButton = ({ icon: Icon, label, onClick, toneClass, style }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={cn(
      'flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-300',
      toneClass
    )}
    style={style}
  >
    <Icon className="h-4 w-4" />
  </button>
);

const TextToolButton = ({ icon: Icon, label, onClick, toneClass, style }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
      toneClass
    )}
    style={style}
  >
    <Icon className="h-3.5 w-3.5" />
    {label}
  </button>
);

const ProductCard = ({ product, variant = 'default' }) => {
  const { toggleWishlist, isInWishlist } = useContext(WishlistContext);
  const { addToCart } = useContext(CartContext);
  const { colorMode } = useColorMode();
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);
  const hasPrefetchedRef = useRef(false);

  const isWhiteMode = colorMode === 'white';
  const modePalette = FIGMA_COLOR_MODE_OPTIONS.find((mode) => mode.value === colorMode) || FIGMA_COLOR_MODE_OPTIONS[0];
  const dealDna = product?.dealDna || null;
  const dealTheme = resolveDealTheme(dealDna);
  const isSponsored = Boolean(product?.adMeta?.isSponsored || product?.adCampaign?.isSponsored);
  const sponsoredLabel = product?.adMeta?.label || 'Sponsored';
  const sponsoredTagline = product?.adCampaign?.creativeTagline || '';
  const productId = product?.id || product?._id || '';
  const productPath = productId ? `/product/${productId}` : '/products';
  const displayTitle = product?.displayTitle || product?.title || '';
  const subtitle = product?.subtitle || '';
  const categoryLabel = product?.category || '';
  const brandLabel = product?.brand || 'Aura';
  const searchTelemetry = product?.searchTelemetry || null;
  const isDemoCatalog = product?.publishGate?.status === 'dev_only' || product?.provenance?.sourceType === 'dev_seed';
  const inWishlist = productId ? isInWishlist(productId) : false;
  const ratingValue = formatRating(product?.rating);
  const ratingCount = Number(product?.ratingCount || 0);
  const priceValue = Number(product?.price || 0);
  const originalPrice = Number(product?.originalPrice || 0);
  const hasOriginalPrice = Number.isFinite(originalPrice) && originalPrice > priceValue;
  const discountValue = Math.max(0, Number(product?.discountPercentage || 0));
  const stockCount = Number(product?.stock || 0);
  const isOutOfStock = stockCount <= 0;
  const deliveryLabel = product?.deliveryTime || 'Fast dispatch';
  const primaryStory = sponsoredTagline || (product?.highlights || []).find(Boolean) || '';
  const secondaryStory = (product?.highlights || [])
    .filter(Boolean)
    .filter((story) => story !== primaryStory)
    .slice(0, 2);
  const accentColor = modePalette.primary;
  const accentSecondary = modePalette.secondary;

  const prefetchProduct = () => {
    if (!productId || hasPrefetchedRef.current) return;
    hasPrefetchedRef.current = true;
    productApi.prefetchProductById(productId);
  };

  const trackSearchSelection = () => {
    if (!productId || !searchTelemetry?.searchEventId) return;
    void productApi.trackSearchClick({
      searchEventId: searchTelemetry.searchEventId,
      productId,
      position: searchTelemetry.position || 0,
      sourceContext: searchTelemetry.sourceContext || 'catalog_listing',
      query: searchTelemetry.query || '',
      filters: searchTelemetry.filters || {},
    });
  };

  const stopCardNavigation = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleWishlistClick = (event) => {
    stopCardNavigation(event);
    toggleWishlist(product);
  };

  const handleAddToCart = (event) => {
    stopCardNavigation(event);
    if (isOutOfStock) return;
    addToCart(product, 1);
  };

  const handleOpenCompare = (event) => {
    stopCardNavigation(event);
    if (!productId) return;
    navigate(`/compare?ids=${encodeURIComponent(String(productId))}`);
  };

  const handleOpenVisualSearch = (event) => {
    stopCardNavigation(event);
    const params = new URLSearchParams();

    if (product?.image) {
      params.set('imageUrl', String(product.image));
    }

    const hints = [product?.brand, product?.title, product?.category].filter(Boolean).join(' ');
    if (hints) {
      params.set('hints', hints);
    }

    navigate(`/visual-search${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleOpenDealDna = (event) => {
    stopCardNavigation(event);
    if (!productId) return;
    navigate(`/product/${productId}?panel=deal-dna`);
  };

  const handleOpenSmartBundle = (event) => {
    stopCardNavigation(event);
    const theme = `${product?.category || product?.brand || 'smart essentials'}`.toLowerCase();
    const budget = Math.max(5000, Math.min(200000, Math.round((Number(product?.price) || 15000) * 2.5)));
    navigate(`/bundles?theme=${encodeURIComponent(theme)}&budget=${budget}`);
  };

  const iconToolTone = isWhiteMode
    ? 'border-slate-300/90 bg-white/92 text-slate-700 hover:border-blue-400 hover:text-blue-700 hover:-translate-y-0.5'
    : 'hover:-translate-y-0.5';

  const textToolTone = isWhiteMode
    ? 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-700'
    : '';

  const quickTools = [
    { key: 'compare', label: 'Compare', icon: Brain, onClick: handleOpenCompare },
    { key: 'visual', label: 'Visual Search', icon: Camera, onClick: handleOpenVisualSearch },
    { key: 'deal-dna', label: 'Deal DNA', icon: BadgeCheck, onClick: handleOpenDealDna },
    { key: 'bundle', label: 'Bundle AI', icon: Clock3, onClick: handleOpenSmartBundle },
  ];

  const surfaceClass = isWhiteMode
    ? 'bg-white/96 border-slate-200 shadow-[0_18px_40px_rgba(15,23,42,0.12)] hover:border-blue-300'
    : 'hover:translate-y-[-2px]';

  const mediaClass = isWhiteMode
    ? 'bg-[radial-gradient(circle_at_top,rgba(191,219,254,0.38),transparent_58%),linear-gradient(180deg,#ffffff,#f8fafc)] border-slate-200'
    : '';

  const contentClass = isWhiteMode
    ? 'from-white to-slate-100/80 text-slate-900'
    : 'text-white';

  const mutedTextClass = isWhiteMode ? 'text-slate-600' : 'text-slate-300';
  const subtleTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
  const cardSurfaceStyle = isWhiteMode
    ? undefined
    : {
        background: `linear-gradient(180deg, ${toRgba(accentColor, 0.08)} 0%, rgba(7,10,18,0.97) 24%, rgba(15,23,42,0.92) 100%)`,
        borderColor: toRgba(accentColor, 0.22),
        boxShadow: `0 18px 40px rgba(2,8,23,0.34), 0 0 0 1px ${toRgba(accentColor, 0.05)}`,
      };
  const cardMediaStyle = isWhiteMode
    ? undefined
    : {
        background: `radial-gradient(circle at top, ${toRgba(accentColor, 0.18)}, transparent 56%), linear-gradient(180deg, ${toRgba(accentSecondary, 0.08)}, rgba(255,255,255,0.02))`,
        borderColor: toRgba(accentColor, 0.12),
      };
  const contentToneStyle = isWhiteMode
    ? undefined
    : {
        background: `linear-gradient(180deg, rgba(3,7,18,0) 0%, ${toRgba(accentColor, 0.05)} 100%)`,
      };
  const iconToolStyle = isWhiteMode
    ? undefined
    : {
        borderColor: toRgba(accentColor, 0.24),
        background: `linear-gradient(180deg, ${toRgba(accentColor, 0.12)}, rgba(9,16,29,0.78))`,
        color: '#f8fafc',
      };
  const textToolStyle = isWhiteMode
    ? undefined
    : {
        borderColor: toRgba(accentColor, 0.2),
        background: toRgba(accentColor, 0.08),
        color: '#e2e8f0',
      };
  const accentLabelStyle = isWhiteMode ? undefined : { color: accentColor };
  const primaryCtaStyle = isWhiteMode
    ? undefined
    : {
        backgroundImage: `linear-gradient(90deg, ${accentColor}, ${accentSecondary})`,
        boxShadow: `0 16px 30px ${toRgba(accentColor, 0.26)}`,
        color: '#020617',
      };

  const mediaBadges = [
    isSponsored
      ? {
          key: 'sponsored',
          icon: Megaphone,
          label: sponsoredLabel,
          tone: isWhiteMode
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-amber-400/40 bg-amber-500/15 text-amber-100',
        }
      : null,
    isDemoCatalog
      ? {
          key: 'demo',
          icon: BadgeCheck,
          label: 'Demo Catalog',
          tone: isWhiteMode
            ? 'border-sky-300 bg-sky-50 text-sky-700'
            : 'border-sky-400/40 bg-sky-500/15 text-sky-100',
        }
      : null,
  ].filter(Boolean);

  if (variant === 'list') {
    return (
      <Link
        to={productPath}
        onClick={trackSearchSelection}
        onMouseEnter={prefetchProduct}
        onFocus={prefetchProduct}
        className={cn(
          'group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border transition-all duration-500 md:flex-row',
          surfaceClass
        )}
        style={cardSurfaceStyle}
      >
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
          <div className={cn(
            'absolute inset-0',
            isWhiteMode
              ? 'bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,0.12),transparent_45%)]'
              : 'bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.14),transparent_45%)]'
          )} />
        </div>

        <div className={cn(
          'relative aspect-[4/3] overflow-hidden border-b p-6 md:w-[19rem] md:flex-shrink-0 md:border-b-0 md:border-r',
          mediaClass
        )} style={cardMediaStyle}>
          <div className="absolute left-4 top-4 z-20 flex max-w-[75%] flex-wrap gap-2">
            {mediaBadges.map((badge) => (
              <StatusBadge
                key={badge.key}
                icon={badge.icon}
                label={badge.label}
                toneClass={badge.tone}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleWishlistClick}
            className={cn(
              'absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-300',
              isWhiteMode
                ? 'border-slate-300 bg-white/95 text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-500'
                : 'border-white/12 bg-zinc-950/72 text-slate-300 hover:border-neo-rose/55 hover:bg-neo-rose/12 hover:text-neo-rose'
            )}
            aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            <Heart className={cn('h-5 w-5', inWishlist && 'fill-current')} />
          </button>

          <div className="absolute inset-x-4 bottom-4 z-20 hidden items-center gap-2 sm:flex">
            {quickTools.map((tool) => (
              <IconToolButton
                key={tool.key}
                icon={tool.icon}
                label={tool.label}
                onClick={tool.onClick}
                toneClass={iconToolTone}
                style={iconToolStyle}
              />
            ))}
          </div>

          <img
            src={imageError ? FALLBACK_IMAGE : product.image || FALLBACK_IMAGE}
            alt={displayTitle}
            loading="lazy"
            className={cn(
              'h-full w-full object-contain transition-transform duration-700 group-hover:scale-[1.045]',
              isWhiteMode
                ? 'drop-shadow-[0_22px_35px_rgba(15,23,42,0.16)]'
                : 'drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)]'
            )}
            onError={(event) => {
              event.target.onerror = null;
              setImageError(true);
            }}
          />

          {isOutOfStock ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <span className="rounded-full border border-white/20 bg-zinc-950/85 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white">
                Sold Out
              </span>
            </div>
          ) : null}
        </div>

        <div className={cn(
          'relative flex flex-1 flex-col bg-gradient-to-b p-6 md:p-7',
          contentClass
        )} style={contentToneStyle}>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={cn(
                  'text-[11px] font-black uppercase tracking-[0.22em]',
                  isWhiteMode ? 'text-blue-700' : ''
                )} style={accentLabelStyle}>
                  {brandLabel}
                </span>
                {categoryLabel ? (
                  <span className={cn('text-[11px] uppercase tracking-[0.18em]', subtleTextClass)}>
                    {categoryLabel}
                  </span>
                ) : null}
              </div>

              <h3 className={cn(
                'max-w-3xl text-2xl font-black tracking-tight md:text-[2rem]',
                isWhiteMode ? 'text-slate-950' : 'text-white'
              )}>
                {displayTitle}
              </h3>

              {(subtitle || primaryStory) ? (
                <p className={cn('mt-3 max-w-3xl text-sm leading-6', mutedTextClass)}>
                  {primaryStory || subtitle}
                </p>
              ) : null}
            </div>

            <div className={cn(
              'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold',
              isWhiteMode
                ? 'border-slate-300 bg-white text-slate-800'
                : 'border-white/12 bg-white/5 text-slate-100'
            )}>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2 py-1 text-[11px] font-black text-zinc-950">
                {ratingValue}
                <Star className="h-3 w-3 fill-current" />
              </span>
              <span className={subtleTextClass}>
                {ratingCount.toLocaleString()} reviews
              </span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
            <span className={cn(
              'text-4xl font-black tracking-tight',
              isWhiteMode ? 'text-slate-950' : 'text-white'
            )}>
              {formatPrice(priceValue)}
            </span>
            {hasOriginalPrice ? (
              <span className={cn('pb-1 text-sm line-through', subtleTextClass)}>
                {formatPrice(originalPrice)}
              </span>
            ) : null}
            {discountValue > 0 ? (
              <span className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em]',
                isWhiteMode
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-neo-emerald/30 bg-neo-emerald/12 text-neo-emerald'
              )}>
                {Math.round(discountValue)}% off
              </span>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium',
              isWhiteMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-white/12 bg-white/5 text-slate-200'
            )}>
              {deliveryLabel}
            </span>
            <span className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium',
              isOutOfStock
                ? 'border-rose-400/35 bg-rose-500/12 text-rose-200'
                : isWhiteMode
                  ? 'border-slate-300 bg-slate-100 text-slate-700'
                  : 'border-white/12 bg-white/5 text-slate-200'
            )}>
              {isOutOfStock ? 'Unavailable' : `${stockCount} in stock`}
            </span>
          </div>

          {secondaryStory.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {secondaryStory.map((story) => (
                <span
                  key={story}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[11px] font-medium',
                    isWhiteMode
                      ? 'border-slate-300/80 bg-white text-slate-600'
                      : 'border-white/10 bg-white/[0.04] text-slate-300'
                  )}
                >
                  {story}
                </span>
              ))}
            </div>
          ) : null}

          {dealDna ? (
            <div className={cn('mt-5 rounded-[1.25rem] border p-4', dealTheme.surface)}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em]">Deal DNA</p>
                  <p className="mt-1 text-sm font-semibold">{dealTheme.label}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black leading-none">{dealDna.score}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">Score</p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="hidden flex-wrap gap-2 sm:flex">
              {quickTools.map((tool) => (
                <TextToolButton
                  key={tool.key}
                  icon={tool.icon}
                  label={tool.label}
                  onClick={tool.onClick}
                  toneClass={textToolTone}
                  style={textToolStyle}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={isOutOfStock}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] transition-all duration-300 xl:w-auto',
                isWhiteMode
                  ? 'bg-slate-950 text-white shadow-[0_16px_26px_rgba(15,23,42,0.24)] hover:bg-blue-700 disabled:bg-slate-300'
                  : 'hover:translate-y-[-1px] disabled:bg-slate-700 disabled:text-slate-300'
              )}
              style={primaryCtaStyle}
            >
              <ShoppingCart className="h-4 w-4" />
              {isOutOfStock ? 'Unavailable' : 'Add to Bag'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={productPath}
      onClick={trackSearchSelection}
      onMouseEnter={prefetchProduct}
      onFocus={prefetchProduct}
      className={cn(
        'group card-product relative flex h-full flex-col overflow-hidden rounded-[1.6rem] border transition-all duration-500',
        surfaceClass
      )}
      style={cardSurfaceStyle}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        <div className={cn(
          'absolute inset-0',
          isWhiteMode
            ? 'bg-[radial-gradient(circle_at_top,rgba(96,165,250,0.11),transparent_44%)]'
            : 'bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.12),transparent_44%)]'
        )} />
      </div>

      <div className={cn(
        'relative aspect-[4/3.15] overflow-hidden border-b p-4 sm:aspect-[4/3.25]',
        mediaClass
      )} style={cardMediaStyle}>
        <div className="absolute left-4 top-4 z-20 flex max-w-[70%] flex-wrap gap-2">
          {mediaBadges.map((badge) => (
            <StatusBadge
              key={badge.key}
              icon={badge.icon}
              label={badge.label}
              toneClass={badge.tone}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={handleWishlistClick}
          className={cn(
            'absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-300',
            isWhiteMode
              ? 'border-slate-300 bg-white/95 text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-500'
              : 'border-white/12 bg-zinc-950/72 text-slate-300 hover:border-neo-rose/55 hover:bg-neo-rose/12 hover:text-neo-rose'
          )}
          aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <Heart className={cn('h-[18px] w-[18px]', inWishlist && 'fill-current')} />
        </button>

        <img
          src={imageError ? FALLBACK_IMAGE : product.image || FALLBACK_IMAGE}
          alt={displayTitle}
          loading="lazy"
          className={cn(
            'h-full w-full object-contain transition-transform duration-700 group-hover:scale-[1.045]',
            isWhiteMode
              ? 'drop-shadow-[0_18px_30px_rgba(15,23,42,0.16)]'
              : 'drop-shadow-[0_16px_26px_rgba(0,0,0,0.55)]'
          )}
          onError={(event) => {
            event.target.onerror = null;
            setImageError(true);
          }}
        />

        <div className="absolute inset-x-4 bottom-4 z-20 hidden items-center justify-center gap-2 transition-all duration-300 md:flex md:translate-y-3 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100">
          {quickTools.map((tool) => (
              <IconToolButton
                key={tool.key}
                icon={tool.icon}
                label={tool.label}
                onClick={tool.onClick}
                toneClass={iconToolTone}
                style={iconToolStyle}
              />
            ))}
          </div>

        {isOutOfStock ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <span className="rounded-full border border-white/20 bg-zinc-950/85 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white">
              Sold Out
            </span>
          </div>
        ) : null}
      </div>

      <div className={cn(
        'relative flex flex-1 flex-col bg-gradient-to-b p-4',
        contentClass
      )} style={contentToneStyle}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={cn(
            'text-[10px] font-black uppercase tracking-[0.22em]',
            isWhiteMode ? 'text-blue-700' : ''
          )} style={accentLabelStyle}>
            {brandLabel}
          </span>
          {categoryLabel ? (
            <span className={cn('text-[10px] uppercase tracking-[0.18em]', subtleTextClass)}>
              {categoryLabel}
            </span>
          ) : null}
        </div>

        <h3 className={cn(
          'line-clamp-3 text-[0.98rem] font-black leading-[1.28] tracking-tight sm:text-[1.04rem]',
          isWhiteMode ? 'text-slate-950' : 'text-white'
        )}>
          {displayTitle}
        </h3>

        {(subtitle || primaryStory) ? (
          <p className={cn('mt-2 line-clamp-2 text-sm leading-6', mutedTextClass)}>
            {primaryStory || subtitle}
          </p>
        ) : null}

        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className={cn(
                'text-2xl font-black tracking-tight',
                isWhiteMode ? 'text-slate-950' : 'text-white'
              )}>
                {formatPrice(priceValue)}
              </span>
              {hasOriginalPrice ? (
                <span className={cn('pb-1 text-xs line-through', subtleTextClass)}>
                  {formatPrice(originalPrice)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {discountValue > 0 ? (
                <span className={cn(
                  'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                  isWhiteMode
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-neo-emerald/30 bg-neo-emerald/12 text-neo-emerald'
                )}>
                  {Math.round(discountValue)}% off
                </span>
              ) : null}
              <span className={cn(
                'rounded-full border px-2.5 py-1 text-[10px] font-medium',
                isWhiteMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-white/12 bg-white/5 text-slate-200'
              )}>
                {deliveryLabel}
              </span>
            </div>
          </div>

          <div className={cn(
            'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-2 text-xs font-semibold',
            isWhiteMode
              ? 'border-slate-300 bg-white text-slate-800'
              : 'border-white/12 bg-white/5 text-slate-100'
          )}>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2 py-1 text-[10px] font-black text-zinc-950">
              {ratingValue}
              <Star className="h-3 w-3 fill-current" />
            </span>
            <span className={subtleTextClass}>{ratingCount.toLocaleString()}</span>
          </div>
        </div>

        {dealDna ? (
          <div className={cn('mt-3.5 rounded-[1.05rem] border p-3', dealTheme.surface)}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em]">Deal DNA</p>
                <p className="mt-1 text-sm font-semibold">{dealTheme.label}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black leading-none">{dealDna.score}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">Score</p>
              </div>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleAddToCart}
          disabled={isOutOfStock}
          className={cn(
            'mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.2em] transition-all duration-300',
            isWhiteMode
              ? 'bg-slate-950 text-white shadow-[0_16px_26px_rgba(15,23,42,0.22)] hover:bg-blue-700 disabled:bg-slate-300'
              : 'hover:translate-y-[-1px] disabled:bg-slate-700 disabled:text-slate-300'
          )}
          style={primaryCtaStyle}
        >
          <ShoppingCart className="h-4 w-4" />
          {isOutOfStock ? 'Unavailable' : 'Add to Bag'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Link>
  );
};

export default ProductCard;
