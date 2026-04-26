import { useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  Heart,
  LockKeyhole,
  Minus,
  PackageCheck,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
  Zap,
} from 'lucide-react';
import { CartContext } from '@/context/CartContext';
import { useMarket } from '@/context/MarketContext';
import { useCommerceStore } from '@/store/commerceStore';
import { convertAmount } from '@/utils/format';
import { BROWSE_BASE_CURRENCY } from '@/config/marketConfig';
import { getBaseCurrency, getLineBaseTotal, getLineOriginalBaseTotal } from '@/utils/pricing';

const getCartItemId = (item) => item?.id ?? item?._id;
const getItemQuantity = (item) => Math.max(1, Number(item?.quantity || 1));
const getItemStock = (item) => {
  const stock = Number(item?.stock);
  return Number.isFinite(stock) ? Math.max(0, stock) : 999;
};

const Cart = () => {
  const { cartItems, removeFromCart, updateQuantity, moveToWishlist, isLoading } = useContext(CartContext);
  const { t, formatPrice } = useMarket();
  const clearDirectBuy = useCommerceStore((state) => state.clearDirectBuy);
  const navigate = useNavigate();

  const cartUnitCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + getItemQuantity(item), 0),
    [cartItems],
  );
  const cartItemLabel = t(cartUnitCount === 1 ? 'cart.item' : 'cart.items', {}, cartUnitCount === 1 ? 'item' : 'items');
  const browseSummary = useMemo(() => cartItems.reduce((summary, item) => {
    const itemBaseCurrency = getBaseCurrency(item);
    const lineTotal = getLineBaseTotal(item);
    const lineOriginalTotal = Math.max(lineTotal, getLineOriginalBaseTotal(item));

    summary.totalPrice += convertAmount(lineTotal, itemBaseCurrency, BROWSE_BASE_CURRENCY);
    summary.totalOriginalPrice += convertAmount(lineOriginalTotal, itemBaseCurrency, BROWSE_BASE_CURRENCY);
    return summary;
  }, {
    totalPrice: 0,
    totalOriginalPrice: 0,
  }), [cartItems]);

  const browseDiscount = Math.max(0, browseSummary.totalOriginalPrice - browseSummary.totalPrice);
  const shouldShowHydrationScreen = isLoading && cartItems.length === 0;
  const lowStockCount = useMemo(
    () => cartItems.filter((item) => getItemStock(item) > 0 && getItemStock(item) <= 5).length,
    [cartItems],
  );
  const unavailableCount = useMemo(
    () => cartItems.filter((item) => getItemStock(item) === 0).length,
    [cartItems],
  );
  const estimatedDelivery = cartItems.find((item) => item?.deliveryTime)?.deliveryTime || t('cart.defaultDeliveryWindow', {}, '2-4 days');

  const handleMoveToWishlist = (productId) => {
    moveToWishlist(productId);
  };

  const handleProceedToCheckout = () => {
    clearDirectBuy();
    navigate('/checkout');
  };

  if (shouldShowHydrationScreen) {
    return (
      <div className="cart-premium-shell flex min-h-[80vh] items-center justify-center px-4 py-20">
        <div className="cart-empty-panel w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.4rem] border border-white/10 bg-white/[0.05]">
            <div className="h-9 w-9 rounded-full border-4 border-neo-cyan/70 border-t-transparent animate-spin" />
          </div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-neo-cyan">{t('cart.loadingKicker', {}, 'Live bag sync')}</p>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-white">{t('cart.loadingTitle', {}, 'Restoring Your Bag')}</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">
            {t('cart.loadingBody', {}, 'Syncing your latest cart state before we render the checkout view.')}
          </p>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="cart-premium-shell flex min-h-[80vh] items-center justify-center px-4 py-20">
        <div className="cart-empty-panel w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.4rem] border border-white/10 bg-white/[0.05]">
            <ShoppingBag className="h-9 w-9 text-neo-cyan" />
          </div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-neo-cyan">{t('cart.emptyKicker', {}, 'Cart queue')}</p>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-white">{t('cart.emptyTitle', {}, 'Your Bag is Empty')}</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">
            {t('cart.emptyBody', {}, "We couldn't find any items in your bag.")}
          </p>
          <Link to="/" className="checkout-premium-primary mt-8 inline-flex items-center gap-2 px-8 py-3 text-sm font-black uppercase tracking-[0.2em]">
            <Zap className="h-4 w-4 fill-white" />
            {t('cart.continueShopping', {}, 'Continue Shopping')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-premium-shell min-h-screen pb-24 pt-4">
      <div className="container-custom mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <nav className="mb-6 flex flex-wrap items-center gap-y-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500">
          <Link to="/" className="transition-colors hover:text-neo-cyan">Aura</Link>
          <ChevronRight className="mx-1 h-4 w-4 text-slate-700" />
          <span className="text-slate-200">{t('cart.breadcrumb', {}, 'Shopping Bag')}</span>
        </nav>

        <section className="cart-command-hero mb-6">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-neo-cyan">{t('cart.heroKicker', {}, 'Checkout command center')}</p>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white md:text-5xl">{t('cart.title', {}, 'Your Bag')}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
              {t('cart.heroBody', {}, 'Review live inventory, delivery readiness, and final bag value before moving into the secure checkout rail.')}
            </p>
          </div>
          <div className="cart-command-metrics">
            <div className="cart-signal">
              <ShoppingBag className="h-5 w-5" />
              <span>{t('cart.summary.itemsQueued', {}, 'Queued')}</span>
              <strong>{cartUnitCount} {cartItemLabel}</strong>
            </div>
            <div className="cart-signal">
              <Truck className="h-5 w-5" />
              <span>{t('cart.summary.delivery', {}, 'Delivery')}</span>
              <strong>{estimatedDelivery}</strong>
            </div>
            <div className="cart-signal">
              <BadgeCheck className="h-5 w-5" />
              <span>{t('cart.summary.liveStock', {}, 'Stock')}</span>
              <strong>{unavailableCount ? t('cart.summary.stockReview', { count: unavailableCount }, `${unavailableCount} to review`) : t('cart.summary.ready', {}, 'Ready')}</strong>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="min-w-0 space-y-4">
            <div className="cart-list-header">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t('cart.reviewKicker', {}, 'Live bag review')}</p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-white">{t('cart.reviewTitle', {}, 'Items from your AWS catalog session')}</h2>
              </div>
              {lowStockCount > 0 ? (
                <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-amber-200">
                  {t('cart.lowStockCount', { count: lowStockCount }, `${lowStockCount} low stock`)}
                </span>
              ) : (
                <span className="rounded-full border border-neo-emerald/25 bg-neo-emerald/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-neo-emerald">
                  {t('cart.allItemsReady', {}, 'All items ready')}
                </span>
              )}
            </div>

            {cartItems.map((item) => {
              const itemId = getCartItemId(item);
              const quantity = getItemQuantity(item);
              const stock = getItemStock(item);
              const isUnavailable = stock === 0;
              const isLowStock = stock > 0 && stock <= 5;
              const itemBaseCurrency = getBaseCurrency(item);
              const unitPrice = getLineBaseTotal({ ...item, quantity: 1 });
              const unitOriginal = getLineOriginalBaseTotal({ ...item, quantity: 1 });
              const productHref = `/product/${itemId}`;

              return (
                <article key={itemId} className="cart-item-card group">
                  <Link to={productHref} className="cart-item-media">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-full w-full object-contain p-3 transition-transform duration-500 group-hover:scale-[1.05]"
                    />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <Link to={productHref}>
                          <h3 className="line-clamp-2 text-lg font-black leading-tight text-white transition-colors group-hover:text-neo-cyan md:text-xl">
                            {item.title}
                          </h3>
                        </Link>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                          {item.brand ? <span>{item.brand}</span> : null}
                          {item.category ? <span className="text-slate-600">/</span> : null}
                          {item.category ? <span>{item.category}</span> : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-left md:text-right">
                        <p className="text-2xl font-black tracking-tight text-white">
                          {formatPrice(getLineBaseTotal(item), undefined, undefined, { baseCurrency: itemBaseCurrency })}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {t('cart.lineTotal', { count: quantity }, `Line total for ${quantity}`)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-end gap-3">
                      <span className="text-lg font-black text-white">
                        {formatPrice(unitPrice, undefined, undefined, { baseCurrency: itemBaseCurrency })}
                      </span>
                      {unitOriginal > unitPrice ? (
                        <span className="pb-0.5 text-xs font-semibold text-slate-500 line-through">
                          {formatPrice(unitOriginal, undefined, undefined, { baseCurrency: itemBaseCurrency })}
                        </span>
                      ) : null}
                      {Number(item.discountPercentage) > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-neo-cyan/20 bg-neo-cyan/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-neo-cyan">
                          <Zap className="h-3 w-3 fill-neo-cyan" />
                          {t('cart.discountOff', { count: item.discountPercentage }, '{{count}}% off')}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                      <div className="cart-quantity-control">
                        <button
                          type="button"
                          onClick={() => updateQuantity(itemId, quantity - 1)}
                          disabled={quantity <= 1}
                          aria-label={t('cart.quantity.decrease', { title: item.title }, 'Decrease quantity for {{title}}')}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span>{quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(itemId, quantity + 1)}
                          disabled={quantity >= stock}
                          aria-label={t('cart.quantity.increase', { title: item.title }, 'Increase quantity for {{title}}')}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className={isUnavailable ? 'cart-status-pill cart-status-pill-danger' : isLowStock ? 'cart-status-pill cart-status-pill-warn' : 'cart-status-pill cart-status-pill-good'}>
                          <PackageCheck className="h-3.5 w-3.5" />
                          {isUnavailable
                            ? t('cart.outOfStock', {}, 'Out of stock')
                            : isLowStock
                              ? t('cart.lowStock', { count: stock }, `Only ${stock} left`)
                              : t('cart.inStock', { count: stock }, `${stock} in stock`)}
                        </span>
                        <span className="cart-status-pill">
                          <Truck className="h-3.5 w-3.5" />
                          {item.deliveryTime || estimatedDelivery}
                        </span>
                        {item.warranty ? (
                          <span className="cart-status-pill">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {item.warranty}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
                      <button
                        type="button"
                        onClick={() => handleMoveToWishlist(itemId)}
                        className="cart-row-action hover:text-neo-fuchsia"
                      >
                        <Heart className="h-4 w-4" />
                        {t('cart.action.save', {}, 'Save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromCart(itemId)}
                        className="cart-row-action hover:text-neo-rose"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('cart.action.remove', {}, 'Remove')}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            <Link to="/" className="cart-continue-link group">
              <ChevronRight className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-1" />
              {t('cart.continueShopping', {}, 'Continue Shopping')}
            </Link>
          </section>

          <aside className="xl:sticky xl:top-28 xl:h-fit">
            <div className="cart-summary-panel">
              <div className="border-b border-white/10 p-6">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{t('cart.summary.kicker', {}, 'Secure summary')}</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{t('cart.summary.title', {}, 'Transaction Summary')}</h2>
              </div>

              <div className="space-y-5 p-6">
                <div className="space-y-3">
                  <div className="cart-summary-row">
                    <span>{t('cart.summary.subtotalWithCount', { count: cartUnitCount }, 'Subtotal ({{count}} items)')}</span>
                    <strong>{formatPrice(browseSummary.totalOriginalPrice, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}</strong>
                  </div>
                  <div className="cart-summary-row text-neo-cyan">
                    <span>{t('cart.summary.discount', {}, 'Delta Offset')}</span>
                    <strong>- {formatPrice(browseDiscount, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}</strong>
                  </div>
                  <div className="cart-summary-row">
                    <span>{t('cart.summary.shipping', {}, 'Shipping')}</span>
                    <strong className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.16em]">
                      {t('cart.summary.free', {}, 'FREE')}
                    </strong>
                  </div>
                </div>

                <div className="cart-total-panel">
                  <span>{t('cart.summary.netValue', {}, 'Net Value')}</span>
                  <strong>{formatPrice(browseSummary.totalPrice, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}</strong>
                </div>

                {browseDiscount > 0 ? (
                  <div className="cart-savings-note">
                    <Zap className="mt-0.5 h-4 w-4 shrink-0 fill-neo-cyan text-neo-cyan" />
                    <p>
                      {t('cart.summary.savingPrefix', {}, 'You are saving')}{' '}
                      <strong>{formatPrice(browseDiscount, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}</strong>
                      {' '}{t('cart.summary.savingSuffix', {}, 'on this order.')}
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-2">
                  <div className="cart-trust-row">
                    <LockKeyhole className="h-4 w-4 text-neo-cyan" />
                    <span>{t('cart.summary.secureCheckout', {}, 'Secure Encrypted Checkout')}</span>
                  </div>
                  <div className="cart-trust-row">
                    <PackageCheck className="h-4 w-4 text-neo-emerald" />
                    <span>{t('cart.summary.backendStock', {}, 'Stock rechecked before payment')}</span>
                  </div>
                </div>

                {unavailableCount > 0 ? (
                  <div className="rounded-[1.1rem] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
                    {t('cart.summary.unavailableWarning', { count: unavailableCount }, `${unavailableCount} item needs review before checkout.`)}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleProceedToCheckout}
                  disabled={unavailableCount > 0}
                  className="checkout-premium-primary flex w-full items-center justify-center gap-2 px-6 py-4 text-sm font-black uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {t('cart.summary.proceed', {}, 'Proceed to Checkout')}
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Cart;
