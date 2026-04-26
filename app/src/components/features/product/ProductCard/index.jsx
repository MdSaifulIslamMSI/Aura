import { useContext, useMemo, useRef, useState } from 'react';
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
import { useMarket } from '@/context/MarketContext';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { getLocalizedCategoryLabel } from '@/config/catalogTaxonomy';
import { FIGMA_COLOR_MODE_OPTIONS } from '@/config/figmaTokens';
import { cn } from '@/lib/utils';
import { getBaseAmount, getBaseCurrency, getOriginalBaseAmount } from '@/utils/pricing';
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
      'flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300',
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

const ProductCard = ({ product, variant = 'default', gridLayout = null, harmonyIndex = null }) => {
  const { toggleWishlist, isInWishlist } = useContext(WishlistContext);
  const { addToCart } = useContext(CartContext);
  const { colorMode } = useColorMode();
  const { t, formatNumber, formatPrice } = useMarket();
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);
  const hasPrefetchedRef = useRef(false);

  const isWhiteMode = colorMode === 'white';
  const modePalette = FIGMA_COLOR_MODE_OPTIONS.find((mode) => mode.value === colorMode) || FIGMA_COLOR_MODE_OPTIONS[0];
  const dealDna = product?.dealDna || null;
  const dealTheme = resolveDealTheme(dealDna);
  const localizedDealLabel = dealDna?.verdict === 'good_deal'
    ? t('product.goodDeal', {}, dealTheme.label)
    : dealDna?.verdict === 'avoid'
      ? t('product.skipNow', {}, dealTheme.label)
      : dealDna?.verdict === 'wait'
        ? t('product.watchPrice', {}, dealTheme.label)
        : t('product.reviewSignal', {}, dealTheme.label);
  const isSponsored = Boolean(product?.adMeta?.isSponsored || product?.adCampaign?.isSponsored);
  const sponsoredLabel = product?.adMeta?.label || t('product.sponsored', {}, 'Sponsored');
  const sponsoredTagline = product?.adCampaign?.creativeTagline || '';
  const productId = product?.id || product?._id || '';
  const productPath = productId ? `/product/${productId}` : '/products';
  const displayTitle = product?.displayTitle || product?.title || '';
  const subtitle = product?.subtitle || '';
  const categoryLabel = product?.category ? getLocalizedCategoryLabel(product.category, t) : '';
  const brandLabel = product?.brand || 'Aura';
  const searchTelemetry = product?.searchTelemetry || null;
  const inWishlist = productId ? isInWishlist(productId) : false;
  const ratingValue = formatRating(product?.rating);
  const ratingCount = Number(product?.ratingCount || 0);
  const priceValue = getBaseAmount(product);
  const priceCurrency = getBaseCurrency(product);
  const originalPrice = getOriginalBaseAmount(product);
  const hasOriginalPrice = Number.isFinite(originalPrice) && originalPrice > priceValue;
  const discountValue = Math.max(0, Number(product?.discountPercentage || 0));
  const stockCount = Number(product?.stock || 0);
  const isOutOfStock = stockCount <= 0;
  const deliveryLabel = product?.deliveryTime || t('product.fastDispatch', {}, 'Fast dispatch');
  const primaryStory = sponsoredTagline || (product?.highlights || []).find(Boolean) || '';
  const secondaryStory = (product?.highlights || [])
    .filter(Boolean)
    .filter((story) => story !== primaryStory)
    .slice(0, 2);
  const cardDynamicTexts = useMemo(() => ([
    displayTitle,
    subtitle,
    sponsoredLabel,
    deliveryLabel,
    primaryStory,
    ...secondaryStory,
  ]), [deliveryLabel, displayTitle, primaryStory, secondaryStory, sponsoredLabel, subtitle]);
  const { translateText: translateCardText } = useDynamicTranslations(cardDynamicTexts);
  const translatedDisplayTitle = translateCardText(displayTitle) || displayTitle;
  const translatedSubtitle = translateCardText(subtitle) || subtitle;
  const translatedSponsoredLabel = translateCardText(sponsoredLabel) || sponsoredLabel;
  const translatedDeliveryLabel = translateCardText(deliveryLabel) || deliveryLabel;
  const translatedPrimaryStory = translateCardText(primaryStory) || primaryStory;
  const translatedSecondaryStory = useMemo(
    () => secondaryStory.map((story) => translateCardText(story) || story),
    [secondaryStory, translateCardText]
  );
  const useSecondaryLead = harmonyIndex !== null && harmonyIndex % 2 === 1;
  const accentColor = useSecondaryLead ? modePalette.secondary : modePalette.primary;
  const accentSecondary = useSecondaryLead ? modePalette.primary : modePalette.secondary;
  const accentTertiary = modePalette.tertiary || modePalette.secondary;
  const isDramaticCard = !isWhiteMode && variant !== 'list' && harmonyIndex !== null && harmonyIndex % 5 === 2;
  const wishlistButtonClass = cn(
    'aura-commerce-card__wishlist-button',
    inWishlist && 'aura-commerce-card__wishlist-button--active',
    isDramaticCard && 'aura-commerce-card__wishlist-button--dramatic'
  );

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
    const budget = Math.max(5000, Math.min(200000, Math.round((priceValue || 15000) * 2.5)));
    navigate(`/bundles?theme=${encodeURIComponent(theme)}&budget=${budget}`);
  };

  const iconToolTone = isWhiteMode
    ? 'border-slate-300/90 bg-white/92 text-slate-700 hover:border-blue-400 hover:text-blue-700 hover:-translate-y-0.5'
    : 'hover:-translate-y-0.5';

  const textToolTone = isWhiteMode
    ? 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-700'
    : '';
  const wishlistToggleLabel = inWishlist
    ? t('product.removeFromWishlist', {}, 'Remove from wishlist')
    : t('product.addToWishlist', {}, 'Add to wishlist');

  const quickTools = [
    { key: 'compare', label: t('product.compare', {}, 'Compare'), icon: Brain, onClick: handleOpenCompare },
    { key: 'visual', label: t('nav.visualSearch', {}, 'Visual Search'), icon: Camera, onClick: handleOpenVisualSearch },
    { key: 'deal-dna', label: t('product.dealDna', {}, 'Deal DNA'), icon: BadgeCheck, onClick: handleOpenDealDna },
    { key: 'bundle', label: t('product.bundleAi', {}, 'Bundle AI'), icon: Clock3, onClick: handleOpenSmartBundle },
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
  const cardTokenStyle = {
    '--aura-card-primary': accentColor,
    '--aura-card-secondary': accentSecondary,
    '--aura-card-tertiary': accentTertiary,
  };
  const cardSurfaceStyle = isWhiteMode
    ? {
        ...cardTokenStyle,
        background: `linear-gradient(145deg, ${toRgba(accentColor, 0.12)} 0%, ${toRgba(accentSecondary, 0.08)} 42%, rgba(255,255,255,0.94) 100%), linear-gradient(180deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))`,
        borderColor: toRgba(accentColor, 0.18),
        boxShadow: `0 22px 52px rgba(15,23,42,0.1), 0 0 0 1px ${toRgba(accentColor, 0.08)}`,
      }
    : {
        ...cardTokenStyle,
        background: `linear-gradient(145deg, ${toRgba(accentColor, 0.16)} 0%, ${toRgba(accentSecondary, 0.08)} 38%, ${toRgba(accentTertiary, 0.06)} 68%), linear-gradient(180deg, rgb(var(--theme-surface-rgb) / 0.96) 0%, rgb(var(--theme-surface-strong-rgb) / 0.98) 100%)`,
        borderColor: toRgba(accentColor, 0.26),
        boxShadow: `0 20px 46px rgb(var(--theme-surface-strong-rgb) / 0.36), 0 0 0 1px ${toRgba(accentColor, 0.08)}`,
      };
  const cardMediaStyle = isWhiteMode
    ? {
        background: `linear-gradient(135deg, rgba(255,255,255,0.98), ${toRgba(accentColor, 0.1)} 48%, ${toRgba(accentSecondary, 0.12)} 100%)`,
        borderColor: toRgba(accentColor, 0.12),
      }
    : {
        background: `linear-gradient(135deg, rgba(250,246,235,0.98), ${toRgba(accentColor, 0.16)} 43%, ${toRgba(accentSecondary, 0.24)} 100%), linear-gradient(180deg, rgba(255,255,255,0.94), rgba(203,213,225,0.82))`,
        borderColor: toRgba(accentColor, 0.24),
      };
  const contentToneStyle = {
    background: isWhiteMode
      ? `linear-gradient(180deg, rgba(255,255,255,0.52) 0%, ${toRgba(accentColor, 0.05)} 68%, rgba(241,245,249,0.8) 100%)`
      : `linear-gradient(180deg, rgba(255,255,255,0.026) 0%, ${toRgba(accentColor, 0.06)} 60%, ${toRgba(accentSecondary, 0.035)} 100%)`,
  };
  const iconToolStyle = {
    borderColor: toRgba(accentColor, isWhiteMode ? 0.18 : 0.26),
    background: isWhiteMode
      ? `linear-gradient(180deg, rgba(255,255,255,0.94), ${toRgba(accentColor, 0.08)})`
      : `linear-gradient(180deg, ${toRgba(accentColor, 0.14)}, rgb(var(--theme-surface-strong-rgb) / 0.84))`,
    color: isWhiteMode ? '#0f172a' : '#f8fafc',
  };
  const textToolStyle = {
    borderColor: toRgba(accentColor, isWhiteMode ? 0.16 : 0.22),
    background: toRgba(accentColor, isWhiteMode ? 0.06 : 0.09),
    color: isWhiteMode ? '#0f172a' : '#e2e8f0',
  };
  const accentLabelStyle = isWhiteMode ? undefined : { color: accentColor };
  const needsLightCtaText = ['white', 'violet', 'ruby', 'midnight'].includes(colorMode);
  const primaryCtaStyle = {
    backgroundImage: `linear-gradient(90deg, ${accentColor}, ${accentSecondary})`,
    boxShadow: `0 16px 30px ${toRgba(accentColor, 0.26)}`,
    color: needsLightCtaText ? '#ffffff' : '#020617',
  };

  const mediaBadges = [
    isSponsored
      ? {
          key: 'sponsored',
          icon: Megaphone,
          label: translatedSponsoredLabel,
          tone: isWhiteMode
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-amber-400/40 bg-amber-500/15 text-amber-100',
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
          'group aura-commerce-card relative flex h-full flex-col overflow-hidden rounded-[1.45rem] border transition-all duration-500 md:flex-row premium-card-hover',
          surfaceClass
        )}
        style={cardSurfaceStyle}
        data-testid="product-card"
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
          'aura-commerce-card__media relative aspect-[4/3] overflow-hidden border-b p-6 md:w-[19rem] md:flex-shrink-0 md:border-b-0 md:border-r group-hover:glass-shimmer',
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
            className={wishlistButtonClass}
            aria-label={wishlistToggleLabel}
          >
            <Heart className={cn('h-5 w-5', inWishlist && 'fill-current')} />
          </button>

          <div className="aura-commerce-card__quick-tools absolute inset-x-4 bottom-4 z-20 hidden items-center gap-2 sm:flex">
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
            alt={translatedDisplayTitle}
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
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
            <span className="rounded-full border border-white/20 bg-zinc-950/85 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white">
                {t('product.soldOut', {}, 'Sold Out')}
              </span>
            </div>
          ) : null}
        </div>

        <div className={cn(
          'aura-commerce-card__content relative flex flex-1 flex-col bg-gradient-to-b p-6 md:p-7',
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
                {translatedDisplayTitle}
              </h3>

              {(translatedSubtitle || translatedPrimaryStory) ? (
                <p className={cn('mt-3 max-w-3xl text-sm leading-6', mutedTextClass)}>
                  {translatedPrimaryStory || translatedSubtitle}
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
                {formatNumber(ratingCount)} {t('product.reviews', {}, 'reviews')}
              </span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
              <span className={cn(
                'text-4xl font-black tracking-tight',
                isWhiteMode ? 'text-slate-950' : 'text-white'
              )}>
              {formatPrice(priceValue, undefined, undefined, { baseCurrency: priceCurrency })}
            </span>
            {hasOriginalPrice ? (
              <span className={cn('pb-1 text-sm line-through', subtleTextClass)}>
                {formatPrice(originalPrice, undefined, undefined, { baseCurrency: priceCurrency })}
              </span>
            ) : null}
            {discountValue > 0 ? (
              <span className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em]',
                isWhiteMode
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-neo-emerald/30 bg-neo-emerald/12 text-neo-emerald'
              )}>
                {Math.round(discountValue)}{t('product.off', {}, '% off')}
              </span>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium',
              isWhiteMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-white/12 bg-white/5 text-slate-200'
            )}>
              {translatedDeliveryLabel}
            </span>
            <span className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium',
              isOutOfStock
                ? 'border-rose-400/35 bg-rose-500/12 text-rose-200'
                : isWhiteMode
                  ? 'border-slate-300 bg-slate-100 text-slate-700'
                  : 'border-white/12 bg-white/5 text-slate-200'
            )}>
              {isOutOfStock ? t('product.unavailable', {}, 'Unavailable') : t('product.inStock', { count: formatNumber(stockCount) }, `${formatNumber(stockCount)} in stock`)}
            </span>
          </div>

          {translatedSecondaryStory.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {translatedSecondaryStory.map((story) => (
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
                  <p className="text-[10px] font-black uppercase tracking-[0.2em]">{t('product.dealDna', {}, 'Deal DNA')}</p>
                  <p className="mt-1 text-sm font-semibold">{localizedDealLabel}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black leading-none">{dealDna.score}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">{t('product.score', {}, 'Score')}</p>
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
                'inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] transition-all duration-300 xl:w-auto active:scale-95',
                isWhiteMode
                  ? 'bg-slate-950 text-white shadow-[0_16px_26px_rgba(15,23,42,0.24)] hover:bg-blue-700 disabled:bg-slate-300'
                  : 'hover:translate-y-[-1px] disabled:bg-slate-700 disabled:text-slate-300'
              )}
              style={primaryCtaStyle}
            >
              <ShoppingCart className="h-4 w-4" />
              {isOutOfStock ? t('product.unavailable', {}, 'Unavailable') : t('product.addToBag', {}, 'Add to Bag')}
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
        'group card-product aura-commerce-card premium-card-hover relative flex h-full flex-col overflow-hidden rounded-[1.35rem] border transition-all duration-500',
        surfaceClass,
        isDramaticCard && 'aura-commerce-card--dramatic'
      )}
      style={{
        ...cardSurfaceStyle,
        ...(gridLayout ? {
          gridColumn: `span ${gridLayout.spanX}`,
          gridRow: `span ${gridLayout.spanY}`,
          height: '100%'
        } : {})
      }}
      data-testid="product-card"
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
        'aura-commerce-card__media relative aspect-[4/3] overflow-hidden border-b p-4 sm:aspect-[4/3.05] group-hover:glass-shimmer',
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
          className={wishlistButtonClass}
          aria-label={wishlistToggleLabel}
        >
          <Heart className={cn('h-[18px] w-[18px]', inWishlist && 'fill-current')} />
        </button>

        <div className="aura-commerce-card__image-stage">
          <img
            src={imageError ? FALLBACK_IMAGE : product.image || FALLBACK_IMAGE}
            alt={translatedDisplayTitle}
            loading="lazy"
            className="aura-commerce-card__image h-full w-full object-contain transition-transform duration-700"
            onError={(event) => {
              event.target.onerror = null;
              setImageError(true);
            }}
          />
        </div>

        <div className="aura-commerce-card__quick-tools absolute inset-x-4 bottom-4 z-20 hidden items-center justify-center gap-2 transition-all duration-300 md:flex md:translate-y-3 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100">
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
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
            <span className="rounded-full border border-white/20 bg-zinc-950/85 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white">
              {t('product.soldOut', {}, 'Sold Out')}
            </span>
          </div>
        ) : null}
      </div>

      <div className={cn(
        'aura-commerce-card__content relative flex flex-1 flex-col bg-gradient-to-b p-4',
        contentClass
      )} style={contentToneStyle}>
        <div className="aura-commerce-card__meta mb-2 flex flex-wrap items-center gap-2">
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
          'aura-commerce-card__title line-clamp-2 text-[0.9rem] font-black leading-[1.18] tracking-tight sm:text-[0.96rem]',
          isWhiteMode ? 'text-slate-950' : 'text-white'
        )}>
          {translatedDisplayTitle}
        </h3>

        {(translatedSubtitle || translatedPrimaryStory) ? (
          <p className={cn('aura-commerce-card__story mt-1.5 line-clamp-1 text-[12px] leading-5', mutedTextClass)}>
            {translatedPrimaryStory || translatedSubtitle}
          </p>
        ) : null}

        <div className="aura-commerce-card__rating-row mt-2.5 flex flex-wrap items-center gap-2">
          <div className={cn(
            'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold',
            isWhiteMode
              ? 'border-slate-300 bg-white text-slate-800'
              : 'border-white/12 bg-white/5 text-slate-100'
          )}>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2 py-1 text-[10px] font-black text-zinc-950">
              {ratingValue}
              <Star className="h-3 w-3 fill-current" />
            </span>
            <span className={cn('text-[10px]', subtleTextClass)}>{formatNumber(ratingCount)}</span>
          </div>
        </div>

        <div className="aura-commerce-card__price-row mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className={cn(
            'aura-commerce-card__price text-[1.48rem] font-black tracking-tight sm:text-[1.62rem]',
            isWhiteMode ? 'text-slate-950' : 'text-white'
          )}>
            {formatPrice(priceValue, undefined, undefined, { baseCurrency: priceCurrency })}
          </span>
          {hasOriginalPrice ? (
            <span className={cn('aura-commerce-card__original-price pb-1 text-xs line-through', subtleTextClass)}>
              {formatPrice(originalPrice, undefined, undefined, { baseCurrency: priceCurrency })}
            </span>
          ) : null}
        </div>

        <div className="aura-commerce-card__chips mt-2 flex flex-wrap gap-2">
          {discountValue > 0 ? (
            <span className={cn(
              'aura-commerce-card__chip rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
              isWhiteMode
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-neo-emerald/30 bg-neo-emerald/12 text-neo-emerald'
            )}>
              {Math.round(discountValue)}{t('product.off', {}, '% off')}
            </span>
          ) : null}
          <span className={cn(
            'aura-commerce-card__chip rounded-full border px-2.5 py-1 text-[10px] font-medium',
            isWhiteMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-white/12 bg-white/5 text-slate-200'
          )}>
            {translatedDeliveryLabel}
          </span>
        </div>

        {dealDna ? (
          <div className={cn('aura-commerce-card__deal mt-3 rounded-[1rem] border px-3 py-2.5', dealTheme.surface)}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.22em]">{t('product.dealDna', {}, 'Deal DNA')}</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold">{localizedDealLabel}</p>
              </div>
              <div className="flex flex-shrink-0 items-baseline gap-1">
                <p className="text-lg font-black leading-none">{dealDna.score}</p>
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] opacity-80">{t('product.score', {}, 'Score')}</p>
              </div>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleAddToCart}
          disabled={isOutOfStock}
          className={cn(
            'aura-commerce-card__cta mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] transition-all duration-300 active:scale-95',
            isWhiteMode
              ? 'bg-slate-950 text-white shadow-[0_16px_26px_rgba(15,23,42,0.22)] hover:bg-blue-700 disabled:bg-slate-300'
              : 'hover:translate-y-[-1px] disabled:bg-slate-700 disabled:text-slate-300'
          )}
          style={primaryCtaStyle}
        >
          <ShoppingCart className="h-4 w-4" />
          {isOutOfStock ? t('product.unavailable', {}, 'Unavailable') : t('product.addToBag', {}, 'Add to Bag')}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </Link>
  );
};

export default ProductCard;
