import { useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, Plus, Minus, ShoppingBag, Heart, ArrowRight, ShieldCheck, Zap, ChevronRight } from 'lucide-react';
import { CartContext } from '@/context/CartContext';
import { useMarket } from '@/context/MarketContext';
import { useCommerceStore } from '@/store/commerceStore';
import { convertAmount } from '@/utils/format';
import { BROWSE_BASE_CURRENCY } from '@/config/marketConfig';
import { getBaseCurrency, getLineBaseTotal, getLineOriginalBaseTotal } from '@/utils/pricing';

const Cart = () => {
  const { cartItems, removeFromCart, updateQuantity, moveToWishlist, isLoading } = useContext(CartContext);
  const { t, formatPrice } = useMarket();
  const clearDirectBuy = useCommerceStore((state) => state.clearDirectBuy);
  const navigate = useNavigate();

  const cartItemLabel = t(cartItems.length === 1 ? 'cart.item' : 'cart.items', {}, cartItems.length === 1 ? 'item' : 'items');
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

  const handleMoveToWishlist = (productId) => {
    moveToWishlist(productId);
  };

  const handleProceedToCheckout = () => {
    clearDirectBuy();
    navigate('/checkout');
  };

  if (isLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(80vw,600px)] h-[min(80vw,600px)] bg-neo-cyan/5 rounded-full blur-[150px] pointer-events-none -z-10" />

        <div className="container-custom py-10">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-glass relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-transparent to-neo-cyan/5 pointer-events-none" />
            <div className="w-24 h-24 rounded-full bg-zinc-950/50 border border-white/10 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
              <div className="w-10 h-10 rounded-full border-4 border-neo-cyan/70 border-t-transparent animate-spin" />
            </div>
            <h2 className="text-3xl font-black mb-4 text-white tracking-tight">{t('cart.loadingTitle', {}, 'Restoring Your Bag')}</h2>
            <p className="text-slate-400 max-w-sm mx-auto font-medium">
              {t('cart.loadingBody', {}, 'Syncing your latest cart state before we render the checkout view.')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center relative overflow-hidden">
        {/* Background Decor */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(80vw,600px)] h-[min(80vw,600px)] bg-neo-cyan/5 rounded-full blur-[150px] pointer-events-none -z-10" />

        <div className="container-custom py-10">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-glass relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-transparent to-neo-cyan/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

            <div className="w-24 h-24 rounded-full bg-zinc-950/50 border border-white/10 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
              <ShoppingBag className="w-10 h-10 text-slate-500 group-hover:text-neo-cyan transition-colors duration-300" />
            </div>

            <h2 className="text-3xl font-black mb-4 text-white tracking-tight">{t('cart.emptyTitle', {}, 'Your Bag is Empty')}</h2>
            <p className="text-slate-400 mb-8 max-w-sm mx-auto font-medium">
              {t('cart.emptyBody', {}, "We couldn't find any items in your bag.")}
            </p>
            <Link to="/" className="btn-primary inline-flex items-center gap-2 px-10 py-3 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <Zap className="w-4 h-4 fill-white" /> {t('cart.continueShopping', {}, 'Continue Shopping')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16 pt-4 relative">
      {/* Background Decor */}
      <div className="absolute top-0 right-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-cyan/10 rounded-full blur-[150px] pointer-events-none -z-10" />
      <div className="absolute bottom-40 left-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-fuchsia/10 rounded-full blur-[150px] pointer-events-none -z-10" />

      <div className="container-custom max-w-7xl mx-auto px-4 lg:px-8 py-6">
        {/* Breadcrumb */}
        <nav className="text-xs md:text-sm text-slate-500 font-bold uppercase tracking-widest mb-8 flex items-center flex-wrap gap-y-2">
          <Link to="/" className="hover:text-neo-cyan transition-colors">Aura</Link>
          <span className="mx-2 text-slate-700">/</span>
          <span className="text-white">{t('cart.breadcrumb', {}, 'Shopping Bag')}</span>
        </nav>

        <div className="flex flex-col xl:flex-row gap-8">
          {/* Cart Items */}
          <div className="flex-1">
            <div className="bg-white/5 border border-white/10 rounded-3xl shadow-glass overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/5 bg-zinc-950/50">
                <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                  <ShoppingBag className="w-6 h-6 text-neo-cyan" />
                  {t('cart.title', {}, 'Your Bag')}
                  <span className="bg-neo-cyan/20 text-neo-cyan text-sm px-3 py-1 rounded-full border border-neo-cyan/30">
                    {cartItems.length} {cartItemLabel}
                  </span>
                </h1>
                <span className="text-slate-400 text-sm hidden md:block border border-white/10 px-4 py-1.5 rounded-full bg-white/5 font-medium">{t('cart.nodeLabel', {}, 'Link: Primary Local Node')}</span>
              </div>

              {/* Items */}
              <div className="divide-y divide-white/5">
                {cartItems.map((item) => (
                  <div key={item.id} className="p-6 flex flex-col sm:flex-row gap-6 hover:bg-white/5 transition-colors group relative">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-neo-cyan to-neo-fuchsia opacity-0 group-hover:opacity-100 transition-opacity" />

                    {/* Image */}
                    <Link to={`/product/${item.id}`} className="w-full sm:w-32 h-40 sm:h-32 flex-shrink-0 bg-zinc-950/50 rounded-xl p-3 border border-white/5 flex items-center justify-center overflow-hidden">
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] mix-blend-screen group-hover:scale-110 transition-transform duration-500"
                      />
                    </Link>

                    {/* Details */}
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex justify-between items-start gap-4">
                        <Link to={`/product/${item.id}`}>
                          <h3 className="text-lg md:text-xl font-black text-white line-clamp-2 md:leading-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-slate-400 transition-all duration-300">
                            {item.title}
                          </h3>
                        </Link>
                        {/* Subtotal - Desktop */}
                        <div className="hidden md:block text-right flex-shrink-0">
                          <p className="font-black text-2xl tracking-tighter text-white drop-shadow-md">
                            {formatPrice(getLineBaseTotal(item), undefined, undefined, { baseCurrency: getBaseCurrency(item) })}
                          </p>
                        </div>
                      </div>

                      <p className="text-xs font-bold tracking-widest uppercase text-neo-cyan mt-1 mb-3">{item.brand}</p>

                      {/* Price */}
                      <div className="flex items-end gap-3 mb-4 flex-wrap">
                        <span className="font-black text-xl text-white tracking-tight">
                          {formatPrice(getLineBaseTotal({ ...item, quantity: 1 }), undefined, undefined, { baseCurrency: getBaseCurrency(item) })}
                        </span>
                        <span className="text-slate-500 font-medium line-through text-xs mb-1">
                          {formatPrice(getLineOriginalBaseTotal({ ...item, quantity: 1 }), undefined, undefined, { baseCurrency: getBaseCurrency(item) })}
                        </span>
                        <span className="bg-neo-cyan/10 border border-neo-cyan/20 text-neo-cyan px-2 py-0.5 rounded text-xs font-black uppercase tracking-wider mb-0.5 flex items-center gap-1 shadow-[0_0_10px_rgba(6,182,212,0.1)]">
                          <Zap className="w-3 h-3 fill-neo-cyan" />
                          {t('cart.discountOff', { count: item.discountPercentage }, '{{count}}% off')}
                        </span>
                      </div>

                      {/* Quantity & Actions */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-auto">
                        {/* Quantity Selector */}
                        <div className="flex justify-center sm:justify-start">
                          <div className="flex items-center border border-white/10 rounded-xl bg-zinc-950/50 p-1">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              aria-label={t('cart.quantity.decrease', { title: item.title }, 'Decrease quantity for {{title}}')}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="px-3 font-black text-white min-w-[3rem] text-center">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              disabled={item.quantity >= item.stock}
                              aria-label={t('cart.quantity.increase', { title: item.title }, 'Increase quantity for {{title}}')}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-center sm:justify-start gap-4 sm:ml-4">
                          <button
                            onClick={() => handleMoveToWishlist(item.id)}
                            className="text-slate-400 hover:text-neo-fuchsia text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-2"
                          >
                            <Heart className="w-4 h-4" />
                            {t('cart.action.save', {}, 'Save')}
                          </button>
                          <div className="w-px h-4 bg-white/10" />
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="text-slate-400 hover:text-neo-rose text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            {t('cart.action.remove', {}, 'Remove')}
                          </button>
                        </div>
                      </div>

                      {/* Subtotal - Mobile */}
                      <div className="md:hidden mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                        <span className="text-slate-400 text-sm font-medium">{t('cart.subtotal', {}, 'Subtotal')}</span>
                        <span className="font-black text-xl text-white tracking-tighter">
                          {formatPrice(getLineBaseTotal(item), undefined, undefined, { baseCurrency: getBaseCurrency(item) })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Continue Shopping */}
              <div className="p-6 border-t border-white/5 bg-zinc-950/30">
                <Link
                  to="/"
                  className="text-neo-cyan hover:text-white font-bold tracking-widest uppercase text-sm flex items-center gap-2 group/link w-fit"
                >
                  <ChevronRight className="w-4 h-4 rotate-180 group-hover/link:-translate-x-1 transition-transform" />
                  {t('cart.continueShopping', {}, 'Continue Shopping')}
                </Link>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="xl:w-96 flex-shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-3xl shadow-glass sticky top-24 overflow-hidden">
              <div className="p-6 border-b border-white/5 bg-gradient-to-b from-neo-cyan/10 to-transparent">
                <h2 className="font-black text-white uppercase tracking-widest flex items-center gap-2">
                  {t('cart.summary.title', {}, 'Transaction Summary')}
                </h2>
              </div>

              <div className="p-6 space-y-5">
                {/* Price Breakdown */}
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-slate-400">
                    {t('cart.summary.subtotalWithCount', {
                      count: cartItems.reduce((sum, item) => sum + item.quantity, 0),
                    }, 'Subtotal ({{count}} items)')}
                  </span>
                  <span className="text-slate-200">
                    {formatPrice(browseSummary.totalOriginalPrice, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}
                  </span>
                </div>

                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-neo-cyan">{t('cart.summary.discount', {}, 'Delta Offset')}</span>
                  <span className="text-neo-cyan">
                    - {formatPrice(browseDiscount, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}
                  </span>
                </div>

                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-slate-400">{t('cart.summary.shipping', {}, 'Shipping')}</span>
                  <span className="bg-white/10 px-2 py-0.5 rounded text-white text-xs font-bold tracking-widest uppercase">{t('cart.summary.free', {}, 'FREE')}</span>
                </div>

                <div className="border-t border-white/10 pt-5 mt-5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-300 uppercase tracking-wider text-sm">{t('cart.summary.netValue', {}, 'Net Value')}</span>
                    <span className="font-black text-3xl tracking-tighter text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                      {formatPrice(browseSummary.totalPrice, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}
                    </span>
                  </div>
                </div>

                <div className="bg-neo-cyan/5 border border-neo-cyan/20 rounded-xl p-3 flex items-start gap-3 mt-4">
                  <Zap className="w-5 h-5 text-neo-cyan flex-shrink-0 mt-0.5" />
                  <p className="text-neo-cyan font-medium text-sm leading-relaxed">
                    {t('cart.summary.savingPrefix', {}, 'You are saving')}{' '}
                    <span className="font-black">
                      {formatPrice(browseDiscount, undefined, undefined, { baseCurrency: BROWSE_BASE_CURRENCY })}
                    </span>
                    {' '}{t('cart.summary.savingSuffix', {}, 'on this order.')}
                  </p>
                </div>

                {/* Secure Badge */}
                <div className="flex items-center gap-3 justify-center text-xs font-bold uppercase tracking-widest text-slate-500 pt-4 pb-2">
                  <ShieldCheck className="w-5 h-5 text-neo-cyan/70" />
                  <span>{t('cart.summary.secureCheckout', {}, 'Secure Encrypted Checkout')}</span>
                </div>

                {/* Checkout Button */}
                <button
                  onClick={handleProceedToCheckout}
                  className="w-full btn-primary py-4 mt-2 flex items-center justify-center gap-2 text-sm tracking-widest shadow-[0_0_20px_rgba(217,70,239,0.3)] group/btn relative overflow-hidden"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {t('cart.summary.proceed', {}, 'Proceed to Checkout')}
                    <ArrowRight className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan to-neo-fuchsia opacity-0 group-hover/btn:opacity-50 transition-opacity duration-300 pointer-events-none" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;

