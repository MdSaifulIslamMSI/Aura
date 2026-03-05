import { Loader2, RefreshCcw, TicketPercent, Zap } from 'lucide-react';
import { formatPrice } from '@/utils/format';
import { cn } from '@/lib/utils';

const OrderSummary = ({
    items,
    quote,
    fallbackTotals,
    isQuoting,
    quoteError,
    isQuoteStale,
    couponCode,
    onCouponCodeChange,
    onApplyCoupon,
    onRemoveCoupon,
    onRecalculate,
}) => {
    const itemsPrice = quote?.itemsPrice ?? fallbackTotals.itemsPrice;
    const shippingPrice = quote?.shippingPrice ?? 0;
    const couponDiscount = quote?.couponDiscount ?? 0;
    const paymentAdjustment = quote?.paymentAdjustment ?? 0;
    const taxPrice = quote?.taxPrice ?? 0;
    const totalPrice = quote?.totalPrice ?? fallbackTotals.totalPrice;
    const appliedCoupon = quote?.appliedCoupon;

    return (
        <aside className="h-fit lg:sticky lg:top-28">
            <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 shadow-glass overflow-hidden">
                <div className="p-6 border-b border-white/5 bg-zinc-950/50 flex items-center justify-between">
                    <h3 className="font-black uppercase tracking-widest text-white text-sm md:text-base">Order Summary</h3>
                    {isQuoting ? <Loader2 className="w-4 h-4 text-neo-cyan animate-spin" /> : null}
                </div>

                <div className="p-5 sm:p-6 space-y-5">
                    <div className="space-y-3 max-h-56 overflow-auto pr-1">
                        {items.map((item) => (
                            <div key={item.id} className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-lg bg-zinc-950/70 border border-white/10 p-1.5">
                                    <img src={item.image} alt={item.title} className="w-full h-full object-contain" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white font-semibold line-clamp-1">{item.title}</p>
                                    <p className="text-xs text-slate-400">Qty {item.quantity}</p>
                                </div>
                                <p className="text-sm text-slate-200 font-bold">{formatPrice(item.price * item.quantity)}</p>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-3 pt-2 border-t border-white/10">
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Items</span>
                            <span>{formatPrice(itemsPrice)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Shipping</span>
                            <span>{shippingPrice === 0 ? 'FREE' : formatPrice(shippingPrice)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Payment Adjustment</span>
                            <span className={cn(paymentAdjustment <= 0 ? 'text-neo-cyan' : 'text-amber-300')}>
                                {paymentAdjustment === 0 ? formatPrice(0) : `${paymentAdjustment > 0 ? '+' : '-'} ${formatPrice(Math.abs(paymentAdjustment))}`}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Coupon Discount</span>
                            <span className="text-neo-cyan">- {formatPrice(couponDiscount)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Tax</span>
                            <span>{formatPrice(taxPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-4 border-t border-white/10 gap-3">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Total</span>
                            <span className="text-xl sm:text-2xl font-black tracking-tighter text-white">{formatPrice(totalPrice)}</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-xs uppercase tracking-widest font-bold text-slate-400 flex items-center gap-2">
                            <TicketPercent className="w-4 h-4 text-neo-cyan" />
                            Coupon
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                value={couponCode}
                                onChange={(event) => onCouponCodeChange(event.target.value.toUpperCase())}
                                placeholder="Enter code"
                                className="flex-1 bg-zinc-950/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neo-cyan"
                            />
                            <button
                                type="button"
                                onClick={onApplyCoupon}
                                className="w-full sm:w-auto px-4 py-2 rounded-xl border border-white/20 text-xs uppercase tracking-widest font-bold text-slate-200"
                            >
                                Apply
                            </button>
                        </div>
                        {appliedCoupon ? (
                            <div className="text-xs text-neo-cyan bg-neo-cyan/10 border border-neo-cyan/20 rounded-xl p-3 flex items-center justify-between gap-2">
                                <span>{appliedCoupon.code} applied</span>
                                <button type="button" onClick={onRemoveCoupon} className="underline">
                                    Remove
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={onRecalculate}
                        className="w-full px-4 py-2 rounded-xl border border-white/20 text-xs uppercase tracking-widest font-bold text-slate-200 hover:border-neo-cyan/40 flex items-center justify-center gap-2"
                    >
                        <RefreshCcw className="w-3.5 h-3.5" />
                        Recalculate Quote
                    </button>

                    {isQuoteStale ? (
                        <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                            Pricing may be stale. Recalculate before placing the order.
                        </div>
                    ) : null}

                    {quoteError ? (
                        <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
                            {quoteError}
                        </div>
                    ) : null}

                    <div className="bg-neo-cyan/5 border border-neo-cyan/20 rounded-xl p-3 text-xs text-neo-cyan flex items-start gap-2">
                        <Zap className="w-4 h-4 mt-0.5" />
                        <span>All totals are backend-validated during order placement.</span>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default OrderSummary;
