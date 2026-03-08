import { useContext, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, Brain, Camera, Clock3, Heart, Megaphone, ShoppingCart, Star, Zap } from 'lucide-react';
import { WishlistContext } from '@/context/WishlistContext';
import { CartContext } from '@/context/CartContext';
import { useColorMode } from '@/context/ColorModeContext';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';
import { productApi } from '@/services/api';

const ProductCard = ({ product, variant = 'default' }) => {
  const { toggleWishlist, isInWishlist } = useContext(WishlistContext);
  const { addToCart } = useContext(CartContext);
  const { colorMode } = useColorMode();
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);
  const isWhiteMode = colorMode === 'white';
  const dealDna = product?.dealDna || null;
  const isSponsored = Boolean(product?.adMeta?.isSponsored || product?.adCampaign?.isSponsored);
  const sponsoredLabel = product?.adMeta?.label || 'Sponsored';
  const sponsoredTagline = product?.adCampaign?.creativeTagline || '';
  const productId = product?.id || product?._id || '';
  const displayTitle = product?.displayTitle || product?.title || '';
  const subtitle = product?.subtitle || '';
  const categoryLabel = product?.category || '';
  const hasPrefetchedRef = useRef(false);
  const searchTelemetry = product?.searchTelemetry || null;
  const isDemoCatalog = product?.publishGate?.status === 'dev_only' || product?.provenance?.sourceType === 'dev_seed';

  const inWishlist = isInWishlist(productId);

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

  const handleWishlistClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(product);
  };

  const handleAddToCart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart(product, 1);
  };

  const handleOpenCompare = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!product?.id && !product?._id) return;
    const id = product.id || product._id;
    navigate(`/compare?ids=${encodeURIComponent(String(id))}`);
  };

  const handleOpenVisualSearch = (e) => {
    e.preventDefault();
    e.stopPropagation();
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

  const handleOpenDealDna = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!product?.id && !product?._id) return;
    const id = product.id || product._id;
    navigate(`/product/${id}?panel=deal-dna`);
  };

  const handleOpenSmartBundle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const theme = `${product?.category || product?.brand || 'smart essentials'}`.toLowerCase();
    const budget = Math.max(5000, Math.min(200000, Math.round((Number(product?.price) || 15000) * 2.5)));
    navigate(`/bundles?theme=${encodeURIComponent(theme)}&budget=${budget}`);
  };

  const dealTone = dealDna?.verdict === 'good_deal'
    ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-100'
    : dealDna?.verdict === 'avoid'
      ? 'border-rose-400/45 bg-rose-500/15 text-rose-100'
      : 'border-amber-400/45 bg-amber-500/15 text-amber-100';

  const dealLabel = dealDna?.verdict === 'good_deal'
    ? 'Good Deal'
    : dealDna?.verdict === 'avoid'
      ? 'Avoid'
      : dealDna?.verdict === 'wait'
        ? 'Wait'
        : 'Review';

  if (variant === 'list') {
    return (
      <Link
        to={`/product/${productId}`}
        onClick={trackSearchSelection}
        onMouseEnter={prefetchProduct}
        onFocus={prefetchProduct}
        className={cn(
          'flex flex-col md:flex-row gap-6 backdrop-blur-xl p-4 md:p-6 rounded-2xl border shadow-glass transition-all duration-500 group relative overflow-hidden',
          isWhiteMode
            ? 'bg-white/95 border-slate-200 hover:border-blue-300 hover:shadow-[0_16px_32px_rgba(15,23,42,0.18)]'
            : 'bg-white/5 border-white/5 hover:shadow-neon-cyan/20 hover:border-neo-cyan/30'
        )}
      >
        <div className={cn(
          'absolute top-0 right-0 w-32 h-32 rounded-full blur-[50px] pointer-events-none transition-colors duration-500',
          isWhiteMode ? 'bg-blue-500/10 group-hover:bg-blue-500/15' : 'bg-neo-cyan/5 group-hover:bg-neo-cyan/10'
        )} />

        {/* Image */}
        <div className={cn(
          'relative w-full h-48 md:w-56 md:h-56 flex-shrink-0 rounded-xl p-4 flex items-center justify-center border overflow-hidden',
          isWhiteMode ? 'bg-white border-slate-200' : 'bg-white/5 border-white/5'
        )}>
          <div className={cn(
            'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500',
            isWhiteMode ? 'bg-gradient-to-tr from-transparent to-blue-100/45' : 'bg-gradient-to-tr from-transparent to-white/5'
          )} />
          <img
            src={imageError ? 'https://placehold.co/400x400/18181b/4ade80?text=Aura+Select' : product.image}
            alt={displayTitle || product.title}
            className={cn(
              'w-full h-full object-contain group-hover:scale-110 transition-transform duration-700',
              isWhiteMode
                ? 'mix-blend-normal drop-shadow-[0_12px_20px_rgba(15,23,42,0.12)]'
                : 'mix-blend-screen drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]'
            )}
            loading="lazy"
            onError={(e) => {
              e.target.onerror = null;
              setImageError(true);
            }}
          />
          <button
            onClick={handleWishlistClick}
            className={cn(
              'absolute top-3 right-3 p-2.5 rounded-full backdrop-blur-md border shadow-glass transition-all opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 duration-300',
              isWhiteMode
                ? 'bg-white/95 border-slate-300 hover:border-rose-300 hover:bg-rose-50'
                : 'bg-zinc-950/50 border-white/10 hover:border-neo-rose hover:bg-neo-rose/10'
            )}
            aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            <Heart
              className={cn(
                'w-5 h-5 transition-colors',
                inWishlist
                  ? 'fill-neo-rose text-neo-rose drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                  : isWhiteMode
                    ? 'text-slate-500 group-hover:text-rose-500'
                    : 'text-slate-400 group-hover:text-neo-rose'
              )}
            />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col z-10">
          <div className="flex justify-between items-start gap-4 mb-2">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-neo-cyan mb-1">{product.brand}</p>
              <h3 className={cn(
                'text-xl md:text-2xl font-black line-clamp-2 md:leading-tight transition-all duration-300',
                isWhiteMode
                  ? 'text-slate-900 group-hover:text-slate-950'
                  : 'text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-slate-400'
              )}>
                {displayTitle || product.title}
              </h3>
              {(subtitle || categoryLabel) && (
                <p className={cn(
                  'mt-2 max-w-xl text-xs font-medium tracking-[0.18em] uppercase',
                  isWhiteMode ? 'text-slate-500' : 'text-slate-400'
                )}>
                  {subtitle || categoryLabel}
                </p>
              )}
              {isSponsored && (
                <div className={cn(
                  'mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider',
                  isWhiteMode
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-amber-400/45 bg-amber-500/15 text-amber-100'
                )}>
                  <Megaphone className="w-3 h-3" />
                  {sponsoredLabel}
                </div>
              )}
              {isDemoCatalog && (
                <div className={cn(
                  'mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider',
                  isWhiteMode
                    ? 'border-sky-300 bg-sky-50 text-sky-700'
                    : 'border-sky-400/45 bg-sky-500/15 text-sky-100'
                )}>
                  <BadgeCheck className="w-3 h-3" />
                  Demo Catalog
                </div>
              )}
              {isSponsored && sponsoredTagline && (
                <p className={cn(
                  'mt-2 text-xs max-w-xl line-clamp-2',
                  isWhiteMode ? 'text-slate-600' : 'text-slate-300'
                )}>
                  {sponsoredTagline}
                </p>
              )}
              {dealDna && (
                <div className={cn('mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider', dealTone)}>
                  <BadgeCheck className="w-3 h-3" />
                  Deal DNA {dealDna.score} | {dealLabel}
                </div>
              )}
            </div>

            {/* Rating */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="rating-badge flex items-center gap-1 group-hover:shadow-[0_0_15px_rgba(250,204,21,0.6)] transition-shadow duration-300">
                {product.rating || 0}
                <Star className="w-3 h-3 fill-zinc-950" />
              </span>
              <span className="text-xs text-slate-500 font-medium tracking-wide">
                ({(product.ratingCount || 0).toLocaleString()})
              </span>
            </div>
          </div>

          {/* Price */}
          <div className="flex items-end gap-3 mb-4 mt-2">
            <span className={cn(
              'text-3xl font-black tracking-tighter',
              isWhiteMode ? 'text-slate-900' : 'text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]'
            )}>{formatPrice(product.price)}</span>
            <span className="text-slate-500 line-through text-sm font-medium mb-1">{formatPrice(product.originalPrice)}</span>
              <span className="bg-neo-cyan/10 border border-neo-cyan/20 text-neo-cyan px-2 py-0.5 rounded text-xs font-black uppercase tracking-wider mb-1 flex items-center gap-1 shadow-[0_0_10px_rgba(6,182,212,0.1)]">
                <Zap className="w-3 h-3 fill-neo-cyan" />
                {product.discountPercentage}% off
              </span>
          </div>

          {/* Highlights */}
          <ul className={cn(
            'hidden md:flex flex-col gap-2 text-sm mb-6 p-4 rounded-xl border',
            isWhiteMode ? 'text-slate-700 bg-slate-100 border-slate-200' : 'text-slate-300 bg-white/5 border-white/5'
          )}>
            {(product.highlights || []).slice(0, 3).map((highlight, index) => (
              <li key={index} className="flex items-start gap-2 max-w-xl">
                <div className="w-1.5 h-1.5 mt-1.5 bg-neo-cyan rounded-full shadow-[0_0_5px_rgba(6,182,212,0.8)] flex-shrink-0" />
                <span className="leading-relaxed">{highlight}</span>
              </li>
            ))}
          </ul>

          {/* Actions */}
          <div className="mt-auto flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleAddToCart}
              className={cn(
                'flex items-center justify-center gap-2 group/btn relative overflow-hidden rounded-xl px-6 py-3 font-bold transition-all',
                isWhiteMode
                  ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-[0_8px_18px_rgba(37,99,235,0.35)] hover:-translate-y-0.5'
                  : 'btn-primary'
              )}
              disabled={product.stock === 0}
            >
              <ShoppingCart className="w-5 h-5 group-hover/btn:-translate-x-1 group-hover/btn:scale-110 transition-transform duration-300" />
              <span className="relative z-10 group-hover/btn:translate-x-1 transition-transform duration-300 tracking-wide font-bold">Add to Cart</span>
            </button>
            <div className="flex gap-2">
              <button
                onClick={handleOpenCompare}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors',
                  isWhiteMode
                    ? 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:text-blue-700'
                    : 'border-white/15 bg-white/5 text-slate-200 hover:border-neo-cyan/45 hover:text-neo-cyan'
                )}
              >
                <Brain className="w-4 h-4" />
                Compare
              </button>
              <button
                onClick={handleOpenVisualSearch}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors',
                  isWhiteMode
                    ? 'border-slate-300 bg-white text-slate-800 hover:border-emerald-400 hover:text-emerald-700'
                    : 'border-white/15 bg-white/5 text-slate-200 hover:border-neo-emerald/45 hover:text-neo-emerald'
                )}
              >
                <Camera className="w-4 h-4" />
                Visual
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleOpenDealDna}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors',
                  isWhiteMode
                    ? 'border-slate-300 bg-white text-slate-800 hover:border-emerald-400 hover:text-emerald-700'
                    : 'border-white/15 bg-white/5 text-slate-200 hover:border-emerald-400/45 hover:text-emerald-300'
                )}
              >
                <BadgeCheck className="w-4 h-4" />
                Deal DNA
              </button>
              <button
                onClick={handleOpenSmartBundle}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors',
                  isWhiteMode
                    ? 'border-slate-300 bg-white text-slate-800 hover:border-violet-400 hover:text-violet-700'
                    : 'border-white/15 bg-white/5 text-slate-200 hover:border-violet-400/45 hover:text-violet-300'
                )}
              >
                <Clock3 className="w-4 h-4" />
                Bundle AI
              </button>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // Default grid view
  return (
    <Link
      to={`/product/${productId}`}
      onClick={trackSearchSelection}
      onMouseEnter={prefetchProduct}
      onFocus={prefetchProduct}
      className={cn(
        'group card-product flex flex-col h-full backdrop-blur-xl rounded-2xl border overflow-hidden relative',
        isWhiteMode
          ? 'bg-white/95 border-slate-200 shadow-[0_10px_22px_rgba(15,23,42,0.12)] hover:border-blue-300'
          : 'bg-white/5 border-white/10'
      )}
    >
      <div className={cn(
        'absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10',
        isWhiteMode ? 'bg-gradient-to-b from-transparent to-blue-100/30' : 'bg-gradient-to-b from-transparent to-black/40'
      )} />

      {/* Image Container */}
      <div className={cn(
        'relative aspect-square p-6 flex items-center justify-center overflow-hidden border-b',
        isWhiteMode ? 'bg-white border-slate-200' : 'bg-white/5 border-white/5'
      )}>
        <div className={cn(
          'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500',
          isWhiteMode ? 'bg-gradient-to-br from-blue-100/40 to-transparent' : 'bg-gradient-to-br from-neo-cyan/5 to-transparent'
        )} />
        <img
          src={imageError ? 'https://placehold.co/400x400/18181b/4ade80?text=Aura+Select' : product.image}
          alt={displayTitle || product.title}
          className={cn(
            'w-full h-full object-contain group-hover:scale-110 transition-transform duration-700 relative z-0',
            isWhiteMode
              ? 'mix-blend-normal drop-shadow-[0_12px_20px_rgba(15,23,42,0.12)]'
              : 'drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] mix-blend-screen'
          )}
          loading="lazy"
          onError={(e) => {
            e.target.onerror = null;
            setImageError(true);
          }}
        />

        {/* Wishlist Button */}
        <button
          onClick={handleWishlistClick}
          className={cn(
            'absolute top-3 right-3 p-2 rounded-full backdrop-blur-md border shadow-glass opacity-0 group-hover:opacity-100 -translate-y-2 group-hover:translate-y-0 transition-all duration-300 z-20',
            isWhiteMode
              ? 'bg-white/95 border-slate-300 hover:border-rose-300 hover:bg-rose-50'
              : 'bg-zinc-950/50 border-white/10 hover:border-neo-rose hover:bg-neo-rose/10'
          )}
          aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <Heart
              className={cn(
                'w-5 h-5 transition-colors',
                inWishlist
                  ? 'fill-neo-rose text-neo-rose drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                  : isWhiteMode
                    ? 'text-slate-500 hover:text-rose-500'
                    : 'text-slate-400 hover:text-neo-rose'
              )}
            />
          </button>

        {/* Out of Stock Badge */}
        {product.stock === 0 && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30">
            <span className="bg-zinc-900 border border-white/20 text-white px-4 py-2 text-xs font-black uppercase tracking-widest rounded-full shadow-[0_0_20px_rgba(0,0,0,0.5)]">
              Currently Unavailable
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={cn(
        'flex-1 p-5 flex flex-col relative z-20 bg-gradient-to-b',
        isWhiteMode ? 'from-transparent to-slate-100' : 'from-transparent to-zinc-950'
      )}
      style={{ padding: 'var(--figma-card-padding)' }}>
        {/* Title */}
        <h3 className={cn(
          'text-sm font-bold line-clamp-2 mb-2 transition-colors duration-300 leading-relaxed',
          isWhiteMode ? 'text-slate-800 group-hover:text-slate-950' : 'text-slate-200 group-hover:text-white'
        )}
        style={{ fontSize: 'var(--figma-type-title-size)' }}>
          {displayTitle || product.title}
        </h3>
        {(subtitle || categoryLabel) && (
          <p className={cn(
            'mb-3 line-clamp-2 text-[11px] font-semibold uppercase tracking-[0.16em]',
            isWhiteMode ? 'text-slate-500' : 'text-slate-400'
          )}>
            {subtitle || categoryLabel}
          </p>
        )}
        {isSponsored && (
          <div className={cn(
            'mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider',
            isWhiteMode
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-amber-400/45 bg-amber-500/15 text-amber-100'
          )}>
            <Megaphone className="w-3 h-3" />
            {sponsoredLabel}
          </div>
        )}
        {isDemoCatalog && (
          <div className={cn(
            'mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider',
            isWhiteMode
              ? 'border-sky-300 bg-sky-50 text-sky-700'
              : 'border-sky-400/45 bg-sky-500/15 text-sky-100'
          )}>
            <BadgeCheck className="w-3 h-3" />
            Demo Catalog
          </div>
        )}
        {dealDna && (
          <div className={cn('mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider', dealTone)}>
            <BadgeCheck className="w-3 h-3" />
            DNA {dealDna.score} | {dealLabel}
          </div>
        )}

        {/* Rating */}
        <div className="flex items-center gap-2 mb-3">
          <span className="rating-badge group-hover:shadow-[0_0_10px_rgba(250,204,21,0.4)] transition-shadow duration-300">
            {product.rating || 0}
            <Star className="w-3 h-3 fill-zinc-950" />
          </span>
          <span className="text-xs text-slate-500 font-medium">
            ({(product.ratingCount || 0).toLocaleString()})
          </span>
        </div>

        {/* Price Area */}
        <div className="flex items-center gap-2 mb-2 flex-wrap mt-auto pt-2">
          <span className={cn('text-xl font-black tracking-tight', isWhiteMode ? 'text-slate-900' : 'text-white drop-shadow-md')}>{formatPrice(product.price)}</span>
          <span className="text-slate-500 line-through text-xs font-medium">{formatPrice(product.originalPrice)}</span>
        </div>

        <div className="flex justify-between items-center mb-3">
          <span className="text-neo-cyan text-xs font-black uppercase tracking-wider bg-neo-cyan/10 px-2 py-0.5 rounded border border-neo-cyan/20">
            {product.discountPercentage}% off
          </span>
          {/* Delivery */}
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider text-right">
            Speed: <span className={cn(isWhiteMode ? 'text-slate-700' : 'text-slate-200')}>{product.deliveryTime}</span>
          </p>
        </div>

        {/* Add to Cart Button */}
        <button
          onClick={handleAddToCart}
          className={cn(
            'w-full relative overflow-hidden font-bold py-2.5 text-xs uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all duration-300 group/btn mt-1',
            isWhiteMode
              ? 'bg-slate-100 hover:bg-blue-100 text-slate-900 border border-slate-300 hover:border-blue-400 shadow-[0_6px_14px_rgba(15,23,42,0.08)]'
              : 'bg-white/10 hover:bg-neo-cyan/20 text-white border border-white/10 hover:border-neo-cyan/50 shadow-glass'
          )}
          disabled={product.stock === 0}
        >
          <ShoppingCart className="w-4 h-4 group-hover/btn:-translate-x-1 transition-transform" />
          <span className="relative z-10">Add to Bag</span>
          <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan to-neo-emerald opacity-0 group-hover/btn:opacity-20 transition-opacity duration-300 pointer-events-none" />
        </button>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={handleOpenCompare}
            className={cn(
              'w-full rounded-lg border px-2.5 py-2 text-[11px] font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors',
              isWhiteMode
                ? 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:text-blue-700'
                : 'border-white/15 bg-white/5 text-slate-300 hover:border-neo-cyan/45 hover:text-neo-cyan'
            )}
          >
            <Brain className="w-3.5 h-3.5" />
            Compare
          </button>
          <button
            onClick={handleOpenVisualSearch}
            className={cn(
              'w-full rounded-lg border px-2.5 py-2 text-[11px] font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors',
              isWhiteMode
                ? 'border-slate-300 bg-white text-slate-800 hover:border-emerald-400 hover:text-emerald-700'
                : 'border-white/15 bg-white/5 text-slate-300 hover:border-neo-emerald/45 hover:text-neo-emerald'
            )}
          >
            <Camera className="w-3.5 h-3.5" />
            Visual
          </button>
          <button
            onClick={handleOpenDealDna}
            className={cn(
              'w-full rounded-lg border px-2.5 py-2 text-[11px] font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors',
              isWhiteMode
                ? 'border-slate-300 bg-white text-slate-800 hover:border-emerald-400 hover:text-emerald-700'
                : 'border-white/15 bg-white/5 text-slate-300 hover:border-emerald-400/45 hover:text-emerald-300'
            )}
          >
            <BadgeCheck className="w-3.5 h-3.5" />
            Deal DNA
          </button>
          <button
            onClick={handleOpenSmartBundle}
            className={cn(
              'w-full rounded-lg border px-2.5 py-2 text-[11px] font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors',
              isWhiteMode
                ? 'border-slate-300 bg-white text-slate-800 hover:border-violet-400 hover:text-violet-700'
                : 'border-white/15 bg-white/5 text-slate-300 hover:border-violet-400/45 hover:text-violet-300'
            )}
          >
            <Clock3 className="w-3.5 h-3.5" />
            Bundle AI
          </button>
        </div>
      </div>
    </Link>
  );
};

export default ProductCard;
